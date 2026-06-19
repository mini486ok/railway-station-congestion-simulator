"""설정(SimConfig) -> 시뮬레이션용 SoA(numpy) 자료구조.

핵심 책임:
    1. 노드를 0..R-1 로 인덱싱하고 속성을 길이 n_total numpy 배열로 구성(SoA).
    2. 유출(egress)용 **가상 흡수 노드(sink)** 합성:
         - 출입구마다 EXIT sink (역사 밖 퇴장), 가중치 기반 링크로 연결.
         - 승강장마다 TRAIN sink (열차 탑승), 우선 유출(simulator step 0)로 직접 적재.
    3. 각 노드의 출력 링크 가중치 합 = 1 강제(요구사항 불변식, 인원 보존 보장).
       출력처가 전혀 없는 노드는 P_move=0(체류 1)로 고정해 인원 누수 방지.
    4. 링크 소요시간 tau 자동 계산: ceil(거리 / (v0 * Δ)), 최소 1스텝.
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Tuple

import numpy as np

from .config import SimConfig, SELF_GENERATING_KINDS, SourceSpec, TrainArrival

EGRESS_TAU = 1  # 출입구 -> OUTSIDE 흡수 소요시간(스텝)


@dataclass
class Model:
    # 메타
    n_real: int
    n_total: int
    node_ids: List[str]
    node_names: List[str]
    node_kinds: List[str]              # real 노드 종류
    node_x: List[float]                # 에디터 좌표(export 보존)
    node_y: List[float]
    id_to_idx: Dict[str, int]

    # SoA 배열 (길이 n_total; real 0..R-1, 이어서 sink)
    area: np.ndarray                   # float64
    v0: np.ndarray                     # float64
    p_stay_base: np.ndarray            # float64
    dynamic_mask: np.ndarray           # bool
    N0: np.ndarray                     # float64 초기 인원
    is_sink: np.ndarray                # bool
    real_mask: np.ndarray              # bool (= ~is_sink)

    # 링크(real+sink 포함) CSR 유사 평행 배열
    src: np.ndarray                    # int32
    dst: np.ndarray                    # int32
    weight: np.ndarray                 # float64
    tau: np.ndarray                    # int32
    max_tau: int
    ring_len: int                      # L = max(2, max_tau+1)

    # 자체발생 / 유출 매핑
    sources: List[Tuple[int, SourceSpec]]              # (real idx, source)
    entrance_idx: List[int]
    exit_sink_idx: List[int]                           # entrance_idx 와 평행
    platform_idx: List[int]
    train_sink_idx: List[int]                          # platform_idx 와 평행
    platform_trains: List[List[TrainArrival]]          # platform_idx 와 평행

    # 그래프 구조(real->real 링크만; 인접행렬/엣지 export 용)
    graph_edges: List[Tuple[int, int, float, float, int]]  # (s, d, weight, distance, tau)

    # 엘리베이터(연속 유출 없이 주기마다 용량만큼 배치 유출)
    elevator_idx: List[int]
    elevator_cycle: List[int]
    elevator_capacity: List[float]
    elevator_links: List[np.ndarray]   # 각 엘리베이터의 출력 링크 인덱스(글로벌 src/dst 배열 기준)

    # 물리 그룹(혼잡도 합산) — 같은 물리적 장소를 여러 노드로 분리해도 그룹 단위로 혼잡도 산출
    node_group: List[str]
    group_ids: List[str]
    group_index: np.ndarray            # real 노드 → 그룹 위치
    group_area: np.ndarray
    has_grouping: bool

    warnings: List[str] = field(default_factory=list)


def build_model(cfg: SimConfig) -> Model:
    warnings: List[str] = []
    nodes = cfg.nodes
    R = len(nodes)
    if R == 0:
        raise ValueError("노드가 하나도 없습니다.")

    id_to_idx: Dict[str, int] = {}
    for i, n in enumerate(nodes):
        if n.id in id_to_idx:
            raise ValueError(f"중복 노드 id: {n.id!r}")
        id_to_idx[n.id] = i

    kinds = [n.kind for n in nodes]
    entrance_idx = [i for i in range(R) if kinds[i] == "entrance"]
    platform_idx = [i for i in range(R) if kinds[i] == "platform"]

    # ── sink 인덱스 할당 (entrance EXIT, platform TRAIN) ──
    n_sink = len(entrance_idx) + len(platform_idx)
    n_total = R + n_sink
    exit_sink_idx: List[int] = []
    train_sink_idx: List[int] = []
    s = R
    for _ in entrance_idx:
        exit_sink_idx.append(s)
        s += 1
    for _ in platform_idx:
        train_sink_idx.append(s)
        s += 1
    exit_sink_of = dict(zip(entrance_idx, exit_sink_idx))

    # ── SoA 배열 ──
    area = np.empty(n_total, dtype=np.float64)
    v0 = np.empty(n_total, dtype=np.float64)
    p_stay_base = np.empty(n_total, dtype=np.float64)
    dynamic_mask = np.zeros(n_total, dtype=bool)
    N0 = np.zeros(n_total, dtype=np.float64)
    is_sink = np.zeros(n_total, dtype=bool)

    for i, n in enumerate(nodes):
        a = n.area
        if a <= 0:
            warnings.append(f"노드 {n.id!r} 면적<=0 → 0.1 로 보정")
            a = 0.1
        area[i] = a
        v = n.resolved_v0()
        v0[i] = v if v > 0 else cfg.dynamics.v0_default
        p_stay_base[i] = float(np.clip(n.p_stay_base, 0.0, 1.0))
        dynamic_mask[i] = bool(n.dynamic_pstay)
        N0[i] = max(0.0, n.n0)

    # sink: 흡수만, 재방출 없음
    for sk in range(R, n_total):
        area[sk] = 1e9
        v0[sk] = 1.0
        p_stay_base[sk] = 1.0
        dynamic_mask[sk] = False
        is_sink[sk] = True

    real_mask = ~is_sink

    # ── 실 링크 수집 + tau 자동 계산 ──
    real_out: Dict[int, List[List[float]]] = defaultdict(list)  # si -> [dst, weight, tau, distance]
    for l in cfg.links:
        if l.src not in id_to_idx or l.dst not in id_to_idx:
            warnings.append(f"링크 무시(미정의 노드): {l.src!r}->{l.dst!r}")
            continue
        si = id_to_idx[l.src]
        di = id_to_idx[l.dst]
        if l.tau is None:
            v = v0[si] if v0[si] > 0 else cfg.dynamics.v0_default
            steps = math.ceil(l.distance / (v * cfg.dt_seconds)) if (v * cfg.dt_seconds) > 0 else 1
            tau = max(1, int(steps))
        else:
            tau = max(1, int(l.tau))
        tau = min(tau, 1_000_000)  # 거대 tau OOM/int 오버플로 방어
        real_out[si].append([float(di), float(l.weight), float(tau), float(l.distance)])

    # ── 가중치 정규화(합=1 강제) + 출입구 EXIT 링크 합성 + 출력없는 노드 체류고정 ──
    final_links: List[Tuple[int, int, float, int]] = []   # (s, d, weight, tau)
    graph_edges: List[Tuple[int, int, float, float, int]] = []  # real->real (s,d,w,dist,tau)

    for si in range(R):
        items = real_out.get(si, [])
        ew = float(np.clip(nodes[si].exit_weight, 0.0, 1.0)) if kinds[si] == "entrance" else 0.0

        if not items and ew <= 0.0:
            # 출력처 없음 → P_move=0 으로 고정(인원 누수 방지)
            p_stay_base[si] = 1.0
            dynamic_mask[si] = False
            if kinds[si] in SELF_GENERATING_KINDS:
                warnings.append(
                    f"노드 {nodes[si].id!r}(출입구/승강장)에 출력 링크와 퇴장(exit_weight)이 모두 없어 "
                    f"생성/하차 인원이 영구히 정체됩니다 — 출력 링크나 exit_weight를 추가하세요"
                )
            else:
                warnings.append(f"노드 {nodes[si].id!r} 출력 링크 없음 → 체류확률 1 고정(인원 정체)")
            continue

        if not items and ew > 0.0:
            # 퇴장 전용 출입구
            final_links.append((si, exit_sink_of[si], 1.0, EGRESS_TAU))
            continue

        rw = sum(it[1] for it in items)
        if rw <= 0.0:
            n_it = len(items)
            for it in items:
                it[1] = 1.0 / n_it
            rw = 1.0
            warnings.append(f"노드 {nodes[si].id!r} 출력 가중치 합<=0 → 균등 분배")

        scale = (1.0 - ew) / rw
        for di, w, tau, dist in items:
            wn = w * scale
            final_links.append((si, int(di), wn, int(tau)))
            graph_edges.append((si, int(di), wn, float(dist), int(tau)))
        if ew > 0.0:
            final_links.append((si, exit_sink_of[si], ew, EGRESS_TAU))

    # ── 링크 numpy 배열화 ──
    if final_links:
        src = np.array([e[0] for e in final_links], dtype=np.int32)
        dst = np.array([e[1] for e in final_links], dtype=np.int32)
        weight = np.array([e[2] for e in final_links], dtype=np.float64)
        tau = np.array([e[3] for e in final_links], dtype=np.int32)
        max_tau = int(tau.max())
    else:
        src = np.zeros(0, dtype=np.int32)
        dst = np.zeros(0, dtype=np.int32)
        weight = np.zeros(0, dtype=np.float64)
        tau = np.zeros(0, dtype=np.int32)
        max_tau = 0
    ring_len = max(2, max_tau + 1)

    # ── 엘리베이터: 연속 유출 없이 주기 배치 유출(출력 링크 인덱스 수집) ──
    src_to_links: Dict[int, List[int]] = defaultdict(list)
    for li in range(src.size):
        src_to_links[int(src[li])].append(li)
    elevator_idx: List[int] = []
    elevator_cycle: List[int] = []
    elevator_capacity: List[float] = []
    elevator_links: List[np.ndarray] = []
    for i in range(R):
        if kinds[i] == "elevator" and int(nodes[i].elevator_cycle) >= 1 and src_to_links.get(i):
            p_stay_base[i] = 1.0          # 연속 유출 없음(배치로만 유출)
            dynamic_mask[i] = False
            elevator_idx.append(i)
            elevator_cycle.append(int(nodes[i].elevator_cycle))
            elevator_capacity.append(float(nodes[i].elevator_capacity))
            elevator_links.append(np.array(src_to_links[i], dtype=np.int64))

    # ── 물리 그룹(혼잡도 합산) ──
    node_group = [nodes[i].group if nodes[i].group else nodes[i].id for i in range(R)]
    group_ids = list(dict.fromkeys(node_group))
    gpos = {g: k for k, g in enumerate(group_ids)}
    group_index = np.array([gpos[g] for g in node_group], dtype=np.int64)
    group_area = np.zeros(len(group_ids), dtype=np.float64)
    for i in range(R):
        group_area[group_index[i]] += area[i]
    has_grouping = len(group_ids) < R

    # ── 자체발생 source 수집 ──
    sources: List[Tuple[int, SourceSpec]] = []
    for i, n in enumerate(nodes):
        if n.source is not None and n.source.type != "none":
            if kinds[i] not in SELF_GENERATING_KINDS:
                warnings.append(f"노드 {n.id!r}({kinds[i]})는 자체발생 불가 → source 무시")
                continue
            sources.append((i, n.source))

    # ── 승강장 열차 스케줄 ──
    platform_trains: List[List[TrainArrival]] = []
    for pi in platform_idx:
        trains = sorted(nodes[pi].trains, key=lambda t: t.t_arrival)
        platform_trains.append(trains)

    return Model(
        n_real=R,
        n_total=n_total,
        node_ids=[n.id for n in nodes],
        node_names=[n.name for n in nodes],
        node_kinds=kinds,
        node_x=[float(n.x) for n in nodes],
        node_y=[float(n.y) for n in nodes],
        id_to_idx=id_to_idx,
        area=area,
        v0=v0,
        p_stay_base=p_stay_base,
        dynamic_mask=dynamic_mask,
        N0=N0,
        is_sink=is_sink,
        real_mask=real_mask,
        src=src,
        dst=dst,
        weight=weight,
        tau=tau,
        max_tau=max_tau,
        ring_len=ring_len,
        sources=sources,
        entrance_idx=entrance_idx,
        exit_sink_idx=exit_sink_idx,
        platform_idx=platform_idx,
        train_sink_idx=train_sink_idx,
        platform_trains=platform_trains,
        graph_edges=graph_edges,
        elevator_idx=elevator_idx,
        elevator_cycle=elevator_cycle,
        elevator_capacity=elevator_capacity,
        elevator_links=elevator_links,
        node_group=node_group,
        group_ids=group_ids,
        group_index=group_index,
        group_area=group_area,
        has_grouping=has_grouping,
        warnings=warnings,
    )


def adjacency_matrix(model: Model) -> np.ndarray:
    """real->real 링크 가중치 기반 인접행렬 [R, R] (STGCN 그래프 입력용)."""
    R = model.n_real
    A = np.zeros((R, R), dtype=np.float64)
    for s, d, w, _dist, _tau in model.graph_edges:
        A[s, d] += w
    return A


def group_adjacency(model: Model) -> np.ndarray:
    """물리 그룹 단위 인접행렬 [G, G] (분리 노드를 물리 장소로 병합). 그룹 내부 링크는 제외."""
    G = len(model.group_ids)
    A = np.zeros((G, G), dtype=np.float64)
    for s, d, w, _dist, _tau in model.graph_edges:
        gs, gd = int(model.group_index[s]), int(model.group_index[d])
        if gs != gd:
            A[gs, gd] += w
    return A
