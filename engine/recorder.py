"""시뮬레이션 결과 적재 + STGCN용 데이터 export(CSV/npz).

- 매 스텝 real 노드의 count/inflow/outflow/p_stay 와 sink 누적(퇴장/탑승)을 기록.
- export 시 워밍업 제외 → (옵션)집계 다운샘플 → (옵션)관측 노이즈 → 특징 텐서 [T,N,F].
- 브라우저(Pyodide)에서는 CSV 문자열 / npz bytes 를 반환해 Blob 다운로드, 로컬은 파일 저장.
"""
from __future__ import annotations

import csv
import io
from typing import Dict, List, Tuple

import numpy as np

from .model import Model, adjacency_matrix, group_adjacency, group_edge_attrs, node_edge_attrs

_FORMULA_CHARS = ("=", "+", "-", "@")


def _safe(v) -> str:
    """Excel 수식 인젝션 방지: =,+,-,@ 로 시작하는 텍스트에 ' 접두."""
    s = str(v)
    if s and s[0] in _FORMULA_CHARS:
        s = "'" + s
    return s


def _csv(header: List[str], rows) -> str:
    """표준 CSV 작성(콤마·따옴표·줄바꿈 자동 이스케이프 + 수식 가드)."""
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(header)
    for r in rows:
        w.writerow([_safe(x) for x in r])
    return buf.getvalue()


class Recorder:
    def __init__(self, model: Model, total_steps: int):
        self.model = model
        self.total_steps = total_steps
        R = model.n_real
        n_sink = model.n_total - R
        T = total_steps + 1
        self.count = np.zeros((T, R), dtype=np.float64)
        self.inflow = np.zeros((T, R), dtype=np.float64)
        self.outflow = np.zeros((T, R), dtype=np.float64)
        self.pstay = np.zeros((T, R), dtype=np.float64)
        self.sink = np.zeros((T, n_sink), dtype=np.float64)

    def record(self, t: int, N: np.ndarray, inflow: np.ndarray,
               outflow: np.ndarray, pstay: np.ndarray) -> None:
        R = self.model.n_real
        self.count[t] = N[:R]
        self.inflow[t] = inflow[:R]
        self.outflow[t] = outflow[:R]
        self.pstay[t] = pstay[:R]
        self.sink[t] = N[R:]

    # ── 집계 ──
    @staticmethod
    def _aggregate(arr: np.ndarray, steps: int, method: str) -> np.ndarray:
        if steps <= 1:
            return arr
        T = arr.shape[0]
        nb = T // steps
        if nb == 0:
            return arr
        a = arr[: nb * steps].reshape(nb, steps, arr.shape[1])
        if method == "sum":
            return a.sum(axis=1)
        if method == "snapshot":
            return a[:, -1, :]
        return a.mean(axis=1)

    def _use_group(self, group_level: bool) -> bool:
        """물리 그룹 집계를 실제로 적용할지 — 그룹이 정의돼 있고 사용자가 group 단위를 선택한 경우만."""
        return bool(self.model.has_grouping and group_level)

    def _level_arrays(self, group_level: bool = True):
        """노드 단위 또는 (group_level & 그룹 정의 시) 물리 그룹 단위로 합산한 count/inflow/outflow/pstay/area.

        그룹 집계: 인원(count)·유입(inflow)·유출(outflow)은 멤버 합, 면적은 멤버 합, 체류확률(p_stay)은
        인원 가중 평균(인원 0 시점은 멤버 단순평균으로 폴백)으로 산출한다. 인원 보존(그룹 합=노드 합)과
        ``count[t]=count[t-1]−outflow+inflow`` 관계는 그룹 단위에서도 성립한다. 단, inflow/outflow 는
        멤버 노드 유량의 합이므로 같은 그룹의 두 노드를 직접 링크로 이으면 그룹 내부 이동분이 양쪽에
        포함된다(권장 모델링인 진입/진출 분리 구조에서는 그룹 내부 직접 링크가 없어 경계 순유량과 일치).
        """
        m = self.model
        R = m.n_real
        if not self._use_group(group_level):
            return self.count, self.inflow, self.outflow, self.pstay, m.area[:R].copy()
        G = len(m.group_ids)
        M = np.zeros((R, G), dtype=np.float64)
        M[np.arange(R), m.group_index] = 1.0
        cnt = self.count @ M       # 그룹 인원 = 멤버 합
        inf = self.inflow @ M
        outf = self.outflow @ M
        # 체류확률: 인원 가중 평균(밀도=합/합면적 기준과 정합). 인원 0 시점은 멤버 단순평균.
        member_cnt = M.sum(axis=0)
        pst_w = (self.pstay * self.count) @ M
        pst_simple = (self.pstay @ M) / np.maximum(member_cnt, 1.0)
        pst = np.where(cnt > 1e-9, pst_w / np.maximum(cnt, 1e-9), pst_simple)
        return cnt, inf, outf, pst, m.group_area.copy()

    def out_ids(self, group_level: bool = True) -> List[str]:
        m = self.model
        return list(m.group_ids) if self._use_group(group_level) else list(m.node_ids)

    def feature_tensor(
        self,
        channels: List[str],
        aggregate_steps: int = 1,
        aggregate_method: str = "mean",
        warmup: int = 0,
        noise_enabled: bool = False,
        noise_model: str = "gaussian",
        noise_sigma: float = 0.0,
        seed: int = 12345,
        group_level: bool = True,
    ) -> Tuple[np.ndarray, List[str], np.ndarray]:
        """특징 텐서 X[T', N|G, F](group_level & 그룹 정의 시 물리 그룹 단위), 채널명, 시점 인덱스 반환."""
        cnt, inf, outf, pst, area = self._level_arrays(group_level)
        T = cnt.shape[0]
        w = int(np.clip(warmup, 0, max(0, T - 1)))  # 워밍업이 전체를 넘지 않도록 클램프
        agg = max(1, int(aggregate_steps))
        # 상태량(레벨)은 합산 금지 → mean/snapshot 만 허용. 유량은 합산.
        state_method = aggregate_method if aggregate_method in ("mean", "snapshot") else "mean"

        base: Dict[str, np.ndarray] = {
            "count": cnt[w:],
            "inflow": inf[w:],
            "outflow": outf[w:],
            "p_stay": pst[w:],
        }
        base["density"] = base["count"] / area
        agg_method = {
            "count": state_method, "density": state_method, "p_stay": state_method,
            "inflow": "sum", "outflow": "sum",
        }

        feats: List[np.ndarray] = []
        names: List[str] = []
        for ch in channels:
            if ch not in base:
                continue
            feats.append(self._aggregate(base[ch], agg, agg_method.get(ch, "mean")))
            names.append(ch)

        # 관측 노이즈: count 가 요청된 경우에만 count_noisy 채널 추가
        if noise_enabled and "count" in channels:
            clean = self._aggregate(base["count"], agg, state_method)
            rng = np.random.default_rng(seed)
            if noise_model == "poisson":
                noisy = rng.poisson(np.maximum(clean, 0.0)).astype(np.float64)
            else:
                noisy = clean + rng.normal(0.0, noise_sigma, size=clean.shape)
            feats.append(np.maximum(noisy, 0.0))
            names.append("count_noisy")

        if not feats:
            feats.append(self._aggregate(base["count"], agg, state_method))
            names.append("count")

        X = np.stack(feats, axis=-1)  # [T', R, F]
        nb = X.shape[0]
        step0 = np.arange(nb) * agg + w
        return X, names, step0

    # ── CSV (표준 이스케이프 + 수식 인젝션 가드) ──
    def _group_kind(self, gk: int) -> str:
        m = self.model
        ks = {m.node_kinds[i] for i in range(m.n_real) if int(m.group_index[i]) == gk}
        return next(iter(ks)) if len(ks) == 1 else "복합"

    def nodes_csv(self, group_level: bool = True) -> str:
        m = self.model
        header = ["node_id", "name", "kind", "group", "direction", "area", "x", "y"]
        if not self._use_group(group_level):
            rows = [
                (m.node_ids[i], m.node_names[i], m.node_kinds[i],
                 m.node_group[i], m.node_direction[i],
                 f"{m.area[i]:.4f}", f"{m.node_x[i]:.2f}", f"{m.node_y[i]:.2f}")
                for i in range(m.n_real)
            ]
            return _csv(header, rows)
        # 그룹 행: node_id=그룹명, group=그룹명(자기 식별), direction 은 비움(멤버 매핑은 npz group_members)
        rows = [(g, g, self._group_kind(gk), g, "", f"{m.group_area[gk]:.4f}", "", "")
                for gk, g in enumerate(m.group_ids)]
        return _csv(header, rows)

    def edges_csv(self, group_level: bool = True) -> str:
        m = self.model
        if not self._use_group(group_level):
            # npz(node_edge_attrs)와 동일 그래프가 되도록 동일 (src,dst) 집계
            na = node_edge_attrs(m)
            rows = [(m.node_ids[s], m.node_ids[d], f"{w:.6f}", f"{dist:.4f}", f"{tau:.4f}")
                    for (s, d), (w, dist, tau) in sorted(na.items())]
            return _csv(["src_id", "dst_id", "weight", "distance", "tau"], rows)
        # 그룹 엣지: 거리/tau 는 멤버 엣지의 weight 가중평균(노드 단위와 동일 스키마)
        ga = group_edge_attrs(m)
        rows = [(m.group_ids[gs], m.group_ids[gd], f"{w:.6f}", f"{dist:.4f}", f"{tau:.4f}")
                for (gs, gd), (w, dist, tau) in sorted(ga.items())]
        return _csv(["src_id", "dst_id", "weight", "distance", "tau"], rows)

    def timeseries_csv(self, dt_seconds: float = 1.0, warmup: int = 0,
                       aggregate_steps: int = 1, aggregate_method: str = "mean",
                       group_level: bool = True) -> str:
        m = self.model
        X, names, step0 = self.feature_tensor(
            ["count", "density", "inflow", "outflow", "p_stay"],
            aggregate_steps, aggregate_method, warmup, group_level=group_level,
        )
        ids = self.out_ids(group_level)
        header = ["step", "time_sec", "node_id"] + names
        nb, R, F = X.shape
        rows = []
        for ti in range(nb):
            step = int(step0[ti])
            tsec = step * dt_seconds
            for ni in range(R):
                rows.append([step, f"{tsec:.1f}", ids[ni]]
                            + [f"{X[ti, ni, fi]:.4f}" for fi in range(F)])
        return _csv(header, rows)

    def _sink_aggregation(self, group_level: bool):
        """sink 컬럼(출입구 퇴장 + 승강장 탑승)을 노드별 또는 물리 그룹별로 묶는 [n_sink, n_col] 행렬·라벨."""
        m = self.model
        ent, plat = m.entrance_idx, m.platform_idx
        ne, n_sink = len(ent), self.sink.shape[1]
        use_group = self._use_group(group_level)

        def label(j: int):
            if j < ne:
                g = m.node_group[ent[j]] if use_group else m.node_ids[ent[j]]
                return ("exit", g)
            p = plat[j - ne]
            g = m.node_group[p] if use_group else m.node_ids[p]
            return ("board", g)

        order: List[Tuple[str, str]] = []
        keyidx: Dict[Tuple[str, str], int] = {}
        colmap: List[int] = []
        for j in range(n_sink):
            k = label(j)
            if k not in keyidx:
                keyidx[k] = len(order); order.append(k)
            colmap.append(keyidx[k])
        cols = [f"{kind}_{g}" for kind, g in order]
        Agg = np.zeros((n_sink, len(order)), dtype=np.float64)
        for j, ci in enumerate(colmap):
            Agg[j, ci] = 1.0
        return Agg, cols

    def departures_csv(self, dt_seconds: float = 1.0, warmup: int = 0, aggregate_steps: int = 1,
                       group_level: bool = True) -> str:
        """출입구별 퇴장 + 승강장별 탑승의 누적/증분(출력 단위 따름). timeseries 와 동일한 워밍업/집계 시간축."""
        m = self.model
        Agg, cols = self._sink_aggregation(group_level)
        T = self.sink.shape[0]
        w = int(np.clip(warmup, 0, max(0, T - 1)))
        agg = max(1, int(aggregate_steps))
        cum_all = self.sink @ Agg                             # [T, n_col] 누적(출력 단위로 합산)
        per_delta = np.diff(cum_all, axis=0, prepend=cum_all[:1] * 0.0)
        cum = self._aggregate(cum_all[w:], agg, "snapshot")   # 누적은 bin 끝값
        delta = self._aggregate(per_delta[w:], agg, "sum")    # 증분은 bin 합
        step0 = np.arange(cum.shape[0]) * agg + w
        header = ["step", "time_sec"] + [c + "_cum" for c in cols] + [c + "_delta" for c in cols]
        rows = []
        for ti in range(cum.shape[0]):
            step = int(step0[ti])
            rows.append([step, f"{step * dt_seconds:.1f}"]
                        + [f"{x:.4f}" for x in cum[ti]] + [f"{x:.4f}" for x in delta[ti]])
        return _csv(header, rows)

    # ── npz (STGCN 직결) ──
    def npz_bytes(self, cfg, normalize_stats: bool = True, group_level=None) -> bytes:
        """X[T,N,F] + adjacency + edge_index + edge_attr + 메타를 npz bytes 로.

        group_level=None 이면 cfg.export.output_level 을 따르고, True/False 면 그 단위를 강제한다
        (노드+그룹 두 파일을 동시에 만드는 전체 번들 export 에서 단위를 명시 지정할 때 사용).
        """
        exp = cfg.export
        channels = list(exp.feature_channels) or ["count"]
        if group_level is None:
            group_level = (exp.output_level != "node")
        else:
            group_level = bool(group_level)
        X, names, step0 = self.feature_tensor(
            channels,
            aggregate_steps=exp.aggregate_steps,
            aggregate_method=exp.aggregate_method,
            warmup=cfg.warmup_steps,
            noise_enabled=exp.noise_enabled,
            noise_model=exp.noise_model,
            noise_sigma=exp.noise_sigma,
            seed=cfg.seed + 999,
            group_level=group_level,
        )
        m = self.model
        use_group = self._use_group(group_level)
        if use_group:
            # 물리 그룹 단위 그래프(분리 노드를 장소로 병합). 거리/tau 는 멤버 엣지 가중평균(노드 단위와 동일 스키마)
            A = group_adjacency(m)
            ids = list(m.group_ids)
            kinds = [self._group_kind(gk) for gk in range(len(m.group_ids))]
            ga = group_edge_attrs(m)
            ss, dd, attrs = [], [], []
            for (gs, gd), (w, dist, tau) in sorted(ga.items()):
                ss.append(gs); dd.append(gd); attrs.append([w, dist, tau])
            edge_index = np.array([ss, dd], dtype=np.int64) if ss else np.zeros((2, 0), dtype=np.int64)
            edge_attr = np.array(attrs, dtype=np.float64) if attrs else np.zeros((0, 3), dtype=np.float64)
        else:
            # 노드 단위: 동일 (s,d) 다중 링크를 인접행렬과 같은 기준으로 집계(거리/tau 가중평균)
            A = adjacency_matrix(m)
            ids = list(m.node_ids)
            kinds = list(m.node_kinds)
            na = node_edge_attrs(m)
            ss, dd, attrs = [], [], []
            for (s, d), (w, dist, tau) in sorted(na.items()):
                ss.append(s); dd.append(d); attrs.append([w, dist, tau])
            edge_index = np.array([ss, dd], dtype=np.int64) if ss else np.zeros((2, 0), dtype=np.int64)
            edge_attr = np.array(attrs, dtype=np.float64) if attrs else np.zeros((0, 3), dtype=np.float64)

        payload = dict(
            X=X.astype(np.float32),
            channels=np.array(names),
            node_ids=np.array(ids),
            node_kinds=np.array(kinds),
            adjacency=A.astype(np.float32),
            edge_index=edge_index,
            edge_attr=edge_attr.astype(np.float32),
            step_index=step0.astype(np.int64),
            dt_seconds=np.array(cfg.dt_seconds),
            start_time_sec=np.array(cfg.start_time_sec),
            aggregate_steps=np.array(exp.aggregate_steps),
            # output_level=실제 해상도(그룹 미정의면 group 요청이라도 node). 요청 단위/값 스케일을 별도 메타로.
            output_level=np.array("group" if use_group else "node"),
            requested_output_level=np.array("group" if group_level else "node"),
            value_scale=np.array("group_member_sum" if use_group else "node"),
        )
        # 출력 단위 메타: 그룹↔멤버 매핑(그룹) 또는 방향·소속그룹(노드) — 사후 재집계/교차검증용
        if use_group:
            payload["group_members"] = np.array([
                "|".join(m.node_ids[i] for i in range(m.n_real) if int(m.group_index[i]) == gk)
                for gk in range(len(m.group_ids))
            ])
        else:
            payload["node_direction"] = np.array(list(m.node_direction))
            payload["node_group"] = np.array(list(m.node_group))
        # 정규화 통계: 전 채널 노드별 평균/표준편차 [N,F](STGCN 채널별 정규화) + count 호환 키.
        # 값 스케일은 output_level 에 종속(그룹=멤버 합)이므로 payload["output_level"] 과 함께 해석할 것.
        if normalize_stats and X.shape[0] > 0:
            payload["feat_mean"] = X.mean(axis=0).astype(np.float32)            # [N, F]
            payload["feat_std"] = (X.std(axis=0) + 1e-6).astype(np.float32)     # [N, F]
            payload["feat_channels"] = np.array(names)
            stat_ch = "count" if "count" in names else next(
                (c for c in ("count_noisy", "density", "p_stay") if c in names), None)
            if stat_ch is not None:  # 하위호환: count(또는 대체 채널) 단일 통계
                ci = names.index(stat_ch)
                cnt = X[:, :, ci]
                payload["count_mean"] = cnt.mean(axis=0).astype(np.float32)
                payload["count_std"] = (cnt.std(axis=0) + 1e-6).astype(np.float32)
                payload["norm_channel"] = np.array(stat_ch)

        buf = io.BytesIO()
        np.savez_compressed(buf, **payload)
        return buf.getvalue()
