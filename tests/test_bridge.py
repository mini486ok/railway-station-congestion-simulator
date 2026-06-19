"""브라우저(Pyodide) 경계 bridge 의 네이티브 동작 + step_many 후 run_all 초과 방지."""
import json

from engine import bridge

SMALL = {
    "total_steps": 80, "seed": 1,
    "nodes": [
        {"id": "E", "kind": "entrance", "area": 30, "p_stay_base": 0.4, "exit_weight": 0.5,
         "source": {"type": "poisson", "rate": 3.0}},
        {"id": "C", "kind": "corridor", "area": 40, "p_stay_base": 0.5},
    ],
    "links": [
        {"src": "E", "dst": "C", "distance": 10, "weight": 1.0, "tau": 2},
        {"src": "C", "dst": "E", "distance": 10, "weight": 1.0, "tau": 2},
    ],
}


def test_bridge_validate_and_kinds():
    assert len(json.loads(bridge.kinds())) == 7
    v = json.loads(bridge.validate(json.dumps(SMALL)))
    assert v["ok"]


def test_bridge_partial_then_run_all():
    info = json.loads(bridge.create(json.dumps(SMALL)))
    assert info["n_real"] == 2
    snap = json.loads(bridge.step_many(20))
    assert snap["t"] == 20
    # step_many 로 일부 진행 후 run_all 이 레코더를 초과하지 않아야 함
    fin = json.loads(bridge.run_all())
    assert fin["done"] and fin["t"] == 80


def test_bridge_exports():
    bridge.create(json.dumps(SMALL))
    bridge.run_all()
    csv = bridge.export_csv("timeseries")
    assert csv.count("\n") > 2 and "node_id" in csv
    npz = bridge.export_npz()
    assert isinstance(npz, (bytes, bytearray)) and len(npz) > 200
