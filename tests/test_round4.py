"""Round 4: 양방향 2노드 모델링(방향 메타) + 노드별/물리 그룹별 출력 단위 옵션."""
import numpy as np

from engine.config import SimConfig, NodeConfig
from engine.simulator import Simulator
from engine.validate import conservation_residual, validate_config


def _paired_cfg(output_level="group"):
    """통로를 정/역방향 2노드로 분리해 같은 그룹으로 묶은 양방향 구성."""
    return SimConfig.from_dict({
        "total_steps": 30, "seed": 0,
        "export": {"output_level": output_level},
        "nodes": [
            {"id": "E_in", "kind": "entrance", "direction": "입구", "group": "출입구",
             "area": 40, "p_stay_base": 0.3, "dynamic_pstay": False,
             "source": {"type": "constant", "rate": 5.0}},
            {"id": "E_out", "kind": "entrance", "direction": "출구", "group": "출입구",
             "area": 40, "p_stay_base": 0.2, "dynamic_pstay": False, "exit_weight": 1.0},
            {"id": "C_in", "kind": "corridor", "direction": "정방향", "group": "중앙통로",
             "area": 80, "p_stay_base": 0.4, "dynamic_pstay": False},
            {"id": "C_out", "kind": "corridor", "direction": "역방향", "group": "중앙통로",
             "area": 80, "p_stay_base": 0.4, "dynamic_pstay": False},
        ],
        "links": [
            {"src": "E_in", "dst": "C_in", "distance": 10, "weight": 1.0, "tau": 1},
            {"src": "C_in", "dst": "C_out", "distance": 10, "weight": 1.0, "tau": 1},
            {"src": "C_out", "dst": "E_out", "distance": 10, "weight": 1.0, "tau": 1},
        ],
    })


# ── 방향(direction) 메타 필드가 직렬화/역직렬화에서 보존된다 ──
def test_direction_field_roundtrip():
    n = NodeConfig(id="P", kind="platform", direction="상행")
    assert NodeConfig.from_dict(n.to_dict()).direction == "상행"
    cfg = _paired_cfg()
    cfg2 = SimConfig.from_json(cfg.to_json())
    dirs = {n.id: n.direction for n in cfg2.nodes}
    assert dirs == {"E_in": "입구", "E_out": "출구", "C_in": "정방향", "C_out": "역방향"}
    # 방향은 동역학에 영향을 주지 않는다(메타 전용)
    assert "direction" not in validate_config(cfg)["errors"]


# ── output_level=group: 양방향 2노드가 물리 장소 단위로 합산 ──
def test_output_level_group_aggregates_pairs():
    cfg = _paired_cfg("group")
    sim = Simulator(cfg)
    rec = sim.run()
    assert sim.model.has_grouping
    ids = rec.out_ids(group_level=True)
    assert ids == ["출입구", "중앙통로"]                 # 4노드 → 2 물리 그룹
    X, names, _ = rec.feature_tensor(["count"], warmup=0, group_level=True)
    assert X.shape[1] == 2
    assert conservation_residual(sim) < 1e-6


# ── output_level=node: 같은 시뮬을 노드 단위(4개)로 출력 ──
def test_output_level_node_keeps_all_nodes():
    cfg = _paired_cfg("node")
    sim = Simulator(cfg)
    rec = sim.run()
    ids = rec.out_ids(group_level=False)
    assert ids == ["E_in", "E_out", "C_in", "C_out"]    # 4노드 그대로
    X, names, _ = rec.feature_tensor(["count"], warmup=0, group_level=False)
    assert X.shape[1] == 4


# ── 같은 시뮬, 출력 단위만 다를 때 그룹 합 = 노드 합(인원 보존) ──
def test_group_sum_equals_node_sum():
    cfg = _paired_cfg("group")
    rec = Simulator(cfg).run()
    Xg, ng, _ = rec.feature_tensor(["count"], warmup=0, group_level=True)
    Xn, nn, _ = rec.feature_tensor(["count"], warmup=0, group_level=False)
    cg, cn = ng.index("count"), nn.index("count")
    # 모든 시점에서 전체 인원 총합이 일치
    assert np.allclose(Xg[:, :, cg].sum(axis=1), Xn[:, :, cn].sum(axis=1), atol=1e-6)
    # '출입구' 그룹(E_in+E_out) 합산이 두 노드 합과 같음
    m = rec.model
    gi = m.group_ids.index("출입구")
    ent = [i for i in range(m.n_real) if m.node_group[i] == "출입구"]
    assert np.allclose(Xg[:, gi, cg], Xn[:, ent, cn].sum(axis=1), atol=1e-6)


# ── npz 텐서 차원이 출력 단위를 따른다(STGCN 그래프 노드 수) ──
def test_npz_node_count_follows_output_level():
    cg = _paired_cfg("group")
    Xg_bytes = Simulator(cg).run().npz_bytes(cg)
    import io
    dg = np.load(io.BytesIO(Xg_bytes), allow_pickle=True)
    assert dg["X"].shape[1] == 2 and dg["adjacency"].shape == (2, 2)
    assert list(dg["node_ids"]) == ["출입구", "중앙통로"]

    cn = _paired_cfg("node")
    Xn_bytes = Simulator(cn).run().npz_bytes(cn)
    dn = np.load(io.BytesIO(Xn_bytes), allow_pickle=True)
    assert dn["X"].shape[1] == 4 and dn["adjacency"].shape == (4, 4)
    assert list(dn["node_ids"]) == ["E_in", "E_out", "C_in", "C_out"]


# ── nodes.csv 노드 단위 출력에 group·direction 열이 포함된다 ──
def test_nodes_csv_node_level_has_group_and_direction():
    cfg = _paired_cfg("node")
    rec = Simulator(cfg).run()
    csv = rec.nodes_csv(group_level=False)
    header = csv.splitlines()[0]
    assert "group" in header and "direction" in header
    # E_in 행에 방향/그룹 라벨이 들어가야 함
    line = next(l for l in csv.splitlines() if l.startswith("E_in,"))
    assert "입구" in line and "출입구" in line


# ── 그룹 미정의(모든 노드 단독)면 group/node 출력이 동일 ──
def test_no_grouping_levels_identical():
    cfg = SimConfig.from_dict({
        "total_steps": 10, "seed": 1,
        "nodes": [
            {"id": "A", "kind": "entrance", "area": 30, "p_stay_base": 0.3,
             "dynamic_pstay": False, "source": {"type": "constant", "rate": 3.0}},
            {"id": "B", "kind": "entrance", "area": 30, "p_stay_base": 0.2,
             "dynamic_pstay": False, "exit_weight": 1.0},
        ],
        "links": [{"src": "A", "dst": "B", "distance": 5, "weight": 1.0, "tau": 1}],
    })
    rec = Simulator(cfg).run()
    assert not rec.model.has_grouping
    assert rec.out_ids(group_level=True) == rec.out_ids(group_level=False) == ["A", "B"]


# ── output_level 검증: JSON 의 잘못된 값이 조용히 보정되지 않고 검증에서 걸린다 ──
def test_output_level_validation():
    # 잘못된 값은 from_dict 에서 보존되어야(group 으로 무음 보정 금지) validate 가 잡는다
    bad = SimConfig.from_dict({"total_steps": 5, "export": {"output_level": "blah"},
                               "nodes": [{"id": "A", "kind": "corridor"}], "links": []})
    assert bad.export.output_level == "blah"
    res = validate_config(bad)
    assert not res["ok"]
    assert any("output_level" in e for e in res["errors"])
    # 누락/빈 값은 기본값(group)으로 정상 처리
    assert SimConfig.from_dict({"export": {}}).export.output_level == "group"
    assert SimConfig.from_dict({"export": {"output_level": ""}}).export.output_level == "group"


# ── 그룹 edge_attr 의 거리/tau 가 0이 아니라 멤버 엣지 가중평균으로 채워진다(노드/그룹 스키마 일치) ──
def test_group_edge_attr_nonzero():
    import io
    cfg = _paired_cfg("group")
    b = Simulator(cfg).run().npz_bytes(cfg)
    d = np.load(io.BytesIO(b), allow_pickle=True)
    ea = d["edge_attr"]                      # [M, 3] = (weight, distance, tau)
    assert ea.shape[0] >= 1
    assert (ea[:, 1] > 0).all()              # 거리 > 0 (이전엔 0으로 죽었음)
    assert (ea[:, 2] >= 1).all()             # tau >= 1
    assert str(d["output_level"]) == "group"
    assert "group_members" in d.files        # 그룹↔멤버 매핑 메타 포함


# ── npz 노드 단위 메타: 방향·소속그룹 동봉 ──
def test_npz_node_meta():
    import io
    cfg = _paired_cfg("node")
    b = Simulator(cfg).run().npz_bytes(cfg)
    d = np.load(io.BytesIO(b), allow_pickle=True)
    assert str(d["output_level"]) == "node"
    assert list(d["node_direction"]) == ["입구", "출구", "정방향", "역방향"]
    assert list(d["node_group"]) == ["출입구", "출입구", "중앙통로", "중앙통로"]


# ── departures.csv 가 출력 단위를 따른다(그룹별 sink 합산) ──
def test_departures_follows_output_level():
    cfgd = {
        "total_steps": 12, "seed": 0,
        "nodes": [
            {"id": "E1", "kind": "entrance", "group": "출입구", "area": 30, "p_stay_base": 0.2,
             "dynamic_pstay": False, "exit_weight": 1.0, "source": {"type": "constant", "rate": 5.0}},
            {"id": "E2", "kind": "entrance", "group": "출입구", "area": 30, "p_stay_base": 0.2,
             "dynamic_pstay": False, "exit_weight": 1.0, "source": {"type": "constant", "rate": 3.0}},
        ],
        "links": [],
    }
    rec = Simulator(SimConfig.from_dict(cfgd)).run()
    g_hdr = rec.departures_csv(group_level=True).splitlines()[0]
    n_hdr = rec.departures_csv(group_level=False).splitlines()[0]
    assert "exit_출입구_cum" in g_hdr and "exit_E1" not in g_hdr   # 그룹 단위 합산
    assert "exit_E1_cum" in n_hdr and "exit_E2_cum" in n_hdr       # 노드 단위 분리


# ── 같은 물리 그룹 내부 직접 링크는 경고로 표면화된다 ──
def test_intra_group_link_warning():
    res = validate_config(_paired_cfg("group"))   # C_in->C_out 가 같은 '중앙통로' 그룹
    assert any("같은 물리 그룹 내부" in w for w in res["warnings"])
    # 분리(진입/진출 미연결) 구조에서는 경고 없음
    sep = SimConfig.from_dict({
        "nodes": [
            {"id": "A", "kind": "corridor", "group": "G", "area": 20},
            {"id": "B", "kind": "corridor", "group": "G", "area": 20},
            {"id": "X", "kind": "entrance", "group": "출입구", "area": 20, "exit_weight": 1.0},
        ],
        "links": [{"src": "A", "dst": "X", "weight": 1.0, "distance": 5},
                  {"src": "B", "dst": "X", "weight": 1.0, "distance": 5}],
    })
    assert not any("같은 물리 그룹 내부" in w for w in validate_config(sep)["warnings"])
