import { defaultConfig } from "./defaults";

// 공통 시뮬 설정
function base(over = {}) {
  return {
    name: "역사", dt_seconds: 1.0, total_steps: 1800, start_time_sec: 28800, seed: 0,
    integer_mode: false, warmup_steps: 60,
    dynamics: { v0_default: 1.34, rho_max: 5.4, gamma: 1.913, p_stay_cap: 0.98, lpf_alpha: 0.3, capacity_enabled: true, spillback_enabled: true, rho_cap: 5.0 },
    export: { aggregate_steps: 10, aggregate_method: "mean", noise_enabled: true, noise_model: "gaussian", noise_sigma: 2.0, feature_channels: ["count", "density", "inflow", "outflow"] },
    demand: { day_variability_sigma: 0, common_factor_phi: 0, common_factor_sigma: 0 },
    ...over,
  };
}
function nd(o) {
  return { name: o.id, group: "", kind: "corridor", area: 30, p_stay_base: 0.4, dynamic_pstay: true,
    exit_weight: 0, throughput_cap: 0, elevator_cycle: 0, elevator_capacity: 0, n0: 0, source: null, trains: [], x: 0, y: 0, ...o };
}
function poisson(rate) {
  return { type: "poisson", rate, sigma: 0, profile: { hours: [0, 6, 8, 9, 12, 18, 19, 23], multipliers: [0.2, 0.6, 2.5, 1.5, 1.0, 2.2, 1.4, 0.4] } };
}
function train(t) {
  return { t_arrival: t, alight_mean: 100, alight_sigma: 15, alight_dist: "normal", dwell_steps: 30, train_capacity: 800, board_cap: 25 };
}
const trains4 = [train(300), train(700), train(1100), train(1500)];

// ── 단순(1 출입구 양방향) ──
function simpleConfig() {
  return base({
    name: "단순 통로형",
    nodes: [
      nd({ id: "E1", name: "출입구", kind: "entrance", area: 40, p_stay_base: 0.3, exit_weight: 0.5, source: poisson(2.0), x: 80, y: 200 }),
      nd({ id: "C1", name: "중앙 통로", kind: "corridor", area: 100, p_stay_base: 0.4, x: 320, y: 200 }),
      nd({ id: "P1", name: "승강장", kind: "platform", area: 250, p_stay_base: 0.55, trains: trains4, x: 560, y: 200 }),
    ],
    links: [
      { src: "E1", dst: "C1", distance: 20, weight: 1.0, tau: null },
      { src: "C1", dst: "E1", distance: 20, weight: 0.5, tau: null },
      { src: "C1", dst: "P1", distance: 35, weight: 0.5, tau: null },
      { src: "P1", dst: "C1", distance: 35, weight: 1.0, tau: null },
    ],
  });
}

// ── 엘리베이터 포함(주기 배치 수송) ──
function elevatorConfig() {
  return base({
    name: "엘리베이터 환승",
    nodes: [
      nd({ id: "E1", name: "출입구", kind: "entrance", group: "출입구", area: 40, p_stay_base: 0.3, exit_weight: 0.4, source: poisson(1.5), x: 80, y: 120 }),
      nd({ id: "EV", name: "엘리베이터", kind: "elevator", area: 12, elevator_cycle: 8, elevator_capacity: 15, x: 320, y: 120 }),
      nd({ id: "P1", name: "승강장(지하)", kind: "platform", area: 220, p_stay_base: 0.55, trains: trains4, x: 560, y: 200 }),
      nd({ id: "EV2", name: "엘리베이터(상행)", kind: "elevator", area: 12, elevator_cycle: 8, elevator_capacity: 15, x: 320, y: 300 }),
      nd({ id: "E2", name: "출구", kind: "entrance", group: "출입구", area: 40, p_stay_base: 0.2, exit_weight: 1.0, x: 80, y: 300 }),
    ],
    links: [
      { src: "E1", dst: "EV", distance: 8, weight: 1.0, tau: null },
      { src: "EV", dst: "P1", distance: 30, weight: 1.0, tau: null },
      { src: "P1", dst: "EV2", distance: 30, weight: 1.0, tau: null },
      { src: "EV2", dst: "E2", distance: 8, weight: 1.0, tau: null },
    ],
  });
}

// ── 2개 승강장 분기 ──
function twoPlatformConfig() {
  return base({
    name: "2개 승강장",
    nodes: [
      nd({ id: "E_in", name: "입구", kind: "entrance", group: "출입구", area: 40, p_stay_base: 0.3, source: poisson(2.5), x: 60, y: 200 }),
      nd({ id: "G_in", name: "진입 게이트", kind: "gate", group: "게이트", area: 20, p_stay_base: 0.2, throughput_cap: 30, x: 280, y: 200 }),
      nd({ id: "C", name: "대합실", kind: "corridor", area: 150, p_stay_base: 0.4, x: 480, y: 200 }),
      nd({ id: "P1", name: "승강장1(상행)", kind: "platform", area: 220, p_stay_base: 0.55, trains: [train(300), train(900), train(1500)], x: 720, y: 110 }),
      nd({ id: "P2", name: "승강장2(하행)", kind: "platform", area: 220, p_stay_base: 0.55, trains: [train(500), train(1100), train(1700)], x: 720, y: 300 }),
      nd({ id: "G_out", name: "진출 게이트", kind: "gate", group: "게이트", area: 20, p_stay_base: 0.2, throughput_cap: 30, x: 280, y: 360 }),
      nd({ id: "E_out", name: "출구", kind: "entrance", group: "출입구", area: 40, p_stay_base: 0.2, exit_weight: 1.0, x: 60, y: 360 }),
    ],
    links: [
      { src: "E_in", dst: "G_in", distance: 15, weight: 1.0, tau: null },
      { src: "G_in", dst: "C", distance: 25, weight: 1.0, tau: null },
      { src: "C", dst: "P1", distance: 40, weight: 0.5, tau: null },
      { src: "C", dst: "P2", distance: 40, weight: 0.5, tau: null },
      { src: "P1", dst: "C", distance: 40, weight: 1.0, tau: null },
      { src: "P2", dst: "C", distance: 40, weight: 1.0, tau: null },
      { src: "C", dst: "G_out", distance: 25, weight: 0.0, tau: null },
      { src: "G_out", dst: "E_out", distance: 15, weight: 1.0, tau: null },
    ],
  });
}

export const BUILTIN_TEMPLATES = [
  { id: "directional", name: "기본: 단방향 역사", description: "입구→진입게이트→승강장→진출게이트→출구. 입구/출구·게이트를 물리 그룹으로 합산.", make: () => defaultConfig() },
  { id: "simple", name: "단순 통로형", description: "출입구→통로→승강장 (1개 출입구, 양방향).", make: simpleConfig },
  { id: "elevator", name: "엘리베이터 환승", description: "출입구→엘리베이터→승강장→엘리베이터→출구. 엘리베이터 주기 배치 수송.", make: elevatorConfig },
  { id: "twoplatform", name: "2개 승강장 분기", description: "대합실에서 상·하행 승강장으로 분기. 게이트 throughput 적용.", make: twoPlatformConfig },
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
