"""유출(egress) 동작: 출입구 퇴장과 승강장 탑승이 실제로 인원을 제거하는지."""
from engine.config import SimConfig
from engine.simulator import Simulator


def test_entrance_exit_drains_to_outside():
    cfg = SimConfig.from_dict({
        "total_steps": 60, "seed": 0,
        "nodes": [
            {"id": "E", "kind": "entrance", "area": 50, "p_stay_base": 0.5,
             "dynamic_pstay": False, "exit_weight": 1.0, "n0": 100.0},
        ],
        "links": [],
    })
    sim = Simulator(cfg)
    rec = sim.run()
    exit_col = sim.model.exit_sink_idx[0] - sim.model.n_real
    outside_cum = rec.sink[:, exit_col]
    # 누적 퇴장 증가 + 거의 전원 퇴장
    assert outside_cum[-1] > 99.0, outside_cum[-1]
    # 출입구 인원은 0 으로 감소
    assert rec.count[-1, sim.model.id_to_idx["E"]] < 1.0


def test_platform_boarding_removes_passengers():
    cfg = SimConfig.from_dict({
        "total_steps": 40, "seed": 0,
        "nodes": [
            {"id": "P", "kind": "platform", "area": 100, "p_stay_base": 0.5,
             "dynamic_pstay": False, "n0": 500.0,
             "trains": [{"t_arrival": 5, "alight_mean": 0, "dwell_steps": 10,
                         "train_capacity": 1000, "board_cap": 20}]},
        ],
        "links": [],
    })
    sim = Simulator(cfg)
    rec = sim.run()
    train_col = sim.model.train_sink_idx[0] - sim.model.n_real
    boarded_cum = rec.sink[:, train_col]
    # 정차창 10스텝 * 20명 = 200명 탑승
    assert abs(boarded_cum[-1] - 200.0) < 1e-6, boarded_cum[-1]
    # 승강장 인원 200명 감소(500 -> 300)
    p_final = rec.count[-1, sim.model.id_to_idx["P"]]
    assert abs(p_final - 300.0) < 1e-6, p_final
