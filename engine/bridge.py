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
    "runs/run_XXXX.npz : 시드(XXXX)만 다른 독립 실현(run). 각 파일은 X[T,N,F]+adjacency+\n"
    "                    edge_index+edge_attr+정규화통계+메타를 담은 AI 모델 직결 텐서.\n"
    "nodes.csv, edges.csv : 모든 run 공통 그래프 구조(시드와 무관).\n"
    "config.json  : 재현용 설정(seed 는 manifest 의 seeds 참고).\n"
    "manifest.json: num_runs, seeds, output_level, channels 등.\n\n"
    "활용: 여러 run 을 하나의 코퍼스로 모아 run 단위로 train/val/test 를 나누면\n"
    "      같은 시나리오의 시간조각이 학습/평가에 섞이는 누설을 막을 수 있습니다.\n"
)

# ── 대량(다중 시드) 데이터셋 생성 — N회 실행을 한 ZIP 으로 ──
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
    _batch = {"num": n, "seed0": int(seed_start), "gl": gl,
              "buf": buf, "zf": zf, "i": 0, "seeds": [], "level": None}
    return json.dumps({"num": n, "seed_start": int(seed_start)})


def batch_run_one() -> str:
    """다음 시드로 1회 시뮬을 실행하고 runs/run_{seed}.npz 를 ZIP 에 추가."""
    global _batch
    assert _batch is not None and _cfg is not None
    import zipfile
    b = _batch
    seed = b["seed0"] + b["i"]
    cfg = SimConfig.from_dict(_cfg.to_dict())   # 시드만 바꾼 독립 실현
    cfg.seed = seed
    sim = Simulator(cfg)
    rec = sim.run()
    if b["i"] == 0:
        # 시드와 무관한 공유 그래프·설정은 1회만 기록
        b["zf"].writestr("nodes.csv", "﻿" + rec.nodes_csv(b["gl"]))
        b["zf"].writestr("edges.csv", "﻿" + rec.edges_csv(b["gl"]))
        b["zf"].writestr("config.json", _cfg.to_json())
        b["level"] = "group" if (rec.model.has_grouping and b["gl"]) else "node"
    b["zf"].writestr(zipfile.ZipInfo("runs/run_%04d.npz" % seed),
                     rec.npz_bytes(cfg, group_level=b["gl"]), compress_type=zipfile.ZIP_STORED)
    b["seeds"].append(seed)
    b["i"] += 1
    return json.dumps({"done": b["i"], "total": b["num"], "seed": seed})


def batch_finish() -> bytes:
    """대량 생성 ZIP 을 마감(manifest/README 추가) 후 bytes 반환."""
    global _batch
    assert _batch is not None and _cfg is not None
    b = _batch
    manifest = {
        "num_runs": b["num"],
        "seeds": b["seeds"],
        "output_level": b["level"],
        "channels": list(_cfg.export.feature_channels),
        "aggregate_steps": _cfg.export.aggregate_steps,
        "total_steps": _cfg.total_steps,
        "note": "각 runs/run_XXXX.npz 는 시드만 다른 독립 실현(run). AI 모델 학습 시 run 단위 분할 권장.",
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
