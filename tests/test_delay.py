"""소요시간 지연 정확성: 임펄스가 정확히 t+tau 에만 도착하는지."""
from engine.config import SimConfig
from engine.simulator import Simulator


def impulse_cfg(tau):
    return SimConfig.from_dict({
        "total_steps": tau + 4, "seed": 0,
        "nodes": [
            {"id": "A", "kind": "corridor", "area": 100, "p_stay_base": 0.0,
             "dynamic_pstay": False, "n0": 100},
            {"id": "B", "kind": "corridor", "area": 100, "p_stay_base": 1.0,
             "dynamic_pstay": False, "n0": 0},
        ],
        "links": [{"src": "A", "dst": "B", "distance": 1, "weight": 1.0, "tau": tau}],
    })


def test_impulse_arrives_exactly_at_tau():
    tau = 4
    sim = Simulator(impulse_cfg(tau))
    rec = sim.run()
    b = rec.count[:, sim.model.id_to_idx["B"]]
    a = rec.count[:, sim.model.id_to_idx["A"]]
    # A 는 첫 스텝에 모두 떠나 비워짐(p_stay=0)
    assert a[0] == 100.0
    assert a[1] < 1e-9
    # B 는 t<tau 까지 0, t=tau 에 100 도착
    for t in range(tau):
        assert b[t] < 1e-9, f"t={t} 에서 B={b[t]} (조기 도착)"
    assert abs(b[tau] - 100.0) < 1e-6
