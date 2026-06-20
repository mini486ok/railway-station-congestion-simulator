"""Pyodide(브라우저) ↔ JS 경계 모듈.

JS(Web Worker)는 config 를 JSON 문자열로 넘기고, 결과는 JSON 문자열(dict 류) 또는
bytes(npz)/str(csv) 로 받는다. 변환 복잡도를 줄이기 위해 dict 결과는 모두 json.dumps 한다.
이 모듈은 브라우저 전용이 아니며 순수 Python 이라 네이티브에서도 import 가능하다.
"""
from __future__ import annotations

import io
import json

import numpy as np

from .config import SimConfig, NODE_KINDS, KIND_LABELS_KO, DEFAULT_V0
from .simulator import Simulator
from .validate import validate_config

_sim: Simulator | None = None
_cfg: SimConfig | None = None


def _to_cfg(config) -> SimConfig:
    if isinstance(config, str):
        return SimConfig.from_json(config)
    try:
        config = config.to_py()  # Pyodide JsProxy -> dict
    except AttributeError:
        pass
    return SimConfig.from_dict(config)


def kinds() -> str:
    return json.dumps([
        {"key": k, "label": KIND_LABELS_KO[k], "v0": DEFAULT_V0[k]}
        for k in NODE_KINDS
    ], ensure_ascii=False)


def validate(config) -> str:
    return json.dumps(validate_config(_to_cfg(config)), ensure_ascii=False)


def create(config) -> str:
    global _sim, _cfg
    cfg = _to_cfg(config)
    v = validate_config(cfg)
    if not v["ok"]:
        _sim = None
        _cfg = None
        return json.dumps({"ok": False, "errors": v["errors"], "warnings": v["warnings"]}, ensure_ascii=False)
    _cfg = cfg
    _sim = Simulator(_cfg)
    m = _sim.model
    return json.dumps({
        "ok": True,
        "n_real": m.n_real,
        "total_steps": _cfg.total_steps,
        "dt_seconds": _cfg.dt_seconds,
        "node_ids": list(m.node_ids),
        "node_names": list(m.node_names),
        "node_kinds": list(m.node_kinds),
        "node_max": [float(x) for x in _sim.N_max[:m.n_real]],
        "warnings": list(m.warnings),
    }, ensure_ascii=False)


def _snapshot() -> dict:
    assert _sim is not None
    m = _sim.model
    R = m.n_real
    N = _sim.N[:R]
    area = m.area[:R]
    return {
        "t": int(_sim.t),
        "done": bool(_sim.t >= _sim.total_steps),
        "count": [round(float(x), 3) for x in N],
        "density": [round(float(x), 4) for x in (N / area)],
        "pstay": [round(float(x), 4) for x in _sim.p_stay[:R]],
        "total_in_station": round(float(N.sum()), 2),
        "queue": round(float(_sim.entrance_queue.sum()), 2),
        "egress": round(float(_sim.N[~m.real_mask].sum()), 2),
        "generated": round(float(_sim.cumulative_generated), 2),
    }


def snapshot() -> str:
    return json.dumps(_snapshot(), ensure_ascii=False)


def step_many(n: int = 1) -> str:
    assert _sim is not None
    for _ in range(int(n)):
        if _sim.t >= _sim.total_steps:
            break
        _sim.step()
    return json.dumps(_snapshot(), ensure_ascii=False)


def reset() -> str:
    global _sim
    assert _cfg is not None
    _sim = Simulator(_cfg)
    return json.dumps(_snapshot(), ensure_ascii=False)


def run_all() -> str:
    assert _sim is not None
    _sim.run()
    return json.dumps(_snapshot(), ensure_ascii=False)


def _level_flag(level: str) -> bool:
    """출력 단위 문자열 → group_level 불리언. 빈값/auto 면 cfg.export.output_level 을 따른다.

    잘못된 값은 조용히 폴백하지 않고 ValueError 로 알린다(검증 일관성).
    """
    assert _cfg is not None
    lv = (level or "").strip().lower()
    if lv in ("", "auto"):
        return _cfg.export.output_level != "node"
    if lv in ("node", "nodes"):
        return False
    if lv in ("group", "groups"):
        return True
    raise ValueError(f"알 수 없는 출력 단위(level): {level!r} — '', 'auto', 'node', 'group' 중 하나여야 합니다.")


_CSV_KINDS = ("nodes", "edges", "departures", "timeseries")


def _csv_for(kind: str, group_level: bool) -> str:
    assert _sim is not None and _cfg is not None
    rec = _sim.recorder
    if kind == "nodes":
        return rec.nodes_csv(group_level)
    if kind == "edges":
        return rec.edges_csv(group_level)
    if kind == "departures":
        return rec.departures_csv(_cfg.dt_seconds, _cfg.warmup_steps, _cfg.export.aggregate_steps, group_level)
    if kind == "timeseries":
        return rec.timeseries_csv(
            _cfg.dt_seconds, _cfg.warmup_steps,
            _cfg.export.aggregate_steps, _cfg.export.aggregate_method,
            group_level=group_level,
        )
    raise ValueError(f"알 수 없는 CSV 종류(kind): {kind!r} — {_CSV_KINDS} 중 하나여야 합니다.")


def export_csv(kind: str = "timeseries", level: str = "") -> str:
    """단일 CSV. level: ""(설정 따름) | "node" | "group"."""
    assert _sim is not None and _cfg is not None
    return _csv_for(kind, _level_flag(level))


def export_npz(level: str = "") -> bytes:
    """단일 X.npz. level: ""(설정 따름) | "node" | "group"."""
    assert _sim is not None and _cfg is not None
    return _sim.recorder.npz_bytes(_cfg, group_level=_level_flag(level))


# 번들에 담는 GNN 파일 세트(연결성=edges, 거리·시간=edges 의 distance/tau, 피처=timeseries/X.npz)
_BUNDLE_README = (
    "철도역사 혼잡도 합성데이터 번들\n"
    "================================\n\n"
    "node/  : 노드 단위(양방향 2노드를 각각 개별 노드로) GNN 구성 파일\n"
    "group/ : 물리 그룹 단위(양방향 2노드를 하나의 물리 장소로 합산) GNN 구성 파일\n\n"
    "각 폴더 공통 파일:\n"
    "  nodes.csv       : 노드 목록(id,name,kind,group,direction,area,x,y)\n"
    "  edges.csv       : 연결성+거리+소요시간(src_id,dst_id,weight,distance,tau)\n"
    "  timeseries.csv  : 혼잡도 시계열(step,time_sec,node_id,count,density,inflow,outflow,p_stay)\n"
    "  departures.csv  : 시스템 밖 유출(출입구 퇴장/승강장 탑승)\n"
    "  X.npz           : STGCN 직결 텐서 X[T,N,F] + adjacency + edge_index + edge_attr + 메타\n\n"
    "config.json : 재현용 전체 설정(같은 config+시드 → 동일 결과)\n\n"
    "노드 단위와 그룹 단위는 같은 시뮬 결과를 서로 다른 그래프 해상도로 집계한 것입니다.\n"
    "물리 그룹이 정의돼 있지 않으면 두 폴더의 내용은 동일합니다.\n"
)


_BATCH_README = (
    "철도역사 혼잡도 합성데이터 — 대량(다중 시드) 데이터셋\n"
    "=====================================================\n\n"
    "그래프 구조는 반복 횟수 N 과 무관하게 동일하므로 '1번'만, 혼잡도는 시드별로 'N개' 저장합니다.\n\n"
    "[공유 그래프 — 1회]\n"
    "  nodes.csv : 노드 목록(id,name,kind,group,direction,area,x,y)\n"
    "  edges.csv : 연결성+거리+소요시간(src_id,dst_id,weight,distance,tau)\n"
    "  X_all.npz 안의 adjacency/edge_index/edge_attr 도 그래프(1회분).\n\n"
    "[시드별 혼잡도 — N개]\n"
    "  runs/run_XXXX.csv : 시드 XXXX 의 혼잡도 시계열(step,time_sec,node_id,count,density,inflow,outflow,p_stay).\n\n"
    "[AI 모델 직결 — 1개]\n"
    "  X_all.npz : X_all[R,T,N,F](R=실행 수, 시드별 특징 텐서를 쌓음) + seeds + channels\n"
    "              + 공유 그래프(adjacency/edge_index/edge_attr/node 메타). 그래프는 1회만 저장.\n\n"
    "config.json  : 재현용 설정. manifest.json : num_runs/seeds/output_level/x_all_shape 등.\n\n"
    "활용: run(시드) 단위로 train/val/test 를 나누면 같은 시나리오의 시간조각이 섞이는 누설을 막습니다.\n"
    "      ml/dataset.py 의 build_dataset_from_stack('X_all.npz') 로 바로 학습 데이터를 만들 수 있습니다.\n"
)

# ── 대량(다중 시드) 데이터셋 생성 — 그래프 1회 + 혼잡도 CSV N개 + 스택 텐서 X_all ──
_batch = None


def batch_prepare(num_runs, seed_start: int = 0, level: str = "") -> str:
    """대량 생성을 시작한다(ZIP 버퍼 초기화). 이후 batch_run_one 을 num 회 호출."""
    global _batch
    assert _cfg is not None
    import zipfile
    gl = _level_flag(level)
    buf = io.BytesIO()
    zf = zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED)
    n = max(1, int(num_runs))
    _batch = {"num": n, "seed0": int(seed_start), "gl": gl, "buf": buf, "zf": zf,
              "i": 0, "seeds": [], "X": [], "channels": None, "graph": None,
              "step0": None, "level": None}
    return json.dumps({"num": n, "seed_start": int(seed_start)})


def batch_run_one() -> str:
    """다음 시드로 1회 시뮬을 실행 — 혼잡도 시계열 CSV 추가 + 특징 텐서 적재(그래프는 1회만)."""
    global _batch
    assert _batch is not None and _cfg is not None
    b = _batch
    seed = b["seed0"] + b["i"]
    cfg = SimConfig.from_dict(_cfg.to_dict())   # 시드만 바꾼 독립 실현
    cfg.seed = seed
    exp = cfg.export
    channels = list(exp.feature_channels) or ["count"]
    sim = Simulator(cfg)
    rec = sim.run()
    # 혼잡도 시계열 CSV(시드별 N개)
    b["zf"].writestr("runs/run_%04d.csv" % seed, "﻿" + rec.timeseries_csv(
        cfg.dt_seconds, cfg.warmup_steps, exp.aggregate_steps, exp.aggregate_method, group_level=b["gl"]))
    # 특징 텐서(스택용) — npz_bytes 와 동일 설정으로 산출
    X, names, step0 = rec.feature_tensor(
        channels, aggregate_steps=exp.aggregate_steps, aggregate_method=exp.aggregate_method,
        warmup=cfg.warmup_steps, noise_enabled=exp.noise_enabled, noise_model=exp.noise_model,
        noise_sigma=exp.noise_sigma, seed=cfg.seed + 999, group_level=b["gl"])
    b["X"].append(X.astype(np.float32))
    if b["i"] == 0:
        # 시드와 무관한 공유 그래프·설정·채널은 1회만 기록
        b["zf"].writestr("nodes.csv", "﻿" + rec.nodes_csv(b["gl"]))
        b["zf"].writestr("edges.csv", "﻿" + rec.edges_csv(b["gl"]))
        b["zf"].writestr("config.json", _cfg.to_json())
        b["graph"] = rec.graph_arrays(b["gl"])
        b["channels"] = list(names)
        b["step0"] = step0.astype(np.int64)
        b["level"] = "group" if (rec.model.has_grouping and b["gl"]) else "node"
    b["seeds"].append(seed)
    b["i"] += 1
    return json.dumps({"done": b["i"], "total": b["num"], "seed": seed})


def batch_finish() -> bytes:
    """대량 생성 마감 — 스택 텐서 X_all.npz(그래프 1회) + manifest/README 후 bytes 반환."""
    global _batch
    import zipfile
    assert _batch is not None and _cfg is not None
    b = _batch
    X_all = np.stack(b["X"], axis=0)  # [R, T, N, F]
    payload = dict(
        X_all=X_all,
        seeds=np.array(b["seeds"], dtype=np.int64),
        channels=np.array(b["channels"]),
        step_index=b["step0"],
        dt_seconds=np.array(_cfg.dt_seconds),
        start_time_sec=np.array(_cfg.start_time_sec),
        aggregate_steps=np.array(_cfg.export.aggregate_steps),
        **b["graph"],  # adjacency/edge_index/edge_attr/node 메타(1회분)
    )
    npz_buf = io.BytesIO()
    np.savez_compressed(npz_buf, **payload)
    b["zf"].writestr(zipfile.ZipInfo("X_all.npz"), npz_buf.getvalue(), compress_type=zipfile.ZIP_STORED)
    manifest = {
        "num_runs": b["num"],
        "seeds": b["seeds"],
        "output_level": b["level"],
        "channels": b["channels"],
        "x_all_shape": list(X_all.shape),       # [R, T, N, F]
        "aggregate_steps": _cfg.export.aggregate_steps,
        "total_steps": _cfg.total_steps,
        "files": {
            "graph": ["nodes.csv", "edges.csv", "X_all.npz(adjacency 등)"],
            "congestion_per_run": "runs/run_XXXX.csv (시드별 N개)",
            "ai_tensor": "X_all.npz (X_all[R,T,N,F] + 공유 그래프)",
        },
        "note": "그래프는 1회, 혼잡도는 시드별 N개. AI 모델 학습 시 run(시드) 단위 분할 권장.",
    }
    b["zf"].writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    b["zf"].writestr("README.txt", _BATCH_README)
    b["zf"].close()
    data = b["buf"].getvalue()
    _batch = None
    return data


def export_bundle() -> bytes:
    """노드 단위 + 물리 그룹 단위 GNN 파일을 한 번에 담은 ZIP bytes.

    node/ 와 group/ 두 폴더에 각각 nodes/edges/timeseries/departures CSV 와 X.npz 를 만들고,
    재현용 config.json, 설명 README.txt 를 포함한다. 사용자가 출력 단위를 고르지 않아도
    두 해상도(노드별·그룹별)의 GNN 구성 파일을 동시에 확보할 수 있다.
    """
    assert _sim is not None and _cfg is not None
    import zipfile

    rec = _sim.recorder
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for folder, gl in (("node", False), ("group", True)):
            z.writestr(f"{folder}/nodes.csv", "﻿" + _csv_for("nodes", gl))
            z.writestr(f"{folder}/edges.csv", "﻿" + _csv_for("edges", gl))
            z.writestr(f"{folder}/timeseries.csv", "﻿" + _csv_for("timeseries", gl))
            z.writestr(f"{folder}/departures.csv", "﻿" + _csv_for("departures", gl))
            # X.npz 는 이미 np.savez_compressed 로 압축돼 있으므로 ZIP 은 무압축 저장(이중압축 회피)
            z.writestr(zipfile.ZipInfo(f"{folder}/X.npz"), rec.npz_bytes(_cfg, group_level=gl),
                       compress_type=zipfile.ZIP_STORED)
        z.writestr("config.json", _cfg.to_json())
        z.writestr("README.txt", _BUNDLE_README)
    return buf.getvalue()
