"""Pyodide(브라우저) ↔ JS 경계 모듈.

JS(Web Worker)는 config 를 JSON 문자열로 넘기고, 결과는 JSON 문자열(dict 류) 또는
bytes(npz)/str(csv) 로 받는다. 변환 복잡도를 줄이기 위해 dict 결과는 모두 json.dumps 한다.
이 모듈은 브라우저 전용이 아니며 순수 Python 이라 네이티브에서도 import 가능하다.
"""
from __future__ import annotations

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


def export_csv(kind: str = "timeseries") -> str:
    assert _sim is not None and _cfg is not None
    rec = _sim.recorder
    group_level = (_cfg.export.output_level != "node")
    if kind == "nodes":
        return rec.nodes_csv(group_level)
    if kind == "edges":
        return rec.edges_csv(group_level)
    if kind == "departures":
        return rec.departures_csv(_cfg.dt_seconds, _cfg.warmup_steps, _cfg.export.aggregate_steps, group_level)
    return rec.timeseries_csv(
        _cfg.dt_seconds, _cfg.warmup_steps,
        _cfg.export.aggregate_steps, _cfg.export.aggregate_method,
        group_level=group_level,
    )


def export_npz() -> bytes:
    assert _sim is not None and _cfg is not None
    return _sim.recorder.npz_bytes(_cfg)
