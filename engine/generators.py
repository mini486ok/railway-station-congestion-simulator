"""자체발생(source) 및 열차 하차 인원 샘플링.

- 출입구: 여러 분포(아래) + 하루 시간대 프로파일(러시아워) 배율.
- 승강장: 열차 도착 시점의 하차(alight) 버스트 = 일시 유입.

지원 분포(``_sample_count``):
    poisson            : 무작위 도착 카운트(분산=평균). 도착 모델 표준.
    normal             : 연속 정규(평균 μ, 표준편차 σ), 음수 클립.
    constant           : 결정적(평균값 그대로).
    negative_binomial  : 과분산 정수 카운트(분산 σ²>μ). 실제 대중교통 도착의 군집/변동.
    uniform            : 균등 U(μ−σ, μ+σ), 음수 클립.
    lognormal          : 우편향(버스트성) 양수. 평균≈μ.

모든 샘플은 시뮬레이터가 넘겨주는 ``rng`` (numpy Generator)로 추출하여 재현성을 보장한다.
"""
from __future__ import annotations

import math

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


def _sample_count(dist: str, mean: float, sigma: float, rng: np.random.Generator) -> float:
    """분포별 한 스텝 인원 샘플(>=0). mean>0 가정(호출부에서 mean<=0 처리)."""
    if dist == "poisson":
        return float(rng.poisson(mean))
    if dist == "normal":
        return float(max(0.0, rng.normal(mean, sigma)))
    if dist == "constant":
        return float(mean)
    if dist == "uniform":
        low = max(0.0, mean - sigma)
        high = mean + sigma
        return float(low) if high <= low else float(rng.uniform(low, high))
    if dist == "lognormal":
        s = sigma if sigma > 0 else 0.5
        mu = math.log(mean) - 0.5 * s * s          # E[X]=mean 이 되도록 보정
        return float(rng.lognormal(mu, s))
    if dist in ("negative_binomial", "negbin", "nb"):
        var = sigma * sigma
        if sigma <= 0.0 or var <= mean:            # 과분산이 아니면 푸아송으로 안전 대체
            return float(rng.poisson(mean))
        r = mean * mean / (var - mean)             # size; 분산 = μ + μ²/r
        p = r / (r + mean)
        return float(rng.negative_binomial(r, p))
    # 알 수 없는 타입: 평균값 사용
    return float(mean)


def sample_source(spec: SourceSpec, hour: float, rng: np.random.Generator, gfactor: float = 1.0) -> float:
    """한 스텝의 자체발생 유입 인원(>=0). gfactor: 전역 수요 배율(일간변동·공통요인)."""
    if spec is None or spec.type == "none":
        return 0.0
    factor = profile_factor(spec.profile, hour) * gfactor
    mean = max(0.0, spec.rate * factor)
    if mean <= 0.0:
        return 0.0
    return _sample_count(spec.type, mean, spec.sigma, rng)


def sample_alight(train: TrainArrival, rng: np.random.Generator) -> float:
    """열차 도착 시 하차 인원(>=0). 출입구와 동일한 분포 집합 사용."""
    mean = max(0.0, train.alight_mean)
    if mean <= 0.0:
        return 0.0
    return _sample_count(train.alight_dist, mean, train.alight_sigma, rng)
