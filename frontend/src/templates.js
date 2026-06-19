import { defaultConfig } from "./defaults";

// 공통 시뮬 설정
function base(over = {}) {
  return {
    name: "역사", dt_seconds: 1.0, total_steps: 1800, start_time_sec: 28800, seed: 0,
    integer_mode: false, warmup_steps: 60,
    dynamics: { v0_default: 1.34, rho_max: 5.4, gamma: 1.913, p_stay_cap: 0.98, lpf_alpha: 0.3, capacity_enabled: true, spillback_enabled: true, rho_cap: 5.0 },
    export: { aggregate_steps: 10, aggregate_method: "mean", output_level: "group", noise_enabled: true, noise_model: "gaussian", noise_sigma: 2.0, feature_channels: ["count", "density", "inflow", "outflow"] },
    demand: { day_variability_sigma: 0, common_factor_phi: 0, common_factor_sigma: 0 },
    ...over,
  };
}
function nd(o) {
  return { name: o.id, direction: "", group: "", kind: "corridor", area: 30, p_stay_base: 0.4, dynamic_pstay: true,
    exit_weight: 0, throughput_cap: 0, elevator_cycle: 0, elevator_capacity: 0, n0: 0, source: null, trains: [],
    platform_role: "both", train_schedule: null, x: 0, y: 0, ...o };
}
function poisson(rate) {
  return { type: "poisson", rate, sigma: 0, profile: { hours: [0, 6, 8, 9, 12, 18, 19, 23], multipliers: [0.2, 0.6, 2.5, 1.5, 1.0, 2.2, 1.4, 0.4] } };
}
// 양방향 승강장 스케줄(하차 평균 alight, 0이면 승차 전용).
// delay_std=0: 같은 물리 열차를 하차/승차 2노드로 분리 모델링하므로, 지연을 독립 샘플링하면
// 한 열차의 하차 버스트와 승차 정차창이 어긋난다 → 두 노드의 도착을 결정론적으로 동기화한다.
// (수요 다양성은 demand 공통요인·일간변동·Poisson·노선별 headway 위상차로 확보)
function sched(alight, over = {}) {
  return { first_arrival: 100, headway: 300, num_trains: 0, alight_mean: alight, alight_sigma: 15,
    alight_dist: "normal", dwell_steps: 30, train_capacity: 800, board_cap: 25, onboard_load: 0, delay_std: 0, ...over };
}
// 출입구 양방향 쌍(입구=source, 출구=exit)
function entrancePair(idIn, idOut, group, posIn, posOut, rate = 2.0) {
  return [
    nd({ id: idIn, name: `${group}·입구`, kind: "entrance", direction: "입구", group, area: 40, p_stay_base: 0.3, source: poisson(rate), x: posIn[0], y: posIn[1] }),
    nd({ id: idOut, name: `${group}·출구`, kind: "entrance", direction: "출구", group, area: 40, p_stay_base: 0.2, exit_weight: 1.0, x: posOut[0], y: posOut[1] }),
  ];
}
// 승강장 양방향 쌍(하차/승차) — 같은 승강장을 둘이 나눠 쓰므로 방향당 면적은 절반(합=실제 면적)
function platformPair(idAl, idBo, group, posAl, posBo, alight = 110, over = {}) {
  return [
    nd({ id: idAl, name: `${group}·하차`, kind: "platform", direction: "하차", group, area: 130, p_stay_base: 0.45, platform_role: "alight", train_schedule: sched(alight, over), x: posAl[0], y: posAl[1] }),
    nd({ id: idBo, name: `${group}·승차`, kind: "platform", direction: "승차", group, area: 130, p_stay_base: 0.55, platform_role: "board", train_schedule: sched(0, over), x: posBo[0], y: posBo[1] }),
  ];
}

// ── 단순(출입구–통로–승강장, 모두 양방향 쌍) ──
function simpleConfig() {
  return base({
    name: "단순 통로형 (양방향)",
    nodes: [
      ...entrancePair("E_in", "E_out", "출입구", [60, 100], [60, 300], 2.0),
      nd({ id: "C_in", name: "통로·진입", kind: "corridor", direction: "진입", group: "통로", area: 50, x: 300, y: 100 }),
      nd({ id: "C_out", name: "통로·진출", kind: "corridor", direction: "진출", group: "통로", area: 50, x: 300, y: 300 }),
      ...platformPair("P_al", "P_bo", "승강장", [560, 300], [560, 100]),
    ],
    links: [
      { src: "E_in", dst: "C_in", distance: 20, weight: 1.0, tau: null },
      { src: "C_in", dst: "P_bo", distance: 35, weight: 1.0, tau: null },
      { src: "P_al", dst: "C_out", distance: 35, weight: 1.0, tau: null },
      { src: "C_out", dst: "E_out", distance: 20, weight: 1.0, tau: null },
    ],
  });
}

// ── 엘리베이터 환승(수직 동선 양방향) ──
function elevatorConfig() {
  return base({
    name: "엘리베이터 환승 (양방향)",
    nodes: [
      ...entrancePair("E_in", "E_out", "출입구", [60, 110], [60, 320], 1.5),
      // 같은 승강기 1대를 방향별로 나눠 모델링 → 방향당 면적·용량 절반
      nd({ id: "EV_dn", name: "엘리베이터·하강", kind: "elevator", direction: "하강", group: "엘리베이터", area: 6, elevator_cycle: 8, elevator_capacity: 8, x: 320, y: 110 }),
      nd({ id: "EV_up", name: "엘리베이터·상승", kind: "elevator", direction: "상승", group: "엘리베이터", area: 6, elevator_cycle: 8, elevator_capacity: 8, x: 320, y: 320 }),
      ...platformPair("P_al", "P_bo", "승강장(지하)", [580, 320], [580, 110]),
    ],
    links: [
      { src: "E_in", dst: "EV_dn", distance: 8, weight: 1.0, tau: null },
      { src: "EV_dn", dst: "P_bo", distance: 30, weight: 1.0, tau: null },
      { src: "P_al", dst: "EV_up", distance: 30, weight: 1.0, tau: null },
      { src: "EV_up", dst: "E_out", distance: 8, weight: 1.0, tau: null },
    ],
  });
}

// ── 2개 승강장 분기(상·하행, 게이트 throughput) ──
function twoPlatformConfig() {
  return base({
    name: "2개 승강장 분기 (양방향)",
    nodes: [
      ...entrancePair("E_in", "E_out", "출입구", [40, 200], [40, 380], 2.5),
      nd({ id: "G_in", name: "진입 게이트", kind: "gate", direction: "진입", group: "게이트", area: 20, p_stay_base: 0.2, throughput_cap: 30, x: 240, y: 200 }),
      nd({ id: "G_out", name: "진출 게이트", kind: "gate", direction: "진출", group: "게이트", area: 20, p_stay_base: 0.2, throughput_cap: 30, x: 240, y: 380 }),
      nd({ id: "C_in", name: "대합실·진입", kind: "corridor", direction: "진입", group: "대합실", area: 80, x: 440, y: 200 }),
      nd({ id: "C_out", name: "대합실·진출", kind: "corridor", direction: "진출", group: "대합실", area: 80, x: 440, y: 380 }),
      ...platformPair("P1_al", "P1_bo", "승강장1(상행)", [700, 80], [700, 200], 120, { first_arrival: 120, headway: 360 }),
      ...platformPair("P2_al", "P2_bo", "승강장2(하행)", [700, 360], [700, 480], 120, { first_arrival: 240, headway: 360 }),
    ],
    links: [
      { src: "E_in", dst: "G_in", distance: 15, weight: 1.0, tau: null },
      { src: "G_in", dst: "C_in", distance: 25, weight: 1.0, tau: null },
      { src: "C_in", dst: "P1_bo", distance: 40, weight: 0.5, tau: null },
      { src: "C_in", dst: "P2_bo", distance: 40, weight: 0.5, tau: null },
      { src: "P1_al", dst: "C_out", distance: 40, weight: 1.0, tau: null },
      { src: "P2_al", dst: "C_out", distance: 40, weight: 1.0, tau: null },
      { src: "C_out", dst: "G_out", distance: 25, weight: 1.0, tau: null },
      { src: "G_out", dst: "E_out", distance: 15, weight: 1.0, tau: null },
    ],
  });
}

// ── 환승역(2개 노선 + 환승통로, 양방향) ──
function transferConfig() {
  return base({
    name: "환승역 (2개 노선·환승통로)",
    total_steps: 2400,
    // 전역 공통요인(공간 상관) + 런별 일간 변동으로 STGCN 학습 신호 다양화
    demand: { day_variability_sigma: 0.12, common_factor_phi: 0.8, common_factor_sigma: 0.15 },
    nodes: [
      ...entrancePair("E_in", "E_out", "출입구", [40, 240], [40, 420], 3.0),
      nd({ id: "G_in", name: "진입 게이트", kind: "gate", direction: "진입", group: "게이트", area: 24, p_stay_base: 0.2, throughput_cap: 40, x: 220, y: 240 }),
      nd({ id: "G_out", name: "진출 게이트", kind: "gate", direction: "진출", group: "게이트", area: 24, p_stay_base: 0.2, throughput_cap: 40, x: 220, y: 420 }),
      // 대합실(신규 진입객이 노선을 고르는 곳) — 양방향
      nd({ id: "C_in", name: "대합실·진입", kind: "corridor", direction: "진입", group: "대합실", area: 90, p_stay_base: 0.4, x: 420, y: 240 }),
      nd({ id: "C_out", name: "대합실·진출", kind: "corridor", direction: "진출", group: "대합실", area: 90, p_stay_base: 0.4, x: 420, y: 420 }),
      // 1호선 승강장
      ...platformPair("L1_al", "L1_bo", "1호선", [640, 80], [640, 220], 130, { first_arrival: 100, headway: 280 }),
      // 환승통로(하차 승객의 노선 간 이동 전용, 1↔2 양방향)
      nd({ id: "TR_a", name: "환승통로·1→2", kind: "corridor", direction: "1→2", group: "환승통로", area: 45, p_stay_base: 0.45, x: 860, y: 160 }),
      nd({ id: "TR_b", name: "환승통로·2→1", kind: "corridor", direction: "2→1", group: "환승통로", area: 45, p_stay_base: 0.45, x: 860, y: 360 }),
      // 2호선 승강장
      ...platformPair("L2_al", "L2_bo", "2호선", [1080, 360], [1080, 500], 140, { first_arrival: 160, headway: 320 }),
    ],
    // 신규 진입은 대합실에서 노선을 직접 선택해 탑승 / 하차 승객만 환승통로로 노선 간 이동 또는 진출.
    // 환승률(하차→환승)은 주요 환승 거점 가정의 정적 비율(시간대 OD 변화는 미반영) — 필요시 가중치 편집.
    links: [
      { src: "E_in", dst: "G_in", distance: 15, weight: 1.0, tau: null },
      { src: "G_in", dst: "C_in", distance: 25, weight: 1.0, tau: null },
      { src: "C_in", dst: "L1_bo", distance: 45, weight: 0.55, tau: null },  // 대합실 → 1호선 탑승
      { src: "C_in", dst: "L2_bo", distance: 70, weight: 0.45, tau: null },  // 대합실 → 2호선 탑승
      { src: "L1_al", dst: "TR_a", distance: 45, weight: 0.45, tau: null },  // 1호선 하차 → 2호선 환승
      { src: "L1_al", dst: "C_out", distance: 60, weight: 0.55, tau: null }, // 1호선 하차 → 진출
      { src: "TR_a", dst: "L2_bo", distance: 45, weight: 1.0, tau: null },
      { src: "L2_al", dst: "TR_b", distance: 45, weight: 0.4, tau: null },   // 2호선 하차 → 1호선 환승
      { src: "L2_al", dst: "C_out", distance: 60, weight: 0.6, tau: null },  // 2호선 하차 → 진출
      { src: "TR_b", dst: "L1_bo", distance: 45, weight: 1.0, tau: null },
      { src: "C_out", dst: "G_out", distance: 25, weight: 1.0, tau: null },
      { src: "G_out", dst: "E_out", distance: 15, weight: 1.0, tau: null },
    ],
  });
}

// ── 심층 역사(계단·에스컬레이터·엘리베이터 병렬 수직동선, 양방향) ──
function deepStationConfig() {
  return base({
    name: "심층 역사 (계단·ES·EV 병렬)",
    demand: { day_variability_sigma: 0.1, common_factor_phi: 0.75, common_factor_sigma: 0.12 },
    nodes: [
      ...entrancePair("E_in", "E_out", "출입구", [40, 200], [40, 400], 2.8),
      nd({ id: "C_in", name: "대합실·진입", kind: "corridor", direction: "진입", group: "대합실", area: 90, x: 220, y: 200 }),
      nd({ id: "C_out", name: "대합실·진출", kind: "corridor", direction: "진출", group: "대합실", area: 90, x: 220, y: 400 }),
      nd({ id: "G_in", name: "진입 게이트", kind: "gate", direction: "진입", group: "게이트", area: 22, p_stay_base: 0.2, throughput_cap: 45, x: 400, y: 200 }),
      nd({ id: "G_out", name: "진출 게이트", kind: "gate", direction: "진출", group: "게이트", area: 22, p_stay_base: 0.2, throughput_cap: 45, x: 400, y: 400 }),
      // 하행 3종(계단/ES/EV) — throughput_cap 은 '설비군 전체'(여러 대/넓은 폭) 기준 처리율. ES가 하행 선호로 병목.
      nd({ id: "ST_dn", name: "계단·하행", kind: "stairs", direction: "하행", group: "계단", area: 14, p_stay_base: 0.5, throughput_cap: 60, x: 600, y: 120 }),
      nd({ id: "ES_dn", name: "에스컬레이터·하행", kind: "escalator", direction: "하행", group: "에스컬레이터", area: 12, p_stay_base: 0.55, throughput_cap: 45, x: 600, y: 220 }),
      nd({ id: "EV_dn", name: "엘리베이터·하강", kind: "elevator", direction: "하강", group: "엘리베이터", area: 6, elevator_cycle: 10, elevator_capacity: 6, x: 600, y: 320 }),
      // 상행 3종
      nd({ id: "ST_up", name: "계단·상행", kind: "stairs", direction: "상행", group: "계단", area: 14, p_stay_base: 0.55, throughput_cap: 60, x: 600, y: 420 }),
      nd({ id: "ES_up", name: "에스컬레이터·상행", kind: "escalator", direction: "상행", group: "에스컬레이터", area: 12, p_stay_base: 0.55, throughput_cap: 45, x: 600, y: 520 }),
      nd({ id: "EV_up", name: "엘리베이터·상승", kind: "elevator", direction: "상승", group: "엘리베이터", area: 6, elevator_cycle: 10, elevator_capacity: 6, x: 600, y: 620 }),
      ...platformPair("P_al", "P_bo", "승강장", [840, 460], [840, 220], 150),
    ],
    links: [
      { src: "E_in", dst: "C_in", distance: 15, weight: 1.0, tau: null },
      { src: "C_in", dst: "G_in", distance: 25, weight: 1.0, tau: null },
      // 진입: 게이트 → 하행 3종(분기) → 승차
      { src: "G_in", dst: "ST_dn", distance: 20, weight: 0.2, tau: null },
      { src: "G_in", dst: "ES_dn", distance: 20, weight: 0.6, tau: null },
      { src: "G_in", dst: "EV_dn", distance: 20, weight: 0.2, tau: null },
      { src: "ST_dn", dst: "P_bo", distance: 25, weight: 1.0, tau: null },
      { src: "ES_dn", dst: "P_bo", distance: 25, weight: 1.0, tau: null },
      { src: "EV_dn", dst: "P_bo", distance: 25, weight: 1.0, tau: null },
      // 진출: 하차 → 상행 3종(분기) → 게이트 → 대합실 → 출구
      { src: "P_al", dst: "ST_up", distance: 25, weight: 0.25, tau: null },
      { src: "P_al", dst: "ES_up", distance: 25, weight: 0.55, tau: null },
      { src: "P_al", dst: "EV_up", distance: 25, weight: 0.2, tau: null },
      { src: "ST_up", dst: "G_out", distance: 20, weight: 1.0, tau: null },
      { src: "ES_up", dst: "G_out", distance: 20, weight: 1.0, tau: null },
      { src: "EV_up", dst: "G_out", distance: 20, weight: 1.0, tau: null },
      { src: "G_out", dst: "C_out", distance: 25, weight: 1.0, tau: null },
      { src: "C_out", dst: "E_out", distance: 15, weight: 1.0, tau: null },
    ],
  });
}

export const BUILTIN_TEMPLATES = [
  { id: "directional", name: "기본: 양방향 표준역", description: "입구→대합실→게이트→계단→승강장(승차) / 하차→…→출구. 모든 공간이 양방향 2노드·물리 그룹.", make: () => defaultConfig() },
  { id: "simple", name: "단순 통로형", description: "출입구·통로·승강장을 각각 양방향 2노드로. 가장 작은 예제.", make: simpleConfig },
  { id: "elevator", name: "엘리베이터 환승", description: "수직 동선을 엘리베이터(하강/상승) 쌍으로. 주기 배치 수송.", make: elevatorConfig },
  { id: "twoplatform", name: "2개 승강장 분기", description: "대합실에서 상·하행 승강장으로 분기. 게이트 throughput 적용.", make: twoPlatformConfig },
  { id: "transfer", name: "환승역(2개 노선)", description: "1·2호선 + 환승통로. 하차 승객이 환승/진출로 분기하는 복합 흐름.", make: transferConfig },
  { id: "deep", name: "심층 역사(병렬 수직동선)", description: "계단·에스컬레이터·엘리베이터를 병렬로. 14노드 7그룹의 복잡 구성.", make: deepStationConfig },
];

// ── 사용자 템플릿(localStorage) ──
const KEY = "sc_user_templates_v1";
export function loadUserTemplates() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}
export function saveUserTemplate(name, config) {
  const t = loadUserTemplates();
  t[name] = config;
  localStorage.setItem(KEY, JSON.stringify(t));
}
export function deleteUserTemplate(name) {
  const t = loadUserTemplates();
  delete t[name];
  localStorage.setItem(KEY, JSON.stringify(t));
}
