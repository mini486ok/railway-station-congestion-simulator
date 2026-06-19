// 기본(예제) 역사 설정 — examples/sample_station.json 과 동일한 구조.

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

export function defaultConfig() {
  return {
    name: "샘플 역사",
    dt_seconds: 1.0,
    total_steps: 1800,
    start_time_sec: 28800.0,
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
      noise_enabled: true,
      noise_model: "gaussian",
      noise_sigma: 2.0,
      feature_channels: ["count", "density", "inflow", "outflow"],
    },
    nodes: [
      {
        id: "E_in", name: "입구", kind: "entrance", group: "출입구", area: 40, p_stay_base: 0.3,
        dynamic_pstay: true, exit_weight: 0, n0: 0, x: 60, y: 110,
        source: {
          type: "poisson", rate: 2.0, sigma: 0,
          profile: { hours: [0, 6, 8, 9, 12, 18, 19, 23], multipliers: [0.2, 0.6, 2.5, 1.5, 1.0, 2.2, 1.4, 0.4] },
        },
        trains: [],
      },
      { id: "G_in", name: "진입 게이트", kind: "gate", group: "게이트", area: 18, p_stay_base: 0.2, dynamic_pstay: true, exit_weight: 0, n0: 0, x: 300, y: 110, source: null, trains: [] },
      {
        id: "P1", name: "승강장(상행)", kind: "platform", area: 250, p_stay_base: 0.55,
        dynamic_pstay: true, exit_weight: 0, n0: 0, x: 560, y: 210, source: null,
        trains: [
          { t_arrival: 300, alight_mean: 110, alight_sigma: 15, alight_dist: "normal", dwell_steps: 30, train_capacity: 800, board_cap: 25 },
          { t_arrival: 700, alight_mean: 110, alight_sigma: 15, alight_dist: "normal", dwell_steps: 30, train_capacity: 800, board_cap: 25 },
          { t_arrival: 1100, alight_mean: 110, alight_sigma: 15, alight_dist: "normal", dwell_steps: 30, train_capacity: 800, board_cap: 25 },
          { t_arrival: 1500, alight_mean: 110, alight_sigma: 15, alight_dist: "normal", dwell_steps: 30, train_capacity: 800, board_cap: 25 },
        ],
      },
      { id: "G_out", name: "진출 게이트", kind: "gate", group: "게이트", area: 18, p_stay_base: 0.2, dynamic_pstay: true, exit_weight: 0, n0: 0, x: 300, y: 310, source: null, trains: [] },
      { id: "E_out", name: "출구", kind: "entrance", group: "출입구", area: 40, p_stay_base: 0.2, dynamic_pstay: true, exit_weight: 1.0, n0: 0, x: 60, y: 310, source: null, trains: [] },
    ],
    // 단방향: 입구→진입게이트→승강장 (진입) / 승강장→진출게이트→출구 (진출)
    links: [
      { src: "E_in", dst: "G_in", distance: 15, weight: 1.0, tau: null },
      { src: "G_in", dst: "P1", distance: 35, weight: 1.0, tau: null },
      { src: "P1", dst: "G_out", distance: 35, weight: 1.0, tau: null },
      { src: "G_out", dst: "E_out", distance: 15, weight: 1.0, tau: null },
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
