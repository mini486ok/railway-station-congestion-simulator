"""이산 시간 시뮬레이션 메인 루프 (보존 정합식 + 유출 sink).

한 스텝 t -> t+1 갱신 순서(Jacobi 동시 갱신):
    0) 승강장 우선 탑승 유출: board = min(N, board_cap, 열차잔여) → TRAIN sink (정차창 한정)
    1) P_move = 1 − P_stay
    2) flow = N[src]·P_move[src]·weight          (출입구→OUTSIDE 링크 포함)
    3) 미래 도착 예약: arrival_ring[(t+tau)%L, dst] += flow
    4) 자체발생 S(t+1) = 출입구/승강장 유입 + 열차 하차 버스트
    5) arr = arrival_ring[(t+1)%L] (+S) ; 슬롯 클리어
    6) N(t+1) = max(N·P_stay + arr, 0)
    7) P_stay 재계산(밀도-속력 기본도, 다음 스텝용)
    8) 기록

유출은 노드에서 한 번만 빠지고 sink/하류로 한 번만 들어가므로 인원이 보존된다:
    Σ_all N(t) + Σ ring(in-transit) = 초기 인원 + 누적 생성 인원.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Optional, Tuple

import numpy as np

from .config import SimConfig
from .dynamics import density_to_pstay
from .generators import hour_of_day, sample_alight, sample_source
from .model import Model, build_model
from .recorder import Recorder
from .rounding import stochastic_round, multinomial_split


class Simulator:
    def __init__(self, cfg: SimConfig, model: Optional[Model] = None):
        self.cfg = cfg
        self.model = model if model is not None else build_model(cfg)
        m = self.model

        # RNG 스트림 분리(용도별) — 코퍼스 재현성/CRN(공통난수) 격리
        _streams = np.random.SeedSequence(cfg.seed).spawn(6)
        self.rng = np.random.default_rng(_streams[0])         # flow multinomial 등 일반
        self.demand_rng = np.random.default_rng(_streams[1])  # 자체발생 샘플링
        self.alight_rng = np.random.default_rng(_streams[2])  # 열차 하차
        self.board_rng = np.random.default_rng(_streams[3])   # 탑승 반올림
        self.delay_rng = np.random.default_rng(_streams[4])   # 열차 지연
        self.common_rng = np.random.default_rng(_streams[5])  # 공통요인/일간변동

        # 수요 다양성: 런(시드)별 일간 배율 + 공통요인 AR(1) 상태
        _dvar = cfg.demand.day_variability_sigma
        self._day_mult = float(np.exp(self.common_rng.normal(0.0, _dvar))) if _dvar > 0 else 1.0
        self._z = 0.0

        self.N = m.N0.copy()
        self._last_board = np.zeros(m.n_total, dtype=np.float64)  # 스텝별 탑승 유출(기록용)

        # 용량/스필백(CTM) 설정 — N_max = 면적 × ρ_cap, sink 은 무한
        self.capacity_enabled = bool(cfg.dynamics.capacity_enabled or cfg.dynamics.spillback_enabled)
        self.N_max = m.area * cfg.dynamics.rho_cap
        self.N_max[m.is_sink] = np.inf
        self.entrance_queue = np.zeros(m.n_total, dtype=np.float64)  # 노드 입구 대기큐(스필백)
        # 게이트 등 스텝당 통과 상한(throughput)
        self.throughput_cap = np.zeros(m.n_total, dtype=np.float64)
        for i in range(min(len(cfg.nodes), m.n_real)):
            self.throughput_cap[i] = max(0.0, cfg.nodes[i].throughput_cap)
        self._has_throughput = bool(np.any(self.throughput_cap > 0))
        if self.capacity_enabled and np.any(self.N > self.N_max):
            overflow = np.maximum(self.N - self.N_max, 0.0)
            self.entrance_queue = self.entrance_queue + overflow  # 초과분을 입구 대기큐로(인원 보존)
            self.N = np.minimum(self.N, self.N_max)
            m.warnings.append("초기 인원이 용량을 초과해 초과분을 입구 대기큐로 옮겼습니다(인원 보존).")

        # 초기 체류확률 부트스트랩
        self.p_stay = density_to_pstay(
            self.N, m.area, m.p_stay_base, m.dynamic_mask, cfg.dynamics, prev_pstay=None
        )
        self.arrival_ring = np.zeros((m.ring_len, m.n_total), dtype=np.float64)
        self.t = 0
        self.total_steps = cfg.total_steps
        self.cumulative_generated = 0.0

        # 정수 모드용 src 그룹(링크 인덱스 묶음)
        self._groups: List[Tuple[int, np.ndarray, np.ndarray]] = []
        if cfg.integer_mode and m.src.size:
            by_src: Dict[int, List[int]] = defaultdict(list)
            for li in range(m.src.size):
                by_src[int(m.src[li])].append(li)
            for s_idx, lis in by_src.items():
                idxs = np.array(lis, dtype=np.int64)
                self._groups.append((s_idx, idxs, m.weight[idxs].copy()))

        # 열차 이벤트 사전계산: 하차(시각->[(pf_idx, train)]), 정차창, 잔여 용량
        self._alight_events: Dict[int, List[Tuple[int, object]]] = defaultdict(list)
        self._board_windows: List[List[Tuple[int, int]]] = []   # platform 별 [(t_start,t_end)]
        self._train_remaining: List[List[float]] = []
        for k, pf in enumerate(m.platform_idx):
            trains = m.platform_trains[k]
            role = m.platform_role[k]
            windows: List[Tuple[int, int]] = []
            rem: List[float] = []
            for tr in trains:
                # 도착 지연(반-정규 jitter, >=0) → 정시성 깨짐을 데이터에 반영
                delay = int(round(abs(self.delay_rng.normal(0.0, tr.delay_std)))) if tr.delay_std > 0 else 0
                ta = int(tr.t_arrival) + delay
                if role != "board":          # 승차 전용 노드는 하차(유입) 없음
                    self._alight_events[ta].append((pf, tr))
                windows.append((ta, ta + int(tr.dwell_steps) - 1))
                # 가용 좌석 = 정원 − 재차(onboard_load)
                rem.append(max(0.0, float(tr.train_capacity) - float(tr.onboard_load)))
            # 정차창 겹침 경고(겹치면 탑승이 여러 열차로 분할됨)
            sw = sorted(windows)
            for a, b in zip(sw, sw[1:]):
                if b[0] <= a[1]:
                    m.warnings.append(f"승강장 {m.node_ids[pf]!r} 열차 정차창이 겹칩니다 — 탑승이 활성 열차들로 분할됩니다")
                    break
            self._board_windows.append(windows)
            self._train_remaining.append(rem)

        if self.capacity_enabled and cfg.integer_mode:
            m.warnings.append("용량 모드에서는 정수 모드가 연속으로 처리됩니다.")

        # 시작 시점(t=0) 자체발생/하차 반영 — 시작 이벤트 누락 방지
        S0 = self._generate_sources(0)
        if S0.any():
            if self.capacity_enabled:
                space = np.maximum(self.N_max - self.N, 0.0)
                space[m.is_sink] = np.inf
                admit = np.minimum(S0, space)
                self.entrance_queue = self.entrance_queue + (S0 - admit)
                self.N = self.N + admit
            else:
                self.N = self.N + S0
            self.cumulative_generated += float(S0.sum())
            self.p_stay = density_to_pstay(
                self.N, m.area, m.p_stay_base, m.dynamic_mask, self.cfg.dynamics, prev_pstay=None
            )

        self.recorder = Recorder(self.model, self.total_steps)
        # t=0 초기 상태 기록
        self.recorder.record(0, self.N, S0, np.zeros(m.n_total), self.p_stay)

    # ── 자체발생 ──
    def _generate_sources(self, time: int) -> np.ndarray:
        m = self.model
        cfg = self.cfg
        S = np.zeros(m.n_total, dtype=np.float64)
        # 공통요인 AR(1) 갱신 → 전역 수요 충격(노드 간 공간 상관 주입)
        dm = cfg.demand
        if dm.common_factor_sigma > 0:
            self._z = dm.common_factor_phi * self._z + float(self.common_rng.normal(0.0, dm.common_factor_sigma))
            gfac = self._day_mult * float(np.exp(self._z))
        else:
            gfac = self._day_mult
        hour = hour_of_day(time, cfg.dt_seconds, cfg.start_time_sec)
        for idx, spec in m.sources:
            S[idx] += sample_source(spec, hour, self.demand_rng, gfactor=gfac)
        for pf_idx, train in self._alight_events.get(time, []):
            S[pf_idx] += sample_alight(train, self.alight_rng)
        if cfg.integer_mode:
            S = stochastic_round(S, self.demand_rng)
        return S

    # ── 승강장 탑승(우선 유출) ──
    def _board(self, t: int) -> None:
        m = self.model
        for k, pf in enumerate(m.platform_idx):
            if m.platform_role[k] == "alight":   # 하차 전용 노드는 탑승(유출) 없음
                continue
            sink = m.train_sink_idx[k]
            windows = self._board_windows[k]
            # 활성(정차 중)인 모든 열차에 대해 탑승 처리(정차창 겹침 대응)
            for j, (t0, t1) in enumerate(windows):
                if not (t0 <= t <= t1):
                    continue
                rem = self._train_remaining[k][j]
                if rem <= 0:
                    continue
                avail = self.N[pf]
                if avail <= 0:
                    break
                cap = m.platform_trains[k][j].board_cap
                board = min(avail, cap, rem)
                if self.cfg.integer_mode:
                    board = min(float(stochastic_round(np.array(board), self.board_rng)), avail, rem)
                if board <= 0:
                    continue
                self.N[pf] -= board
                self.N[sink] += board
                self._train_remaining[k][j] -= board
                self._last_board[pf] += board  # 탑승 유출 기록(outflow 채널 일관성)

    # ── 엘리베이터: 주기마다 용량만큼 배치 유출 ──
    def _elevator(self, t: int) -> None:
        m = self.model
        for k, ev in enumerate(m.elevator_idx):
            cyc = m.elevator_cycle[k]
            if cyc < 1 or (t % cyc) != (cyc - 1):
                continue  # 운행 주기의 마지막 슬롯에만 운행
            avail = self.N[ev]
            cap = m.elevator_capacity[k]
            batch = min(avail, cap) if cap > 0 else avail
            if batch <= 0:
                continue
            if self.cfg.integer_mode:
                batch = float(np.floor(batch))
                if batch <= 0:
                    continue
            lis = m.elevator_links[k]
            flow = batch * m.weight[lis]                 # 출력 가중치(합=1)로 분배
            slots = (t + m.tau[lis]) % m.ring_len
            np.add.at(self.arrival_ring, (slots, m.dst[lis]), flow)
            self.N[ev] -= batch
            self._last_board[ev] += batch                # 유출 기록(outflow 채널)

    # ── 한 스텝 ──
    def step(self) -> None:
        m = self.model
        t = self.t

        # 0) 승강장 우선 탑승 + 엘리베이터 주기 배치 유출(둘 다 self._last_board 에 누적)
        self._last_board = np.zeros(m.n_total, dtype=np.float64)
        self._board(t)
        self._elevator(t)

        # 1) P_move
        p_move = 1.0 - self.p_stay

        # 2~3) 유출 분배 + 미래 도착 예약
        if m.src.size:
            if self.capacity_enabled:
                # CTM: 수신 노드 여유용량에 따라 상류 유출을 비례 제한(스필백)
                desired = self.N[m.src] * p_move[m.src] * m.weight
                intransit = self.arrival_ring.sum(axis=0)
                occ = self.N + intransit + self.entrance_queue
                free = np.maximum(self.N_max - occ, 0.0)
                free[m.is_sink] = np.inf
                D = np.zeros(m.n_total, dtype=np.float64)
                np.add.at(D, m.dst, desired)
                safe_D = np.where(D > 0.0, D, 1.0)
                scale = np.where(D > 0.0, np.minimum(1.0, free / safe_D), 1.0)
                flow = desired * scale[m.dst]
                actual_out = np.zeros(m.n_total, dtype=np.float64)
                np.add.at(actual_out, m.src, flow)
                stay_term = self.N - actual_out  # 체류분 + 막혀 잔류한 이동분
            elif self.cfg.integer_mode:
                flow = np.zeros(m.src.size, dtype=np.float64)
                retained = self.N.copy()
                for s_idx, idxs, w in self._groups:
                    out_int = float(stochastic_round(np.array(self.N[s_idx] * p_move[s_idx]), self.rng))
                    out_int = min(out_int, float(self.N[s_idx]))
                    parts = multinomial_split(int(out_int), w, self.rng)
                    flow[idxs] = parts
                    retained[s_idx] = self.N[s_idx] - out_int
                stay_term = retained
            else:
                flow = self.N[m.src] * p_move[m.src] * m.weight
                stay_term = self.N * self.p_stay

            # 게이트 등 throughput 상한: 노드별 총 유출을 cap 으로 제한(초과분은 노드에 잔류)
            if self._has_throughput:
                node_out = np.zeros(m.n_total, dtype=np.float64)
                np.add.at(node_out, m.src, flow)
                over = (self.throughput_cap > 0.0) & (node_out > self.throughput_cap)
                if np.any(over):
                    gscale = np.ones(m.n_total, dtype=np.float64)
                    gscale[over] = self.throughput_cap[over] / node_out[over]
                    flow = flow * gscale[m.src]
                    new_out = np.zeros(m.n_total, dtype=np.float64)
                    np.add.at(new_out, m.src, flow)
                    stay_term = stay_term + (node_out - new_out)

            slot_target = (t + m.tau) % m.ring_len
            np.add.at(self.arrival_ring, (slot_target, m.dst), flow)

            # 실제 유출 기록 = 링크 유출 + 탑승 유출(B-3 채널 일관성)
            actual_node_out = np.zeros(m.n_total, dtype=np.float64)
            np.add.at(actual_node_out, m.src, flow)
            outflow_node = actual_node_out + self._last_board
        else:
            stay_term = self.N * self.p_stay
            outflow_node = self._last_board.copy()

        # 4) 자체발생 (t+1)
        S = self._generate_sources(t + 1)
        self.cumulative_generated += float(S.sum())

        # 5) 도착 합산
        slot = (t + 1) % m.ring_len
        matured = self.arrival_ring[slot].copy()
        self.arrival_ring[slot] = 0.0

        # 6) 동시 갱신 (+ 용량 모드면 입구 대기큐로 스필백)
        if self.capacity_enabled:
            seeking = self.entrance_queue + matured + S
            space = np.maximum(self.N_max - stay_term, 0.0)
            space[m.is_sink] = np.inf
            admitted = np.minimum(seeking, space)
            self.entrance_queue = seeking - admitted
            rec_inflow = admitted
            self.N = np.maximum(stay_term + admitted, 0.0)
        else:
            rec_inflow = matured + S
            self.N = np.maximum(stay_term + rec_inflow, 0.0)

        # 7) 동적 체류확률 재계산
        self.p_stay = density_to_pstay(
            self.N, m.area, m.p_stay_base, m.dynamic_mask, self.cfg.dynamics,
            prev_pstay=self.p_stay,
        )

        self.t = t + 1
        # 8) 기록
        self.recorder.record(self.t, self.N, rec_inflow, outflow_node, self.p_stay)

    def run(self) -> Recorder:
        # 이미 일부 진행된 경우(step_many 등) 남은 스텝만 실행해 레코더 초과 방지
        while self.t < self.total_steps:
            self.step()
        return self.recorder

    # ── 보존 모니터(테스트/디버그) ──
    def total_mass(self) -> float:
        """현재 시점 전체 인원 + in-transit 잔량 + 입구 대기큐(스필백)."""
        return float(self.N.sum() + self.arrival_ring.sum() + self.entrance_queue.sum())


def run(cfg: SimConfig) -> Recorder:
    """설정으로부터 시뮬레이션을 실행하고 Recorder 를 반환."""
    return Simulator(cfg).run()
