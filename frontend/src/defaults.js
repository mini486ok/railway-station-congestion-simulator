// 기본(예제) 역사 설정 — examples/sample_station.json 과 동일한 구조.
// 모든 물리 공간은 서로 다른 방향의 이동을 위해 '양방향 2노드'로 모델링하고, 같은 물리 그룹으로 묶는다.

export const NODE_KINDS = [
  { key: "entrance", label: "출입구" },
  { key: "corridor", label: "통로" },
  { key: "stairs", label: "계단" },
  { key: "escalator", label: "에스컬레이터" },
  { key: "elevator", label: "엘리베이터" },
  { key: "gate", label: "게이트" },
  { key: "platform", label: "승강장" },
];

export const KIND_COLOR = {
  entrance: "#2563eb",
  corridor: "#64748b",
  stairs: "#9333ea",
  escalator: "#0891b2",
  elevator: "#0d9488",
  gate: "#ca8a04",
  platform: "#dc2626",
};

// 양방향 2노드 모델링 시 [진입(유입)방향, 진출(유출)방향] 라벨. 종류별로 자연스러운 표현.
export const DIRECTION_LABELS = {
  entrance: ["입구", "출구"],
  corridor: ["진입", "진출"],
  stairs: ["하행", "상행"],
  escalator: ["하행", "상행"],
  elevator: ["하강", "상승"],
  gate: ["진입", "진출"],
  platform: ["하차", "승차"],
};
// 양방향 쌍을 묶을 물리 그룹의 기본 이름(종류 라벨)
export const GROUP_BASE = {
  entrance: "출입구", corridor: "통로", stairs: "계단", escalator: "에스컬레이터",
  elevator: "엘리베이터", gate: "게이트", platform: "승강장",
};

export function defaultConfig() {
  return {
    name: "샘플 역사 (양방향 2노드 · 물리 그룹)",
    dt_seconds: 1.0,
    total_steps: 1800,
    start_time_sec: 25200.0,
    seed: 0,
    integer_mode: false,
    warmup_steps: 60,
    dynamics: {
      v0_default: 1.34,
      rho_max: 5.4,
      gamma: 1.913,
      p_stay_cap: 0.98,
      lpf_alpha: 0.3,
      capacity_enabled: true,
      spillback_enabled: true,
      rho_cap: 5.0,
    },
    export: {
      aggregate_steps: 10,
      aggregate_method: "mean",
      output_level: "group",
      noise_enabled: true,
      noise_model: "poisson",
      noise_sigma: 2.0,
      feature_channels: ["count", "density", "inflow", "outflow"],
    },
    // 전역 수요 변동(공간 상관 공통요인 + 런별 일간 배율) — AI 모델 학습 신호 다양화
    demand: { day_variability_sigma: 0.1, common_factor_phi: 0.75, common_factor_sigma: 0.1 },
    // 모든 물리 공간을 진입/진출 2노드로 분리하고 물리 그룹(출입구·대합실·게이트·계단·승강장1)으로 묶음.
    nodes: [
      // ── 출입구(입구/출구) ──
      {
        id: "E_in", name: "입구", kind: "entrance", direction: "입구", group: "출입구", area: 90, p_stay_base: 0.3,
        dynamic_pstay: true, exit_weight: 0, n0: 0, x: 60, y: 90, platform_role: "both", train_schedule: null,
        source: { type: "poisson", rate: 2.0, sigma: 0, profile: { hours: [0, 6, 8, 9, 12, 18, 19, 23], multipliers: [0.2, 0.6, 2.5, 1.5, 1.0, 2.2, 1.4, 0.4] } },
        trains: [],
      },
      { id: "E_out", name: "출구", kind: "entrance", direction: "출구", group: "출입구", area: 90, p_stay_base: 0.2, dynamic_pstay: true, exit_weight: 1.0, n0: 0, x: 60, y: 300, source: null, trains: [], platform_role: "both", train_schedule: null },
      // ── 대합실 통로(진입/진출) — 공유 공간이라 방향 노드 면적은 실제 면적의 절반(합=실제) ──
      // (참고) 노드 단위 출력에선 방향 노드 count/면적이 절반 기준 → 물리 실제값은 '물리 그룹별' 출력에서 일치.
      { id: "C_in", name: "대합실·진입", kind: "corridor", direction: "진입", group: "대합실", area: 140, p_stay_base: 0.4, dynamic_pstay: true, exit_weight: 0, n0: 0, x: 240, y: 90, source: null, trains: [], platform_role: "both", train_schedule: null },
      { id: "C_out", name: "대합실·진출", kind: "corridor", direction: "진출", group: "대합실", area: 140, p_stay_base: 0.4, dynamic_pstay: true, exit_weight: 0, n0: 0, x: 240, y: 300, source: null, trains: [], platform_role: "both", train_schedule: null },
      // ── 게이트(진입/진출) — 개찰구 처리율(throughput) 적용 ──
      { id: "G_in", name: "진입 게이트", kind: "gate", direction: "진입", group: "게이트", area: 18, p_stay_base: 0.2, dynamic_pstay: true, throughput_cap: 22, exit_weight: 0, n0: 0, x: 420, y: 90, source: null, trains: [], platform_role: "both", train_schedule: null },
      { id: "G_out", name: "진출 게이트", kind: "gate", direction: "진출", group: "게이트", area: 18, p_stay_base: 0.2, dynamic_pstay: true, throughput_cap: 22, exit_weight: 0, n0: 0, x: 420, y: 300, source: null, trains: [], platform_role: "both", train_schedule: null },
      // ── 계단(하행/상행) — 공유 공간 절반 면적 ──
      { id: "T_dn", name: "계단·하행", kind: "stairs", direction: "하행", group: "계단", area: 16, p_stay_base: 0.45, dynamic_pstay: true, exit_weight: 0, n0: 0, x: 600, y: 90, source: null, trains: [], platform_role: "both", train_schedule: null },
      { id: "T_up", name: "계단·상행", kind: "stairs", direction: "상행", group: "계단", area: 16, p_stay_base: 0.5, dynamic_pstay: true, exit_weight: 0, n0: 0, x: 600, y: 300, source: null, trains: [], platform_role: "both", train_schedule: null },
      // ── 승강장1(하차/승차) — 공유 승강장 면적의 절반씩(합=실제 승강장 면적) ──
      {
        id: "P_board", name: "승강장1·승차", kind: "platform", direction: "승차", group: "승강장1", area: 130, p_stay_base: 0.55,
        dynamic_pstay: true, exit_weight: 0, n0: 0, x: 780, y: 90, source: null, trains: [],
        platform_role: "board",
        train_schedule: { first_arrival: 100, headway: 210, num_trains: 0, alight_mean: 0, alight_sigma: 0, alight_dist: "normal", dwell_steps: 32, train_capacity: 1100, board_cap: 34, onboard_load: 0, delay_std: 0 },
      },
      {
        id: "P_alight", name: "승강장1·하차", kind: "platform", direction: "하차", group: "승강장1", area: 130, p_stay_base: 0.45,
        dynamic_pstay: true, exit_weight: 0, n0: 0, x: 780, y: 300, source: null, trains: [],
        platform_role: "alight",
        train_schedule: { first_arrival: 100, headway: 210, num_trains: 0, alight_mean: 110, alight_sigma: 15, alight_dist: "normal", dwell_steps: 32, train_capacity: 1100, board_cap: 34, onboard_load: 0, delay_std: 0 },
      },
    ],
    // 진입: 입구→대합실→게이트→계단→승차 / 진출: 하차→계단→게이트→대합실→출구
    links: [
      { src: "E_in", dst: "C_in", distance: 15, weight: 1.0, tau: null },
      { src: "C_in", dst: "G_in", distance: 25, weight: 1.0, tau: null },
      { src: "G_in", dst: "T_dn", distance: 20, weight: 1.0, tau: null },
      { src: "T_dn", dst: "P_board", distance: 25, weight: 1.0, tau: null },
      { src: "P_alight", dst: "T_up", distance: 25, weight: 1.0, tau: null },
      { src: "T_up", dst: "G_out", distance: 20, weight: 1.0, tau: null },
      { src: "G_out", dst: "C_out", distance: 25, weight: 1.0, tau: null },
      { src: "C_out", dst: "E_out", distance: 15, weight: 1.0, tau: null },
    ],
  };
}

export const CHART_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#ca8a04", "#9333ea", "#0891b2", "#db2777", "#65a30d", "#e11d48", "#0d9488"];

// 물리 그룹 키(빈값이면 노드 자신). 같은 그룹 = 물리적으로 하나의 장소.
export const groupOf = (n) => (n && n.group && n.group.trim()) || n.id;

// 노드 id 기반 안정 색상(노드 추가/삭제 시 색이 밀리지 않도록)
export function colorOf(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CHART_COLORS[h % CHART_COLORS.length];
}
