"""런타임/설정 불변식 검증 및 보존 모니터.

테스트와 프론트엔드 검증에서 공용으로 사용한다.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List

import numpy as np

from .config import SimConfig
from .model import Model, build_model


def _finite(x) -> bool:
    try:
        return math.isfinite(float(x))
    except (TypeError, ValueError):
        return False


def validate_params(cfg: SimConfig) -> List[str]:
    """모든 수치 파라미터의 범위·유한성(NaN/Inf 거부)을 검사. 위반 메시지 리스트."""
    errs: List[str] = []

    def chk(cond: bool, msg: str) -> None:
        if not cond:
            errs.append(msg)

    # 시뮬 파라미터
    chk(_finite(cfg.dt_seconds) and cfg.dt_seconds > 0, "dt_seconds 는 0보다 큰 유한수여야 합니다")
    chk(int(cfg.total_steps) >= 1, "total_steps 는 1 이상이어야 합니다")
    chk(0 <= cfg.warmup_steps < max(1, cfg.total_steps), "warmup_steps 는 0 이상 total_steps 미만이어야 합니다")
    chk(_finite(cfg.start_time_sec), "start_time_sec 가 유한수여야 합니다")

    # 동역학
    d = cfg.dynamics
    chk(_finite(d.lpf_alpha) and 0.0 <= d.lpf_alpha <= 1.0, "dynamics.lpf_alpha 는 [0,1] 이어야 합니다")
    chk(_finite(d.rho_max) and d.rho_max > 0, "dynamics.rho_max 는 0보다 커야 합니다")
    chk(_finite(d.rho_cap) and d.rho_cap > 0, "dynamics.rho_cap 는 0보다 커야 합니다")
    chk(_finite(d.gamma) and d.gamma > 0, "dynamics.gamma 는 0보다 커야 합니다")
    chk(_finite(d.p_stay_cap) and 0.0 <= d.p_stay_cap <= 1.0, "dynamics.p_stay_cap 는 [0,1] 이어야 합니다")
    chk(_finite(d.v0_default) and d.v0_default > 0, "dynamics.v0_default 는 0보다 커야 합니다")

    # export
    e = cfg.export
    chk(int(e.aggregate_steps) >= 1, "export.aggregate_steps 는 1 이상이어야 합니다")
    chk(int(e.aggregate_steps) <= int(cfg.total_steps) + 1, "export.aggregate_steps 는 total_steps 이하여야 합니다(시간축 오염 방지)")
    chk(e.aggregate_method in ("mean", "snapshot"), "export.aggregate_method 는 mean 또는 snapshot 이어야 합니다(상태량 합산 방지)")
    chk(_finite(e.noise_sigma) and e.noise_sigma >= 0, "export.noise_sigma 는 0 이상 유한수여야 합니다")

    # 수요 다양성
    dm = cfg.demand
    chk(_finite(dm.day_variability_sigma) and dm.day_variability_sigma >= 0, "demand.day_variability_sigma 는 0 이상이어야 합니다")
    chk(_finite(dm.common_factor_phi) and 0 <= dm.common_factor_phi < 1, "demand.common_factor_phi 는 [0,1) 이어야 합니다")
    chk(_finite(dm.common_factor_sigma) and dm.common_factor_sigma >= 0, "demand.common_factor_sigma 는 0 이상이어야 합니다")

    # 노드
    for n in cfg.nodes:
        tag = f"노드 {n.id!r}"
        chk(_finite(n.area) and n.area > 0, f"{tag} area 는 0보다 커야 합니다")
        chk(_finite(n.p_stay_base) and 0.0 <= n.p_stay_base <= 1.0, f"{tag} p_stay_base 는 [0,1] 이어야 합니다")
        chk(_finite(n.exit_weight) and 0.0 <= n.exit_weight <= 1.0, f"{tag} exit_weight 는 [0,1] 이어야 합니다")
        chk(_finite(n.n0) and n.n0 >= 0, f"{tag} n0 는 0 이상이어야 합니다")
        chk(_finite(n.throughput_cap) and n.throughput_cap >= 0, f"{tag} throughput_cap 는 0 이상이어야 합니다")
        chk(_finite(n.elevator_capacity) and n.elevator_capacity >= 0, f"{tag} elevator_capacity 는 0 이상이어야 합니다")
        chk(int(n.elevator_cycle) >= 0, f"{tag} elevator_cycle 는 0 이상이어야 합니다")
        if n.v0 is not None:
            chk(_finite(n.v0) and n.v0 > 0, f"{tag} v0 는 0보다 커야 합니다")
        if n.source is not None:
            chk(_finite(n.source.rate) and n.source.rate >= 0, f"{tag} source.rate 는 0 이상이어야 합니다")
            chk(_finite(n.source.sigma) and n.source.sigma >= 0, f"{tag} source.sigma 는 0 이상이어야 합니다")
            pr = n.source.profile
            if pr is not None:
                chk(len(pr.hours) == len(pr.multipliers) and len(pr.hours) >= 1,
                    f"{tag} source.profile 의 hours/multipliers 길이가 같고 1 이상이어야 합니다")
                chk(all(_finite(h) for h in pr.hours) and all(_finite(mm) and mm >= 0 for mm in pr.multipliers),
                    f"{tag} source.profile 값은 유한·음수가 아니어야 합니다")
        chk(n.platform_role in ("both", "alight", "board"),
            f"{tag} platform_role 는 both/alight/board 중 하나여야 합니다")
        for ti, t in enumerate(n.trains):
            tt = f"{tag} 열차#{ti}"
            chk(int(t.t_arrival) >= 0, f"{tt} t_arrival 는 0 이상이어야 합니다")
            chk(_finite(t.alight_mean) and t.alight_mean >= 0, f"{tt} alight_mean 는 0 이상이어야 합니다")
            chk(_finite(t.alight_sigma) and t.alight_sigma >= 0, f"{tt} alight_sigma 는 0 이상이어야 합니다")
            chk(int(t.dwell_steps) >= 1, f"{tt} dwell_steps 는 1 이상이어야 합니다")
            chk(_finite(t.train_capacity) and t.train_capacity >= 0, f"{tt} train_capacity 는 0 이상이어야 합니다")
            chk(_finite(t.board_cap) and t.board_cap >= 0, f"{tt} board_cap 는 0 이상이어야 합니다")
            chk(_finite(t.delay_std) and t.delay_std >= 0, f"{tt} delay_std 는 0 이상이어야 합니다")
            ob = getattr(t, "onboard_load", 0.0)
            chk(_finite(ob) and 0 <= ob <= max(0.0, t.train_capacity), f"{tt} onboard_load 는 [0, train_capacity] 이어야 합니다")
        ts = n.train_schedule
        if ts is not None:
            st = f"{tag} 열차 스케줄"
            chk(int(ts.first_arrival) >= 0, f"{st} 첫 도착(first_arrival)은 0 이상이어야 합니다")
            chk(int(ts.headway) >= 0, f"{st} 배차간격(headway)은 0 이상이어야 합니다")
            chk(int(ts.num_trains) >= 0, f"{st} 운행 대수(num_trains)는 0 이상이어야 합니다")
            chk(_finite(ts.alight_mean) and ts.alight_mean >= 0, f"{st} alight_mean 는 0 이상이어야 합니다")
            chk(_finite(ts.alight_sigma) and ts.alight_sigma >= 0, f"{st} alight_sigma 는 0 이상이어야 합니다")
            chk(int(ts.dwell_steps) >= 1, f"{st} dwell_steps 는 1 이상이어야 합니다")
            chk(_finite(ts.train_capacity) and ts.train_capacity >= 0, f"{st} train_capacity 는 0 이상이어야 합니다")
            chk(_finite(ts.board_cap) and ts.board_cap >= 0, f"{st} board_cap 는 0 이상이어야 합니다")
            chk(_finite(ts.delay_std) and ts.delay_std >= 0, f"{st} delay_std 는 0 이상이어야 합니다")
            chk(_finite(ts.onboard_load) and 0 <= ts.onboard_load <= max(0.0, ts.train_capacity),
                f"{st} onboard_load 는 [0, train_capacity] 이어야 합니다")

    # 링크
    tau_max = max(1, int(cfg.total_steps))
    for l in cfg.links:
        tag = f"링크 {l.src!r}->{l.dst!r}"
        chk(_finite(l.distance) and 0 < l.distance <= 1e6, f"{tag} distance 는 0 초과 1e6 이하여야 합니다")
        chk(_finite(l.weight) and l.weight >= 0, f"{tag} weight 는 0 이상이어야 합니다")
        if l.tau is not None:
            chk(1 <= int(l.tau) <= tau_max, f"{tag} tau 는 1 이상 total_steps 이하여야 합니다")

    return errs


def output_weight_sums(model: Model) -> Dict[int, float]:
    """src 노드별 출력 링크 가중치 합(sink 링크 포함)."""
    sums: Dict[int, float] = {}
    for li in range(model.src.size):
        s = int(model.src[li])
        sums[s] = sums.get(s, 0.0) + float(model.weight[li])
    return sums


def check_model_invariants(model: Model, tol: float = 1e-9) -> List[str]:
    """모델 빌드 결과의 정적 불변식 검사. 위반 메시지 리스트 반환(빈 리스트=정상)."""
    problems: List[str] = []

    # 출력 가중치 합 = 1 (출력처가 있는 노드)
    for s, total in output_weight_sums(model).items():
        if abs(total - 1.0) > 1e-6:
            problems.append(f"노드 idx {s} 출력 가중치 합 {total:.6f} != 1")

    # 확률 범위
    if np.any(model.p_stay_base < -tol) or np.any(model.p_stay_base > 1.0 + tol):
        problems.append("p_stay_base 가 [0,1] 범위를 벗어남")

    # 가중치 음수 금지
    if model.weight.size and float(model.weight.min()) < 0.0:
        problems.append("음수 링크 가중치 존재")

    # tau >= 1
    if model.tau.size and int(model.tau.min()) < 1:
        problems.append("tau < 1 인 링크 존재(τ_min=1 위반)")

    # sink 는 출력 링크가 없어야 함
    sink_srcs = set(int(s) for s in model.src.tolist()) & set(np.where(model.is_sink)[0].tolist())
    if sink_srcs:
        problems.append(f"sink 노드에서 나가는 링크 존재: {sink_srcs}")

    return problems


def validate_config(cfg: SimConfig) -> Dict[str, Any]:
    """설정을 빌드해 구조적 유효성 + 경고를 반환(프론트 검증 표시용)."""
    result: Dict[str, Any] = {"ok": True, "errors": [], "warnings": []}
    perrs = validate_params(cfg)
    if perrs:
        result["ok"] = False
        result["errors"].extend(perrs)
    try:
        model = build_model(cfg)
    except Exception as e:  # noqa: BLE001
        result["ok"] = False
        result["errors"].append(str(e))
        return result
    result["warnings"].extend(model.warnings)
    problems = check_model_invariants(model)
    if problems:
        result["ok"] = False
        result["errors"].extend(problems)
    result["n_real"] = model.n_real
    result["n_links"] = int(model.src.size)
    result["max_tau"] = model.max_tau
    return result


def conservation_residual(sim) -> float:
    """전체 인원 + in-transit − (초기 + 누적 생성)의 절댓값(0에 가까워야 함)."""
    initial = float(sim.model.N0.sum())
    return abs(sim.total_mass() - (initial + sim.cumulative_generated))
