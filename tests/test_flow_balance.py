"""흐름 균형 / 무한 누적 방지: source+sink 가 있으면 역사 인원이 유계·수렴."""
import numpy as np

from engine.config import SimConfig
from engine.simulator import Simulator


def balance_cfg():
    return SimConfig.from_dict({
        "total_steps": 3000, "dt_seconds": 1.0, "seed": 7,
        "nodes": [
            {"id": "E", "kind": "entrance", "area": 50, "p_stay_base": 0.5,
             "dynamic_pstay": True, "exit_weight": 0.6,
             "source": {"type": "constant", "rate": 8.0}},
            {"id": "C", "kind": "corridor", "area": 80, "p_stay_base": 0.5,
             "dynamic_pstay": True},
        ],
        "links": [
            {"src": "E", "dst": "C", "distance": 10, "weight": 1.0, "tau": 2},
            {"src": "C", "dst": "E", "distance": 10, "weight": 1.0, "tau": 2},
        ],
    })


def test_population_bounded_and_converges():
    sim = Simulator(balance_cfg())
    rec = sim.run()
    real_total = rec.count.sum(axis=1)  # 시점별 역사 내 총 인원
    # 발산하지 않고 유계
    assert real_total.max() < 5000, real_total.max()
    # 후반부가 정상상태(평균 대비 변동이 작음)
    tail = real_total[-300:]
    assert tail.std() / (tail.mean() + 1e-9) < 0.2


def test_sink_monotonic_and_accounting():
    sim = Simulator(balance_cfg())
    rec = sim.run()
    # 유출 sink(누적)는 단조 비감소
    dsink = np.diff(rec.sink, axis=0)
    assert np.all(dsink >= -1e-9)
    # 전체 회계: 누적생성 = 역사잔류 + 누적유출 + in-transit (초기 0)
    real_final = float(sim.N[sim.model.real_mask].sum())
    sink_final = float(sim.N[~sim.model.real_mask].sum())
    in_transit = float(sim.arrival_ring.sum())
    assert abs(sim.cumulative_generated - (real_final + sink_final + in_transit)) < 1e-5
    # 실제로 유출이 일어났는지(누적 유출 > 0)
    assert sink_final > 0
