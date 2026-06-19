"""Round 2 개선 회귀 테스트: 탑승 outflow 기록, 정수 정원, 게이트 throughput, 수요 공통요인."""
import copy

import numpy as np

from engine.config import SimConfig
from engine.simulator import Simulator


def test_board_recorded_in_outflow_and_balance():
    cfg = SimConfig.from_dict({
        "total_steps": 20, "seed": 0,
        "nodes": [{"id": "P", "kind": "platform", "area": 100, "p_stay_base": 1.0,
                   "dynamic_pstay": False, "n0": 500.0,
                   "trains": [{"t_arrival": 2, "alight_mean": 0, "dwell_steps": 10,
                               "train_capacity": 1000, "board_cap": 20}]}],
        "links": [],
    })
    sim = Simulator(cfg)
    rec = sim.run()
    pi = sim.model.id_to_idx["P"]
    out, cnt, inf = rec.outflow[:, pi], rec.count[:, pi], rec.inflow[:, pi]
    # 정차창 내 한 스텝의 탑승 유출이 outflow 채널에 기록(B-3)
    assert 19.0 < out[5] < 21.0
    # 흐름균형: count[t] = count[t-1] - outflow[t] + inflow[t]
    for t in range(1, 20):
        assert abs(cnt[t] - (cnt[t - 1] - out[t] + inf[t])) < 1e-6


def test_integer_board_within_capacity():
    cfg = SimConfig.from_dict({
        "total_steps": 30, "seed": 3, "integer_mode": True,
        "nodes": [{"id": "P", "kind": "platform", "area": 100, "p_stay_base": 1.0,
                   "dynamic_pstay": False, "n0": 500.0,
                   "trains": [{"t_arrival": 1, "alight_mean": 0, "dwell_steps": 20,
                               "train_capacity": 100.5, "board_cap": 1000}]}],
        "links": [],
    })
    sim = Simulator(cfg)
    rec = sim.run()
    col = sim.model.train_sink_idx[0] - sim.model.n_real
    assert rec.sink[-1, col] <= 100.5 + 1e-9  # 정원 초과 없음(B-4)


def test_gate_throughput_caps_outflow():
    cfg = SimConfig.from_dict({
        "total_steps": 40, "seed": 0,
        "nodes": [
            {"id": "E", "kind": "entrance", "area": 50, "p_stay_base": 0.0, "dynamic_pstay": False, "n0": 1000.0},
            {"id": "G", "kind": "gate", "area": 20, "p_stay_base": 0.0, "dynamic_pstay": False, "throughput_cap": 10.0},
            {"id": "X", "kind": "entrance", "area": 50, "p_stay_base": 0.0, "dynamic_pstay": False, "exit_weight": 1.0},
        ],
        "links": [{"src": "E", "dst": "G", "distance": 1, "weight": 1.0, "tau": 1},
                  {"src": "G", "dst": "X", "distance": 1, "weight": 1.0, "tau": 1}],
    })
    sim = Simulator(cfg)
    rec = sim.run()
    gi = sim.model.id_to_idx["G"]
    assert rec.outflow[:, gi].max() <= 10.0 + 1e-6  # 게이트 throughput 상한 준수


def _inflow_corr(rec):
    ia, ib = rec.inflow[:, 0], rec.inflow[:, 1]
    return float(np.corrcoef(ia, ib)[0, 1])


def test_elevator_batch_release():
    # 엘리베이터: 주기 5, 용량 10 → 매 5번째 슬롯에만 10명 이하 배치 유출
    cfg = SimConfig.from_dict({
        "total_steps": 30, "seed": 0,
        "nodes": [
            {"id": "S", "kind": "entrance", "area": 50, "p_stay_base": 0.0, "dynamic_pstay": False, "n0": 100.0},
            {"id": "EV", "kind": "elevator", "area": 20, "elevator_cycle": 5, "elevator_capacity": 10},
            {"id": "X", "kind": "entrance", "area": 50, "p_stay_base": 0.0, "dynamic_pstay": False, "exit_weight": 1.0},
        ],
        "links": [{"src": "S", "dst": "EV", "distance": 1, "weight": 1.0, "tau": 1},
                  {"src": "EV", "dst": "X", "distance": 1, "weight": 1.0, "tau": 1}],
    })
    sim = Simulator(cfg)
    rec = sim.run()
    evi = sim.model.id_to_idx["EV"]
    out = rec.outflow[:, evi]
    # 운행은 t%5==4 에 일어나고 유출은 다음 인덱스(t+1)에 기록 → 인덱스 5,10,15,20,25 에 10명
    for t in range(1, 30):
        if t >= 5 and t % 5 == 0:
            assert 9.9 < out[t] <= 10.0 + 1e-9, f"운행 슬롯 t={t} 유출 {out[t]}"
        else:
            assert out[t] < 1e-9, f"비운행 슬롯 t={t} 유출 {out[t]}"
    assert abs(sim.total_mass() - (float(sim.model.N0.sum()) + sim.cumulative_generated)) < 1e-6


def test_group_aggregates_congestion():
    # E_in, E_out 를 같은 물리 그룹 ENT 로 → 혼잡도는 두 노드 합으로 산출
    cfg = SimConfig.from_dict({
        "total_steps": 20, "seed": 0,
        "nodes": [
            {"id": "E_in", "kind": "entrance", "area": 20, "group": "ENT", "n0": 30.0,
             "p_stay_base": 1.0, "dynamic_pstay": False},
            {"id": "E_out", "kind": "entrance", "area": 20, "group": "ENT", "n0": 20.0,
             "p_stay_base": 1.0, "dynamic_pstay": False},
        ],
        "links": [],
    })
    sim = Simulator(cfg)
    rec = sim.run()
    assert sim.model.has_grouping
    assert rec.out_ids() == ["ENT"]
    X, names, _ = rec.feature_tensor(["count", "density"], warmup=0)
    assert X.shape[1] == 1  # 1개 물리 그룹
    ci = names.index("count")
    assert abs(X[0, 0, ci] - 50.0) < 1e-6  # 30 + 20
    di = names.index("density")
    assert abs(X[0, 0, di] - 50.0 / 40.0) < 1e-6  # 합 면적 40


def test_common_factor_induces_spatial_correlation():
    base = {
        "total_steps": 400, "seed": 1,
        "nodes": [
            {"id": "A", "kind": "entrance", "area": 50, "p_stay_base": 0.5, "exit_weight": 1.0,
             "source": {"type": "poisson", "rate": 4.0}},
            {"id": "B", "kind": "entrance", "area": 50, "p_stay_base": 0.5, "exit_weight": 1.0,
             "source": {"type": "poisson", "rate": 4.0}},
        ],
        "links": [],
    }
    r0 = Simulator(SimConfig.from_dict(copy.deepcopy(base))).run()
    b1 = copy.deepcopy(base)
    b1["demand"] = {"common_factor_phi": 0.9, "common_factor_sigma": 0.6}
    r1 = Simulator(SimConfig.from_dict(b1)).run()
    # 공통요인이 있으면 두 출입구 유입의 공간 상관이 뚜렷이 커짐
    assert _inflow_corr(r1) > 0.2
    assert _inflow_corr(r1) > _inflow_corr(r0) + 0.15
