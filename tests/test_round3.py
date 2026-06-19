"""Round 3: 승강장 승차/하차 분리·그룹, 열차 스케줄(첫 도착+배차간격), 분포 확장."""
import numpy as np

from engine.config import SimConfig, SourceSpec, TrainSchedule
from engine.generators import sample_source
from engine.simulator import Simulator
from engine.validate import conservation_residual


# ── 열차 스케줄: 첫 도착 + 배차간격 펼치기 ──
def test_train_schedule_expand():
    s = TrainSchedule(first_arrival=10, headway=5, num_trains=3)
    assert [t.t_arrival for t in s.expand(1000)] == [10, 15, 20]
    # num_trains 0 → 시뮬 끝까지 자동
    s2 = TrainSchedule(first_arrival=10, headway=5, num_trains=0)
    assert [t.t_arrival for t in s2.expand(30)] == [10, 15, 20, 25, 30]
    # headway 0 → 1대만
    s3 = TrainSchedule(first_arrival=10, headway=0, num_trains=5)
    assert [t.t_arrival for t in s3.expand(1000)] == [10]
    # 공통 파라미터가 모든 열차에 전파
    s4 = TrainSchedule(first_arrival=0, headway=10, num_trains=2, alight_mean=42, board_cap=7)
    ts = s4.expand(1000)
    assert all(t.alight_mean == 42 and t.board_cap == 7 for t in ts)


# ── 승강장 하차(alight) 전용: 유입만, 탑승 없음 ──
def test_platform_alight_role_inflow_only():
    cfg = SimConfig.from_dict({
        "total_steps": 20, "seed": 0,
        "nodes": [
            {"id": "PA", "kind": "platform", "platform_role": "alight", "area": 100,
             "p_stay_base": 0.5, "dynamic_pstay": False, "group": "PF",
             "train_schedule": {"first_arrival": 2, "headway": 100, "num_trains": 1,
                                "alight_mean": 50, "alight_dist": "constant",
                                "dwell_steps": 10, "train_capacity": 1000, "board_cap": 20}},
            {"id": "X", "kind": "entrance", "area": 50, "p_stay_base": 0.0,
             "dynamic_pstay": False, "exit_weight": 1.0},
        ],
        "links": [{"src": "PA", "dst": "X", "distance": 1, "weight": 1.0, "tau": 1}],
    })
    sim = Simulator(cfg)
    rec = sim.run()
    pa = sim.model.id_to_idx["PA"]
    col = sim.model.train_sink_idx[0] - sim.model.n_real
    assert rec.sink[-1, col] == 0.0                 # 하차 전용 → 탑승 유출 없음
    assert rec.inflow[2, pa] > 49.0                 # 도착(t=2) 하차 버스트 유입
    assert conservation_residual(sim) < 1e-6


# ── 승강장 승차(board) 전용: 유출만, 하차 유입 없음 ──
def test_platform_board_role_egress_only():
    cfg = SimConfig.from_dict({
        "total_steps": 20, "seed": 0,
        "nodes": [
            {"id": "PB", "kind": "platform", "platform_role": "board", "area": 100,
             "p_stay_base": 1.0, "dynamic_pstay": False, "group": "PF", "n0": 500.0,
             "train_schedule": {"first_arrival": 2, "headway": 100, "num_trains": 1,
                                "alight_mean": 999, "alight_dist": "constant",
                                "dwell_steps": 10, "train_capacity": 1000, "board_cap": 20}},
        ],
        "links": [],
    })
    sim = Simulator(cfg)
    rec = sim.run()
    pb = sim.model.id_to_idx["PB"]
    col = sim.model.train_sink_idx[0] - sim.model.n_real
    assert rec.sink[-1, col] > 150.0                # 정차 10스텝 × 20 ≈ 200 탑승
    assert rec.inflow[:, pb].max() < 1e-9           # alight_mean 커도 하차(유입) 없음
    # 승차 노드는 출력 링크가 없어도 경고가 나지 않아야 함
    assert not any("정체" in w for w in sim.model.warnings)
    assert conservation_residual(sim) < 1e-6


# ── 승차+하차 분리 노드를 그룹으로 묶으면 혼잡도가 하나의 물리 장소로 합산 ──
def test_platform_split_grouped_congestion():
    cfg = SimConfig.from_dict({
        "total_steps": 15, "seed": 0,
        "nodes": [
            {"id": "PA", "kind": "platform", "platform_role": "alight", "area": 60,
             "p_stay_base": 1.0, "dynamic_pstay": False, "group": "승강장1", "n0": 30.0},
            {"id": "PB", "kind": "platform", "platform_role": "board", "area": 40,
             "p_stay_base": 1.0, "dynamic_pstay": False, "group": "승강장1", "n0": 20.0},
        ],
        "links": [],
    })
    sim = Simulator(cfg)
    rec = sim.run()
    assert sim.model.has_grouping
    assert rec.out_ids() == ["승강장1"]
    X, names, _ = rec.feature_tensor(["count", "density"], warmup=0)
    assert X.shape[1] == 1
    ci = names.index("count")
    assert abs(X[0, 0, ci] - 50.0) < 1e-6           # 30 + 20 합산
    di = names.index("density")
    assert abs(X[0, 0, di] - 50.0 / 100.0) < 1e-6   # 합 면적 100


# ── 분포 확장: 음이항(과분산), 균등, 로그정규 ──
def test_negative_binomial_overdispersed():
    rng = np.random.default_rng(0)
    spec = SourceSpec(type="negative_binomial", rate=5.0, sigma=4.0)  # 목표분산 16 > 평균 5
    xs = np.array([sample_source(spec, 0.0, rng) for _ in range(20000)])
    assert abs(xs.mean() - 5.0) < 0.3                # 평균 보존
    assert xs.var() > 6.0                            # 푸아송(분산≈5)보다 과분산
    assert (xs == np.round(xs)).all()                # 정수 카운트


def test_uniform_and_lognormal_mean_preserved():
    rng = np.random.default_rng(1)
    u = np.array([sample_source(SourceSpec(type="uniform", rate=10.0, sigma=4.0), 0.0, rng) for _ in range(20000)])
    assert abs(u.mean() - 10.0) < 0.3 and u.min() >= 0.0
    ln = np.array([sample_source(SourceSpec(type="lognormal", rate=8.0, sigma=0.5), 0.0, rng) for _ in range(40000)])
    assert abs(ln.mean() - 8.0) < 0.6 and ln.min() >= 0.0  # E[X]=mean 보정


def test_legacy_trains_still_work():
    # 레거시 trains 목록도 계속 동작(하위호환)
    cfg = SimConfig.from_dict({
        "total_steps": 20, "seed": 0,
        "nodes": [{"id": "P", "kind": "platform", "area": 100, "p_stay_base": 1.0,
                   "dynamic_pstay": False, "n0": 300.0,
                   "trains": [{"t_arrival": 2, "alight_mean": 0, "dwell_steps": 10,
                               "train_capacity": 1000, "board_cap": 20}]}],
        "links": [],
    })
    sim = Simulator(cfg)
    rec = sim.run()
    col = sim.model.train_sink_idx[0] - sim.model.n_real
    assert rec.sink[-1, col] > 150.0  # 기본 role=both 로 탑승 동작
