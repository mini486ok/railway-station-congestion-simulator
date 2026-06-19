"""설정/모델 불변식: 출력 가중치 합=1, 확률 범위, 예제 config 유효성."""
import os

from engine.config import SimConfig
from engine.model import build_model
from engine.validate import validate_config, check_model_invariants, output_weight_sums

SAMPLE = os.path.join(os.path.dirname(__file__), "..", "examples", "sample_station.json")


def load_sample():
    with open(SAMPLE, encoding="utf-8") as f:
        return SimConfig.from_json(f.read())


def test_sample_config_valid():
    v = validate_config(load_sample())
    assert v["ok"], v


def test_output_weight_sums_equal_one():
    model = build_model(load_sample())
    for s, total in output_weight_sums(model).items():
        assert abs(total - 1.0) < 1e-6, f"노드 idx {s} 합={total}"
    assert check_model_invariants(model) == []


def test_weight_normalization_renormalizes():
    # 의도적으로 합이 1이 아닌 가중치 → 정규화되어 합=1 이어야 함
    cfg = SimConfig.from_dict({
        "total_steps": 1,
        "nodes": [
            {"id": "A", "kind": "corridor", "area": 10, "p_stay_base": 0.5},
            {"id": "B", "kind": "corridor", "area": 10, "p_stay_base": 1.0},
            {"id": "C", "kind": "corridor", "area": 10, "p_stay_base": 1.0},
        ],
        "links": [
            {"src": "A", "dst": "B", "distance": 5, "weight": 3.0, "tau": 1},
            {"src": "A", "dst": "C", "distance": 5, "weight": 1.0, "tau": 1},
        ],
    })
    model = build_model(cfg)
    sums = output_weight_sums(model)
    assert abs(sums[model.id_to_idx["A"]] - 1.0) < 1e-9
