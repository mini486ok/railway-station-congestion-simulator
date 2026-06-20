"""Round 5: 노드+그룹 동시 출력(전체 번들 ZIP), 명시적 출력 단위 export, CLI 양단위 출력."""
import io
import json
import zipfile

import numpy as np

from engine import bridge
from engine.config import SimConfig


def _paired_dict(output_level="group"):
    return {
        "total_steps": 24, "seed": 0,
        "export": {"output_level": output_level, "aggregate_steps": 1},
        "nodes": [
            {"id": "E_in", "kind": "entrance", "direction": "입구", "group": "출입구",
             "area": 40, "p_stay_base": 0.3, "dynamic_pstay": False,
             "source": {"type": "constant", "rate": 5.0}},
            {"id": "E_out", "kind": "entrance", "direction": "출구", "group": "출입구",
             "area": 40, "p_stay_base": 0.2, "dynamic_pstay": False, "exit_weight": 1.0},
            {"id": "C_in", "kind": "corridor", "direction": "진입", "group": "통로",
             "area": 80, "p_stay_base": 0.4, "dynamic_pstay": False},
            {"id": "C_out", "kind": "corridor", "direction": "진출", "group": "통로",
             "area": 80, "p_stay_base": 0.4, "dynamic_pstay": False},
        ],
        "links": [
            {"src": "E_in", "dst": "C_in", "distance": 10, "weight": 1.0, "tau": 1},
            {"src": "C_in", "dst": "E_out", "distance": 10, "weight": 1.0, "tau": 1},
        ],
    }


# ── recorder.npz_bytes 의 group_level 명시 지정이 cfg.output_level 을 덮어쓴다 ──
def test_npz_bytes_explicit_level_override():
    from engine.simulator import Simulator
    cfg = SimConfig.from_dict(_paired_dict("group"))  # 설정은 group
    rec = Simulator(cfg).run()
    dn = np.load(io.BytesIO(rec.npz_bytes(cfg, group_level=False)), allow_pickle=True)
    dg = np.load(io.BytesIO(rec.npz_bytes(cfg, group_level=True)), allow_pickle=True)
    assert dn["X"].shape[1] == 4 and str(dn["output_level"]) == "node"
    assert dg["X"].shape[1] == 2 and str(dg["output_level"]) == "group"
    # None(기본)이면 cfg(group)를 따른다
    dd = np.load(io.BytesIO(rec.npz_bytes(cfg)), allow_pickle=True)
    assert dd["X"].shape[1] == 2


# ── bridge.export_csv / export_npz 의 명시적 level 인자 ──
def test_bridge_explicit_level():
    bridge.create(json.dumps(_paired_dict("group")))
    bridge.run_all()
    # CSV: 노드 단위는 4행(+헤더), 그룹 단위는 2 식별자만
    n_nodes = bridge.export_csv("nodes", "node").strip().splitlines()
    g_nodes = bridge.export_csv("nodes", "group").strip().splitlines()
    assert len(n_nodes) == 1 + 4 and len(g_nodes) == 1 + 2
    # npz: 단위별 노드 수
    dn = np.load(io.BytesIO(bytes(bridge.export_npz("node"))), allow_pickle=True)
    dg = np.load(io.BytesIO(bytes(bridge.export_npz("group"))), allow_pickle=True)
    assert dn["X"].shape[1] == 4 and dg["X"].shape[1] == 2
    # 빈 level("")은 설정(group)을 따른다
    dd = np.load(io.BytesIO(bytes(bridge.export_npz(""))), allow_pickle=True)
    assert dd["X"].shape[1] == 2


# ── bridge.export_bundle: node/·group/ 두 단위 + config + README 를 담은 ZIP ──
def test_bridge_export_bundle_zip():
    bridge.create(json.dumps(_paired_dict("group")))
    bridge.run_all()
    z = zipfile.ZipFile(io.BytesIO(bytes(bridge.export_bundle())))
    names = set(z.namelist())
    for folder in ("node", "group"):
        for f in ("nodes.csv", "edges.csv", "timeseries.csv", "departures.csv", "X.npz"):
            assert f"{folder}/{f}" in names, f"{folder}/{f} 누락"
    assert "config.json" in names and "README.txt" in names
    # 각 폴더의 X.npz 가 해당 단위(노드 4 / 그룹 2)로 만들어졌는지
    dn = np.load(io.BytesIO(z.read("node/X.npz")), allow_pickle=True)
    dg = np.load(io.BytesIO(z.read("group/X.npz")), allow_pickle=True)
    assert dn["X"].shape[1] == 4 and dg["X"].shape[1] == 2
    # X.npz 는 이미 압축돼 있어 ZIP 은 무압축 저장(이중압축 회피)
    assert z.getinfo("node/X.npz").compress_type == zipfile.ZIP_STORED
    assert z.getinfo("group/X.npz").compress_type == zipfile.ZIP_STORED
    # config.json 은 재현용 전체 설정(JSON 파싱 가능)
    assert json.loads(z.read("config.json").decode("utf-8"))["nodes"]


# ── 대량 생성: 그래프 1회 + 혼잡도 CSV N개 + 스택 텐서 X_all.npz ──
def test_bridge_export_batch_zip():
    cfg = _paired_dict("group")
    # 수요 변동을 주어 시드별로 실현이 달라지게(노이즈 포함)
    cfg["demand"] = {"day_variability_sigma": 0.2, "common_factor_phi": 0.7, "common_factor_sigma": 0.2}
    cfg["export"]["noise_enabled"] = True
    cfg["export"]["noise_model"] = "poisson"
    bridge.create(json.dumps(cfg))
    bridge.batch_prepare(3, 5, "group")
    for _ in range(3):
        bridge.batch_run_one()
    z = zipfile.ZipFile(io.BytesIO(bytes(bridge.batch_finish())))
    names = set(z.namelist())
    # 혼잡도는 시드별 CSV N개
    for s in (5, 6, 7):
        assert f"runs/run_{s:04d}.csv" in names, f"run_{s:04d}.csv 누락"
    # 그래프는 1회(nodes/edges + X_all 의 adjacency), AI 텐서 1개
    for f in ("nodes.csv", "edges.csv", "X_all.npz", "config.json", "manifest.json", "README.txt"):
        assert f in names, f"{f} 누락"
    # 그래프가 시드 수만큼 중복 저장되지 않음(run_*.npz 없음)
    assert not any(n.endswith(".npz") and n.startswith("runs/") for n in names)
    man = json.loads(z.read("manifest.json").decode("utf-8"))
    assert man["num_runs"] == 3 and man["seeds"] == [5, 6, 7] and man["output_level"] == "group"
    # X_all.npz: X_all[R,T,N,F] (그룹 단위 노드 2) + 그래프 1회
    assert z.getinfo("X_all.npz").compress_type == zipfile.ZIP_STORED
    d = np.load(io.BytesIO(z.read("X_all.npz")), allow_pickle=True)
    R, T, N, F = d["X_all"].shape
    assert R == 3 and N == 2
    assert list(man["x_all_shape"]) == [R, T, N, F]
    assert list(d["seeds"]) == [5, 6, 7]
    assert "adjacency" in d.files and d["adjacency"].shape == (2, 2)  # 그래프 1회
    # 시드가 다르면 실현(특징 텐서)이 달라야 한다
    assert not np.allclose(d["X_all"][0], d["X_all"][1])


# ── ml/dataset.build_dataset_from_stack: X_all.npz 한 파일에서 run 단위 분할 ──
def test_build_dataset_from_stack(tmp_path):
    from ml.dataset import build_dataset_from_stack
    cfg = _paired_dict("group")
    cfg["total_steps"] = 80
    cfg["export"]["aggregate_steps"] = 1
    cfg["demand"] = {"day_variability_sigma": 0.2, "common_factor_phi": 0.7, "common_factor_sigma": 0.2}
    bridge.create(json.dumps(cfg))
    bridge.batch_prepare(4, 0, "group")
    for _ in range(4):
        bridge.batch_run_one()
    z = zipfile.ZipFile(io.BytesIO(bytes(bridge.batch_finish())))
    p = tmp_path / "X_all.npz"
    p.write_bytes(z.read("X_all.npz"))
    ds = build_dataset_from_stack(str(p), P=5, Q=2, target="count", val_runs=1, test_runs=1)
    # 4 run → train 2 / val 1 / test 1, 윈도우가 생성되고 그래프 정규화 adjacency 정상
    assert ds.xtr.shape[0] > 0 and ds.xva.shape[0] > 0 and ds.xte.shape[0] > 0
    assert ds.A_hat.shape == (2, 2)
    assert "tod_sin" in ds.channels and "tod_cos" in ds.channels


# ── CLI export_run 이 루트(하위호환) + node/ + group/ 를 모두 생성한다 ──
def test_cli_export_run_both_levels(tmp_path):
    import cli
    cfg = SimConfig.from_dict(_paired_dict("group"))
    out = tmp_path / "run"
    cli.export_run(cfg, str(out))
    for folder in ("node", "group"):
        for f in ("nodes.csv", "edges.csv", "timeseries.csv", "departures.csv", "X.npz"):
            assert (out / folder / f).exists(), f"{folder}/{f} 누락"
    # 루트 평면 출력(하위호환: 기존 out/X.npz 경로) — 설정 단위(group) 따름
    for f in ("nodes.csv", "edges.csv", "timeseries.csv", "departures.csv", "X.npz", "config.json"):
        assert (out / f).exists(), f"루트 {f} 누락(하위호환 깨짐)"
    dn = np.load(out / "node" / "X.npz", allow_pickle=True)
    dg = np.load(out / "group" / "X.npz", allow_pickle=True)
    assert dn["X"].shape[1] == 4 and dg["X"].shape[1] == 2
    assert np.load(out / "X.npz", allow_pickle=True)["X"].shape[1] == 2  # 루트=group


# ── 잘못된 출력 단위(level)·CSV 종류(kind)는 조용히 폴백하지 않고 오류로 알린다 ──
def test_bridge_invalid_level_and_kind_raise():
    import pytest
    bridge.create(json.dumps(_paired_dict("group")))
    bridge.run_all()
    with pytest.raises(ValueError):
        bridge.export_npz("blah")
    with pytest.raises(ValueError):
        bridge.export_csv("nodez", "node")


# ── npz 메타: 요청 단위(requested_output_level)·값 스케일(value_scale) 동봉 ──
def test_npz_value_scale_meta():
    from engine.simulator import Simulator
    cfg = SimConfig.from_dict(_paired_dict("group"))
    rec = Simulator(cfg).run()
    dg = np.load(io.BytesIO(rec.npz_bytes(cfg, group_level=True)), allow_pickle=True)
    dn = np.load(io.BytesIO(rec.npz_bytes(cfg, group_level=False)), allow_pickle=True)
    assert str(dg["value_scale"]) == "group_member_sum" and str(dg["requested_output_level"]) == "group"
    assert str(dn["value_scale"]) == "node" and str(dn["requested_output_level"]) == "node"
