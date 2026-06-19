"""자체발생(source) 및 열차 하차 인원 샘플링.

- 출입구: Poisson / Normal / Constant 분포 + 하루 시간대 프로파일(러시아워) 배율.
- 승강장: 열차 도착 시점의 하차(alight) 버스트 = 일시 유입.

모든 샘플은 시뮬레이터가 넘겨주는 ``rng`` (numpy Generator)로 추출하여 재현성을 보장한다.
"""
from __future__ import annotations

import numpy as np

from .config import DemandProfile, SourceSpec, TrainArrival


def hour_of_day(step: int, dt_seconds: float, start_time_sec: float) -> float:
    """스텝 -> 하루 중 시각(0~24h)."""
    sec = start_time_sec + step * dt_seconds
    return (sec / 3600.0) % 24.0


def profile_factor(profile: DemandProfile | None, hour: float) -> float:
    """시간대 프로파일 배율(키포인트 선형보간, 24h 주기). 프로파일 없으면 1.0."""
    if profile is None or not profile.hours:
        return 1.0
    hrs = np.asarray(profile.hours, dtype=np.float64)
    mul = np.asarray(profile.multipliers, dtype=np.float64)
    order = np.argsort(hrs)
    hrs = hrs[order]
    mul = mul[order]
    return float(np.interp(hour % 24.0, hrs, mul, period=24.0))


def sample_source(spec: SourceSpec, hour: float, rng: np.random.Generator, gfactor: float = 1.0) -> float:
    """한 스텝의 자체발생 유입 인원(>=0). gfactor: 전역 수요 배율(일간변동·공통요인)."""
    if spec is None or spec.type == "none":
        return 0.0
    factor = profile_factor(spec.profile, hour) * gfactor
    mean = max(0.0, spec.rate * factor)
    if mean <= 0.0:
        return 0.0
    if spec.type == "poisson":
        return float(rng.poisson(mean))
    if spec.type == "normal":
        return float(max(0.0, rng.normal(mean, spec.sigma)))
    if spec.type == "constant":
        return float(mean)
    # 알 수 없는 타입: 평균값 사용
    return float(mean)


def sample_alight(train: TrainArrival, rng: np.random.Generator) -> float:
    """열차 도착 시 하차 인원(>=0)."""
    mean = max(0.0, train.alight_mean)
    if mean <= 0.0:
        return 0.0
    dist = train.alight_dist
    if dist == "poisson":
        return float(rng.poisson(mean))
    if dist == "normal":
        return float(max(0.0, rng.normal(mean, train.alight_sigma)))
    if dist == "constant":
        return float(mean)
    return float(mean)
