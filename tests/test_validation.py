"""설정 파라미터 검증(NaN/Inf·범위·상태량 합산 방지) 회귀 테스트."""
import os

from engine.config import SimConfig
from engine.validate import validate_config

SAMPLE = os.path.join(os.path.dirname(__file__), "..", "examples", "sample_station.json")


def _one_node(**over):
    base = {"total_steps": 10, "nodes": [{"id": "A", "kind": "corridor", "area": 10, "p_stay_base": 0.5}], "links": []}
    base.update(over)
    return SimConfig.from_dict(base)


def test_valid_sample_passes():
    v = validate_config(SimConfig.from_json(open(SAMPLE, encoding="utf-8").read()))
    assert v["ok"], v


def test_negative_weight_rejected():
    c = SimConfig.from_dict({
        "total_steps": 10,
        "nodes": [{"id": "A", "kind": "corridor", "area": 10, "p_stay_base": 0.5},
                  {"id": "B", "kind": "corridor", "area": 10}],
        "links": [{"src": "A", "dst": "B", "distance": 5, "weight": -1.0, "tau": 1}],
    })
    assert not validate_config(c)["ok"]


def test_rho_max_zero_rejected():
    assert not validate_config(_one_node(dynamics={"rho_max": 0}))["ok"]


def test_nan_pstay_rejected():
    assert not validate_config(_one_node(nodes=[{"id": "A", "kind": "corridor", "area": 10, "p_stay_base": float("nan")}]))["ok"]


def test_zero_area_rejected():
    assert not validate_config(_one_node(nodes=[{"id": "A", "kind": "corridor", "area": 0}]))["ok"]


def test_negative_distance_rejected():
    c = SimConfig.from_dict({
        "total_steps": 10,
        "nodes": [{"id": "A", "kind": "corridor", "area": 10}, {"id": "B", "kind": "corridor", "area": 10}],
        "links": [{"src": "A", "dst": "B", "distance": -5, "weight": 1.0}],
    })
    assert not validate_config(c)["ok"]


def test_sum_aggregate_rejected():
    assert not validate_config(_one_node(export={"aggregate_method": "sum"}))["ok"]


def test_warmup_exceeds_total_rejected():
    assert not validate_config(_one_node(warmup_steps=10))["ok"]


def test_negative_source_sigma_rejected():
    c = _one_node(nodes=[{"id": "A", "kind": "entrance", "area": 10,
                          "source": {"type": "normal", "rate": 1.0, "sigma": -2.0}}])
    assert not validate_config(c)["ok"]


def test_null_numeric_no_crash():
    # 프론트 빈 입력(null)이 와도 default 로 대체되어 크래시하지 않음(B-1)
    import json
    c = SimConfig.from_json(json.dumps({
        "total_steps": None, "dt_seconds": None, "seed": None, "warmup_steps": None,
        "nodes": [{"id": "A", "kind": "corridor", "area": None, "p_stay_base": None}], "links": [],
    }))
    v = validate_config(c)
    assert isinstance(v, dict) and "ok" in v  # 예외 없이 검증 수행


def test_over_aggregate_rejected():
    # aggregate_steps > total_steps 시 시간축 오염 → 거부(B-2)
    assert not validate_config(_one_node(total_steps=5, export={"aggregate_steps": 100}))["ok"]


def test_profile_length_mismatch_rejected():
    # 수요 프로파일 hours/multipliers 길이 불일치 → 거부(B-5)
    c = _one_node(nodes=[{"id": "A", "kind": "entrance", "area": 10,
                          "source": {"type": "poisson", "rate": 1.0,
                                     "profile": {"hours": [6, 9, 18], "multipliers": [1, 3]}}}])
    assert not validate_config(c)["ok"]
