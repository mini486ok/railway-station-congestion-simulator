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

from .model import Model, adjacency_matrix

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
    ) -> Tuple[np.ndarray, List[str], np.ndarray]:
        """특징 텐서 X[T', R, F], 채널명 리스트, 시점 인덱스(원스텝 기준 시작 step)를 반환."""
        R = self.model.n_real
        area = self.model.area[:R]
        T = self.count.shape[0]
        w = int(np.clip(warmup, 0, max(0, T - 1)))  # 워밍업이 전체를 넘지 않도록 클램프
        agg = max(1, int(aggregate_steps))
        # 상태량(레벨)은 합산 금지 → mean/snapshot 만 허용. 유량은 합산.
        state_method = aggregate_method if aggregate_method in ("mean", "snapshot") else "mean"

        base: Dict[str, np.ndarray] = {
            "count": self.count[w:],
            "inflow": self.inflow[w:],
            "outflow": self.outflow[w:],
            "p_stay": self.pstay[w:],
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
    def nodes_csv(self) -> str:
        m = self.model
        rows = [
            (m.node_ids[i], m.node_names[i], m.node_kinds[i],
             f"{m.area[i]:.4f}", f"{m.node_x[i]:.2f}", f"{m.node_y[i]:.2f}")
            for i in range(m.n_real)
        ]
        return _csv(["node_id", "name", "kind", "area", "x", "y"], rows)

    def edges_csv(self) -> str:
        m = self.model
        rows = [
            (m.node_ids[s], m.node_ids[d], f"{w:.6f}", f"{dist:.4f}", tau)
            for s, d, w, dist, tau in m.graph_edges
        ]
        return _csv(["src_id", "dst_id", "weight", "distance", "tau"], rows)

    def timeseries_csv(self, dt_seconds: float = 1.0, warmup: int = 0,
                       aggregate_steps: int = 1, aggregate_method: str = "mean") -> str:
        m = self.model
        X, names, step0 = self.feature_tensor(
            ["count", "density", "inflow", "outflow", "p_stay"],
            aggregate_steps, aggregate_method, warmup,
        )
        header = ["step", "time_sec", "node_id"] + names
        nb, R, F = X.shape
        rows = []
        for ti in range(nb):
            step = int(step0[ti])
            tsec = step * dt_seconds
            for ni in range(R):
                rows.append([step, f"{tsec:.1f}", m.node_ids[ni]]
                            + [f"{X[ti, ni, fi]:.4f}" for fi in range(F)])
        return _csv(header, rows)

    def departures_csv(self, dt_seconds: float = 1.0, warmup: int = 0, aggregate_steps: int = 1) -> str:
        """출입구별 퇴장 + 승강장별 탑승의 누적/증분. timeseries 와 동일한 워밍업/집계 시간축."""
        m = self.model
        cols = [f"exit_{m.node_ids[i]}" for i in m.entrance_idx] \
            + [f"board_{m.node_ids[i]}" for i in m.platform_idx]
        T = self.sink.shape[0]
        w = int(np.clip(warmup, 0, max(0, T - 1)))
        agg = max(1, int(aggregate_steps))
        cum_all = self.sink                                   # [T, n_sink] 누적
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
    def npz_bytes(self, cfg, normalize_stats: bool = True) -> bytes:
        """X[T,N,F] + adjacency + edge_index + edge_attr + 메타를 npz bytes 로."""
        exp = cfg.export
        channels = list(exp.feature_channels) or ["count"]
        X, names, step0 = self.feature_tensor(
            channels,
            aggregate_steps=exp.aggregate_steps,
            aggregate_method=exp.aggregate_method,
            warmup=cfg.warmup_steps,
            noise_enabled=exp.noise_enabled,
            noise_model=exp.noise_model,
            noise_sigma=exp.noise_sigma,
            seed=cfg.seed + 999,
        )
        m = self.model
        A = adjacency_matrix(m)
        if m.graph_edges:
            edge_index = np.array([[s for s, *_ in m.graph_edges],
                                   [d for _s, d, *_ in m.graph_edges]], dtype=np.int64)
            edge_attr = np.array([[w, dist, tau] for _s, _d, w, dist, tau in m.graph_edges],
                                 dtype=np.float64)
        else:
            edge_index = np.zeros((2, 0), dtype=np.int64)
            edge_attr = np.zeros((0, 3), dtype=np.float64)

        payload = dict(
            X=X.astype(np.float32),
            channels=np.array(names),
            node_ids=np.array(m.node_ids),
            node_kinds=np.array(m.node_kinds),
            adjacency=A.astype(np.float32),
            edge_index=edge_index,
            edge_attr=edge_attr.astype(np.float32),
            step_index=step0.astype(np.int64),
            dt_seconds=np.array(cfg.dt_seconds),
            start_time_sec=np.array(cfg.start_time_sec),
            aggregate_steps=np.array(exp.aggregate_steps),
        )
        if normalize_stats and "count" in names:
            ci = names.index("count")
            cnt = X[:, :, ci]
            payload["count_mean"] = cnt.mean(axis=0).astype(np.float32)
            payload["count_std"] = (cnt.std(axis=0) + 1e-6).astype(np.float32)

        buf = io.BytesIO()
        np.savez_compressed(buf, **payload)
        return buf.getvalue()
