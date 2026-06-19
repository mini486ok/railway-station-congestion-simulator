"""인원 보존 테스트: source/sink 없는 폐쇄 그래프에서 전체 인원 + in-transit 불변."""
import numpy as np

from engine.config import SimConfig
from engine.simulator import Simulator
from engine.validate import conservation_residual


def closed_two_node(integer_mode=False):
    return SimConfig.from_dict({
        "total_steps": 300, "dt_seconds": 1.0, "seed": 1, "integer_mode": integer_mode,
        "nodes": [
            {"id": "A", "kind": "corridor", "area": 20, "p_stay_base": 0.5, "n0": 100,
             "dynamic_pstay": True},
            {"id": "B", "kind": "corridor", "area": 20, "p_stay_base": 0.5, "n0": 50,
             "dynamic_pstay": True},
        ],
        "links": [
            {"src": "A", "dst": "B", "distance": 10, "weight": 1.0, "tau": 3},
            {"src": "B", "dst": "A", "distance": 10, "weight": 1.0, "tau": 2},
        ],
    })


def test_closed_graph_conserves_continuous():
    sim = Simulator(closed_two_node())
    initial = float(sim.model.N0.sum())
    assert abs(sim.total_mass() - initial) < 1e-9
    for _ in range(sim.total_steps):
        sim.step()
        assert conservation_residual(sim) < 1e-6
    assert abs(sim.total_mass() - initial) < 1e-6


def test_closed_graph_conserves_integer():
    sim = Simulator(closed_two_node(integer_mode=True))
    initial = float(sim.model.N0.sum())
    sim.run()
    # 정수 모드: multinomial 분배로 정확 보존
    assert abs(sim.total_mass() - initial) < 1e-6
    # 모든 인원이 정수
    assert np.allclose(sim.N, np.round(sim.N))
