"""정수 인원 모드용 유틸 (기본은 연속 float64 유체 근사).

기본 모델은 연속 실수지만, 실제 인원수처럼 정수가 필요하면 유출(flow) 단계에서
multinomial 분배로 정수화하여 **인원 보존을 정확히 유지**한다.
"""
from __future__ import annotations

import numpy as np


def stochastic_round(x: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """불편(unbiased) 확률적 반올림: E[round(x)] = x."""
    x = np.asarray(x, dtype=np.float64)
    floor = np.floor(x)
    frac = x - floor
    return floor + (rng.random(x.shape) < frac).astype(np.float64)


def multinomial_split(total_int: int, weights: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """정수 total 을 weights(합=1) 비율로 정수 분배(합 보존)."""
    if total_int <= 0 or weights.size == 0:
        return np.zeros(weights.shape, dtype=np.float64)
    w = np.asarray(weights, dtype=np.float64)
    sw = w.sum()
    if sw <= 0:
        return np.zeros(weights.shape, dtype=np.float64)
    return rng.multinomial(int(total_int), w / sw).astype(np.float64)
