"""용량/스필백(CTM): 밀도가 ρ_cap 으로 엄격히 제한되고, 혼잡이 상류로 역전파되는지."""
import numpy as np

from engine.config import SimConfig
from engine.simulator import Simulator


def overloaded_chain():
    # E1(과대 수요) -> B(작은 게이트 병목) -> E2(전량 퇴장)
    return SimConfig.from_dict({
        "total_steps": 600, "seed": 3,
        "dynamics": {"capacity_enabled": True, "rho_cap": 5.0,
                     "p_stay_cap": 0.98, "lpf_alpha": 0.3},
        "nodes": [
            {"id": "E1", "kind": "entrance", "area": 20, "p_stay_base": 0.3,
             "dynamic_pstay": True, "exit_weight": 0.0,
             "source": {"type": "constant", "rate": 30.0}},
            {"id": "B", "kind": "gate", "area": 5, "p_stay_base": 0.2, "dynamic_pstay": True},
            {"id": "E2", "kind": "entrance", "area": 40, "p_stay_base": 0.2,
             "dynamic_pstay": True, "exit_weight": 1.0},
        ],
        "links": [
            {"src": "E1", "dst": "B", "distance": 5, "weight": 1.0, "tau": 1},
            {"src": "B", "dst": "E2", "distance": 5, "weight": 1.0, "tau": 1},
        ],
    })


def test_density_strictly_capped():
    sim = Simulator(overloaded_chain())
    rec = sim.run()
    area = sim.model.area[:sim.model.n_real]
    dens = rec.count / area
    rho_cap = sim.cfg.dynamics.rho_cap
    assert dens.max() <= rho_cap + 1e-6, f"밀도 {dens.max()} 가 ρ_cap {rho_cap} 초과"


def test_conservation_with_spillback_queue():
    sim = Simulator(overloaded_chain())
    sim.run()
    # 보존: 전체 인원 + in-transit + 입구 대기큐 = 초기 + 누적 생성
    initial = float(sim.model.N0.sum())
    assert abs(sim.total_mass() - (initial + sim.cumulative_generated)) < 1e-5
    assert np.all(sim.entrance_queue >= -1e-9)


def test_initial_overflow_conserved():
    # 용량 모드에서 N0 > N_max 인 초기 인원이 소실되지 않고 입구 대기큐로 보존되는지
    cfg = SimConfig.from_dict({
        "total_steps": 30, "seed": 0,
        "dynamics": {"capacity_enabled": True, "rho_cap": 1.0},
        "nodes": [{"id": "A", "kind": "entrance", "area": 10, "p_stay_base": 0.5,
                   "exit_weight": 1.0, "n0": 50.0}],
        "links": [],
    })
    sim = Simulator(cfg)
    initial = float(sim.model.N0.sum())  # 50
    assert abs(sim.total_mass() - initial) < 1e-6, "초기 클립분이 소실됨"
    sim.run()
    assert abs(sim.total_mass() - (initial + sim.cumulative_generated)) < 1e-5


def test_overlapping_dwell_boards_multiple_trains():
    # 정차창이 겹치는 두 열차가 함께 탑승(단일 열차 한도 초과)
    cfg = SimConfig.from_dict({
        "total_steps": 30, "seed": 0,
        "nodes": [{"id": "P", "kind": "platform", "area": 100, "p_stay_base": 0.5,
                   "dynamic_pstay": False, "n0": 1000.0,
                   "trains": [
                       {"t_arrival": 2, "alight_mean": 0, "dwell_steps": 10, "train_capacity": 1000, "board_cap": 20},
                       {"t_arrival": 4, "alight_mean": 0, "dwell_steps": 10, "train_capacity": 1000, "board_cap": 20},
                   ]}],
        "links": [],
    })
    sim = Simulator(cfg)
    rec = sim.run()
    train_col = sim.model.train_sink_idx[0] - sim.model.n_real
    boarded = rec.sink[-1, train_col]
    assert boarded > 350, f"겹친 정차창에서 한 열차만 처리됨(boarded={boarded})"
    assert any("정차창이 겹" in w for w in sim.model.warnings)


def test_backpressure_propagates_upstream():
    sim = Simulator(overloaded_chain())
    rec = sim.run()
    ids = sim.model.id_to_idx
    area = sim.model.area[:sim.model.n_real]
    dens = rec.count / area
    # 병목 B 가 포화되면 상류 E1 도 용량 근처까지 차오름(역전파)
    b_final = dens[-1, ids["B"]]
    e1_final = dens[-1, ids["E1"]]
    assert b_final > 4.5, f"병목 B 밀도 {b_final} (포화 미달)"
    assert e1_final > 4.5, f"상류 E1 밀도 {e1_final} (역전파 안 됨)"
    # 과대 수요로 입구 대기큐(스필백)가 형성됨
    assert sim.entrance_queue.sum() > 0
