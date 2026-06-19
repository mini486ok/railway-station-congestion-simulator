"""밀도-속력 기본도(fundamental diagram) -> 동적 체류확률.

혼잡(밀도↑) → 보행속력↓ → 노드 체류시간↑ 을 물리적으로 반영한다.
Weidmann(1993) 식을 사용:

    v(ρ) = v0 · (1 − exp(−γ·(1/ρ − 1/ρ_max)))      # ρ: 밀도(인/m^2)

속력비 s(ρ)=v/v0 ∈ (0,1] 로 체류확률을 보간:

    P_stay = clip( 1 − (1 − P_stay_base)·s(ρ),  P_stay_base,  cap )

    - ρ→0   : s→1 → P_stay = base (정적 설정값)
    - ρ→ρ_max: s→0 → P_stay → cap (정체)

진동/락업 방지를 위해 1차 저역통과(LPF)로 관성을 준다.
"""
from __future__ import annotations

import numpy as np

from .config import DynamicsConfig


def speed_ratio(density: np.ndarray, cfg: DynamicsConfig) -> np.ndarray:
    """밀도 -> 속력비 s=v/v0 ∈ [0,1]. 밀도 0 이면 1(자유보행)."""
    rho = np.asarray(density, dtype=np.float64)
    rho_max = cfg.rho_max if cfg.rho_max > 1e-9 else 5.4  # 0/음수 방어(검증 우회 시 크래시 방지)
    inv = np.where(rho > 1e-9, 1.0 / np.maximum(rho, 1e-9), np.inf)
    # v/v0 = 1 − exp(−γ·(1/ρ − 1/ρ_max))
    expo = -cfg.gamma * (inv - 1.0 / rho_max)
    s = 1.0 - np.exp(expo)
    return np.clip(s, 0.0, 1.0)


def density_to_pstay(
    N: np.ndarray,
    area: np.ndarray,
    p_stay_base: np.ndarray,
    dynamic_mask: np.ndarray,
    cfg: DynamicsConfig,
    prev_pstay: np.ndarray | None = None,
) -> np.ndarray:
    """현재 인원/면적 -> 갱신된 체류확률 벡터.

    dynamic_mask 가 False 인 노드는 base 를 유지(sink 는 base=1).
    prev_pstay 가 주어지면 LPF 로 관성 적용.
    """
    rho = N / area
    s = speed_ratio(rho, cfg)
    target = 1.0 - (1.0 - p_stay_base) * s
    target = np.clip(target, p_stay_base, cfg.p_stay_cap)

    # 비동적 노드는 base 유지
    out = np.where(dynamic_mask, target, p_stay_base)

    if prev_pstay is not None and cfg.lpf_alpha > 0.0:
        a = cfg.lpf_alpha
        lpf = a * prev_pstay + (1.0 - a) * out
        out = np.where(dynamic_mask, lpf, p_stay_base)
    return out
