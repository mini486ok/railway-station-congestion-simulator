"""명령행 실행 진입점 (네이티브 CPython).

사용 예:
    python cli.py examples/sample_station.json --out out/run1
    python cli.py examples/sample_station.json --out out/corpus --batch-seeds 0 1 2 3 4

설정 JSON 을 읽어 시뮬레이션을 실행하고, STGCN 학습용 데이터셋을 내보낸다:
    nodes.csv, edges.csv, timeseries.csv, departures.csv, X.npz, config.json
"""
from __future__ import annotations

import argparse
import json
import os
from typing import List

from engine.config import SimConfig
from engine.simulator import Simulator
from engine.validate import validate_config


def _write(path: str, data) -> None:
    mode = "wb" if isinstance(data, (bytes, bytearray)) else "w"
    enc = None if isinstance(data, (bytes, bytearray)) else "utf-8"
    with open(path, mode, encoding=enc) as f:
        f.write(data)


def export_run(cfg: SimConfig, out_dir: str) -> dict:
    os.makedirs(out_dir, exist_ok=True)
    sim = Simulator(cfg)
    rec = sim.run()
    group_level = (cfg.export.output_level != "node")  # 노드별/물리 그룹별 출력 단위

    _write(os.path.join(out_dir, "nodes.csv"), rec.nodes_csv(group_level))
    _write(os.path.join(out_dir, "edges.csv"), rec.edges_csv(group_level))
    _write(os.path.join(out_dir, "timeseries.csv"),
           rec.timeseries_csv(cfg.dt_seconds, cfg.warmup_steps,
                              cfg.export.aggregate_steps, cfg.export.aggregate_method,
                              group_level=group_level))
    _write(os.path.join(out_dir, "departures.csv"),
           rec.departures_csv(cfg.dt_seconds, cfg.warmup_steps, cfg.export.aggregate_steps, group_level))
    _write(os.path.join(out_dir, "X.npz"), rec.npz_bytes(cfg))
    _write(os.path.join(out_dir, "config.json"), cfg.to_json())

    summary = {
        "out_dir": out_dir,
        "n_real": sim.model.n_real,
        "n_links": int(sim.model.src.size),
        "total_steps": cfg.total_steps,
        "final_total_in_station": float(sim.N[sim.model.real_mask].sum()),
        "cumulative_generated": sim.cumulative_generated,
        "cumulative_egress": float(sim.N[~sim.model.real_mask].sum()),
        "warnings": sim.model.warnings,
    }
    _write(os.path.join(out_dir, "summary.json"),
           json.dumps(summary, ensure_ascii=False, indent=2))
    return summary


def main(argv: List[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="철도역사 혼잡도 시뮬레이터 CLI")
    ap.add_argument("config", help="설정 JSON 경로")
    ap.add_argument("--out", default="out/run", help="출력 디렉터리")
    ap.add_argument("--seed", type=int, default=None, help="시드 오버라이드")
    ap.add_argument("--total-steps", type=int, default=None, help="총 스텝 오버라이드")
    ap.add_argument("--batch-seeds", type=int, nargs="*", default=None,
                    help="여러 시드로 배치 생성(코퍼스)")
    args = ap.parse_args(argv)

    with open(args.config, encoding="utf-8") as f:
        cfg = SimConfig.from_json(f.read())
    if args.seed is not None:
        cfg.seed = args.seed
    if args.total_steps is not None:
        cfg.total_steps = args.total_steps

    v = validate_config(cfg)
    if v["warnings"]:
        print("[경고]")
        for w in v["warnings"]:
            print("  -", w)
    if not v["ok"]:
        print("[오류] 설정이 유효하지 않습니다:")
        for e in v["errors"]:
            print("  -", e)
        return 1

    if args.batch_seeds:
        for s in args.batch_seeds:
            cfg.seed = s
            summary = export_run(cfg, os.path.join(args.out, f"seed_{s}"))
            print(f"[완료] seed={s} → {summary['out_dir']} "
                  f"(역사 잔류 {summary['final_total_in_station']:.0f}명, "
                  f"누적유입 {summary['cumulative_generated']:.0f}, "
                  f"누적유출 {summary['cumulative_egress']:.0f})")
    else:
        summary = export_run(cfg, args.out)
        print(f"[완료] → {summary['out_dir']}")
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
