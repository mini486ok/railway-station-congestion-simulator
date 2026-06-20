import { defaultConfig } from "./defaults";

// 공통 시뮬 설정
function base(over = {}) {
  return {
    name: "역사", dt_seconds: 1.0, total_steps: 1800, start_time_sec: 25200, seed: 0,
    integer_mode: false, warmup_steps: 60,
    dynamics: { v0_default: 1.34, rho_max: 5.4, gamma: 1.913, p_stay_cap: 0.98, lpf_alpha: 0.3, capacity_enabled: true, spillback_enabled: true, rho_cap: 5.0 },
    // 관측 노이즈는 Poisson(=평균 비례 상대 노이즈) — 고정 σ 가우시안은 저수요 노드 신호를 압도하므로.
    export: { aggregate_steps: 10, aggregate_method: "mean", output_level: "group", noise_enabled: true, noise_model: "poisson", noise_sigma: 2.0, feature_channels: ["count", "density", "inflow", "outflow"] },
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
  return { first_arrival: 100, headway: 210, num_trains: 0, alight_mean: alight, alight_sigma: 15,
    alight_dist: "normal", dwell_steps: 32, train_capacity: 1200, board_cap: 38, onboard_load: 0, delay_std: 0, ...over };
}
// 출입구 양방향 쌍(입구=source, 출구=exit)
function entrancePair(idIn, idOut, group, posIn, posOut, rate = 2.0) {
  return [
    nd({ id: idIn, name: `${group}·입구`, kind: "entrance", direction: "입구", group, area: 95, p_stay_base: 0.3, source: poisson(rate), x: posIn[0], y: posIn[1] }),
    nd({ id: idOut, name: `${group}·출구`, kind: "entrance", direction: "출구", group, area: 95, p_stay_base: 0.2, exit_weight: 1.0, x: posOut[0], y: posOut[1] }),
  ];
}
// 승강장 양방향 쌍(하차/승차) — 같은 승강장을 둘이 나눠 쓰므로 방향당 면적은 절반(합=실제 면적)
function platformPair(idAl, idBo, group, posAl, posBo, alight = 110, over = {}, area = 130) {
  return [
    nd({ id: idAl, name: `${group}·하차`, kind: "platform", direction: "하차", group, area, p_stay_base: 0.45, platform_role: "alight", train_schedule: sched(alight, over), x: posAl[0], y: posAl[1] }),
    nd({ id: idBo, name: `${group}·승차`, kind: "platform", direction: "승차", group, area, p_stay_base: 0.55, platform_role: "board", train_schedule: sched(0, over), x: posBo[0], y: posBo[1] }),
  ];
}

// 수직동선 양방향 쌍(하행/상행 또는 하강/상승). 공유 설비라 방향당 면적은 절반.
// kind: stairs | escalator | elevator. 종류별 현실적 처리율/주기를 기본 적용.
const VERT_LABEL = { stairs: ["하행", "상행"], escalator: ["하행", "상행"], elevator: ["하강", "상승"] };
const VERT_SPEC = {
  stairs: { area: 16, p: 0.5, cap: 50 },        // 계단: 양방향 폭, 약 50인/스텝(군) 처리
  escalator: { area: 12, p: 0.55, cap: 40 },    // ES: 단방향 다수, 약 40인/스텝
  elevator: { area: 6, p: 0.4 },                // EV: 주기 배치 수송
};
function vert(idDn, idUp, group, kind, posDn, posUp, over = {}) {
  const [dDn, dUp] = VERT_LABEL[kind] || ["하행", "상행"];
  const s = VERT_SPEC[kind] || VERT_SPEC.stairs;
  const extra = kind === "elevator"
    ? { elevator_cycle: 10, elevator_capacity: 6 }
    : { throughput_cap: s.cap };
  const mk = (id, dir, pos) => nd({ id, name: `${group}·${dir}`, kind, direction: dir, group,
    area: s.area, p_stay_base: s.p, ...extra, x: pos[0], y: pos[1], ...over });
  return [mk(idDn, dDn, posDn), mk(idUp, dUp, posUp)];
}

// ── 동·서 대합실 분리형(2출입군·2게이트가 공용 2호선 상/하행으로 수렴, 양방향) ──
function concourseSplitConfig() {
  return base({
    name: "동·서 대합실 분리형 (2게이트·공용 승강장)",
    total_steps: 2400,
    demand: { day_variability_sigma: 0.1, common_factor_phi: 0.78, common_factor_sigma: 0.12 },
    nodes: [
      // 서측 2 출입구 → 서대합실 → 서게이트
      ...entrancePair("EW1i", "EW1o", "서출입구1", [40, 60], [40, 180], 1.0),
      ...entrancePair("EW2i", "EW2o", "서출입구2", [40, 300], [40, 420], 0.7),
      nd({ id: "CWi", name: "서대합실·진입", kind: "corridor", direction: "진입", group: "서대합실", area: 150, p_stay_base: 0.4, x: 230, y: 120 }),
      nd({ id: "CWo", name: "서대합실·진출", kind: "corridor", direction: "진출", group: "서대합실", area: 150, p_stay_base: 0.4, x: 230, y: 360 }),
      nd({ id: "GWi", name: "서게이트·진입", kind: "gate", direction: "진입", group: "서게이트", area: 26, p_stay_base: 0.2, throughput_cap: 18, x: 410, y: 120 }),
      nd({ id: "GWo", name: "서게이트·진출", kind: "gate", direction: "진출", group: "서게이트", area: 26, p_stay_base: 0.2, throughput_cap: 18, x: 410, y: 360 }),
      // 동측 2 출입구 → 동대합실 → 동게이트
      ...entrancePair("EE1i", "EE1o", "동출입구1", [40, 560], [40, 680], 1.0),
      ...entrancePair("EE2i", "EE2o", "동출입구2", [40, 800], [40, 920], 0.6),
      nd({ id: "CEi", name: "동대합실·진입", kind: "corridor", direction: "진입", group: "동대합실", area: 150, p_stay_base: 0.4, x: 230, y: 620 }),
      nd({ id: "CEo", name: "동대합실·진출", kind: "corridor", direction: "진출", group: "동대합실", area: 150, p_stay_base: 0.4, x: 230, y: 860 }),
      nd({ id: "GEi", name: "동게이트·진입", kind: "gate", direction: "진입", group: "동게이트", area: 26, p_stay_base: 0.2, throughput_cap: 18, x: 410, y: 620 }),
      nd({ id: "GEo", name: "동게이트·진출", kind: "gate", direction: "진출", group: "동게이트", area: 26, p_stay_base: 0.2, throughput_cap: 18, x: 410, y: 860 }),
      // 공용 수직동선(계단·ES)
      ...vert("V_st_d", "V_st_u", "계단", "stairs", [610, 320], [610, 500]),
      ...vert("V_es_d", "V_es_u", "에스컬레이터", "escalator", [610, 620], [610, 760]),
      // 2호선 상·하행(섬식, 양측 진입) — onboard_load 위에서 지정
      ...platformPair("L_up_al", "L_up_bo", "2호선상행", [840, 200], [840, 80], 150, { first_arrival: 90, headway: 160, train_capacity: 1400, onboard_load: 180, board_cap: 42 }, 150),
      ...platformPair("L_dn_al", "L_dn_bo", "2호선하행", [840, 560], [840, 700], 140, { first_arrival: 150, headway: 160, train_capacity: 1400, onboard_load: 150, board_cap: 42 }, 150),
    ],
    links: [
      // 서측 진입/진출
      { src: "EW1i", dst: "CWi", distance: 18, weight: 1.0, tau: null },
      { src: "EW2i", dst: "CWi", distance: 22, weight: 1.0, tau: null },
      { src: "CWo", dst: "EW1o", distance: 18, weight: 0.6, tau: null },
      { src: "CWo", dst: "EW2o", distance: 22, weight: 0.4, tau: null },
      { src: "CWi", dst: "GWi", distance: 24, weight: 1.0, tau: null },
      { src: "GWo", dst: "CWo", distance: 24, weight: 1.0, tau: null },
      // 동측 진입/진출
      { src: "EE1i", dst: "CEi", distance: 18, weight: 1.0, tau: null },
      { src: "EE2i", dst: "CEi", distance: 22, weight: 1.0, tau: null },
      { src: "CEo", dst: "EE1o", distance: 18, weight: 0.6, tau: null },
      { src: "CEo", dst: "EE2o", distance: 22, weight: 0.4, tau: null },
      { src: "CEi", dst: "GEi", distance: 24, weight: 1.0, tau: null },
      { src: "GEo", dst: "CEo", distance: 24, weight: 1.0, tau: null },
      // 게이트 → 하행 수직동선(서/동 공용)
      { src: "GWi", dst: "V_st_d", distance: 22, weight: 0.5, tau: null },
      { src: "GWi", dst: "V_es_d", distance: 22, weight: 0.5, tau: null },
      { src: "GEi", dst: "V_st_d", distance: 22, weight: 0.5, tau: null },
      { src: "GEi", dst: "V_es_d", distance: 22, weight: 0.5, tau: null },
      // 하행 → 상·하행 승차(분기)
      { src: "V_st_d", dst: "L_up_bo", distance: 30, weight: 0.5, tau: null },
      { src: "V_st_d", dst: "L_dn_bo", distance: 30, weight: 0.5, tau: null },
      { src: "V_es_d", dst: "L_up_bo", distance: 30, weight: 0.5, tau: null },
      { src: "V_es_d", dst: "L_dn_bo", distance: 30, weight: 0.5, tau: null },
      // 하차 → 상행 수직동선
      { src: "L_up_al", dst: "V_st_u", distance: 30, weight: 0.5, tau: null },
      { src: "L_up_al", dst: "V_es_u", distance: 30, weight: 0.5, tau: null },
      { src: "L_dn_al", dst: "V_st_u", distance: 30, weight: 0.5, tau: null },
      { src: "L_dn_al", dst: "V_es_u", distance: 30, weight: 0.5, tau: null },
      // 상행 → 서/동 게이트 진출(균등 분기)
      { src: "V_st_u", dst: "GWo", distance: 22, weight: 0.5, tau: null },
      { src: "V_st_u", dst: "GEo", distance: 22, weight: 0.5, tau: null },
      { src: "V_es_u", dst: "GWo", distance: 22, weight: 0.5, tau: null },
      { src: "V_es_u", dst: "GEo", distance: 22, weight: 0.5, tau: null },
    ],
  });
}

// ── 초대형 복합환승역(10출입구·3노선 6승강장·지하3층, 양방향) ──
// B1: 출입구10 → 서/동 2 권역의 분리된 대합실·게이트군 → 공용 B1-B2 수직동선(계단/ES/EV).
// B2: 환승홀 + 1·2호선 상/하행. B2→B3 수직동선. B3: 3호선 상/하행. 1·2호선 간 승강장 환승 포함.
// (54노드 27그룹)
function megaStationConfig() {
  const nodes = [];
  const links = [];
  const add = (...ns) => nodes.push(...ns);
  const link = (src, dst, distance, weight = 1.0) => links.push({ src, dst, distance, weight, tau: null });

  // ── B1: 10 출입구 → 서/동 2 권역(각 5)의 분리된 대합실·게이트군(다중 게이트 라인) ──
  // 실제 대형 환승역처럼 단일 깔때기가 아니라 권역별로 대합실·게이트를 분산한다.
  const rates = [0.40, 0.29, 0.46, 0.21, 0.14, 0.29, 0.35, 0.18, 0.32, 0.13];
  const zones = [
    { id: "W", label: "서", ents: [0, 1, 2, 3, 4], y0: 24, hubY: 150 },
    { id: "E", label: "동", ents: [5, 6, 7, 8, 9], y0: 430, hubY: 560 },
  ];
  zones.forEach((z) => {
    const ci = `C${z.id}i`, co = `C${z.id}o`, gi = `G${z.id}i`, go = `G${z.id}o`;
    z.ents.forEach((i, r) => {
      const g = `출입구${i + 1}`, y = z.y0 + r * 72;
      add(...entrancePair(`E${i + 1}i`, `E${i + 1}o`, g, [40, y], [185, y], rates[i]));
      link(`E${i + 1}i`, ci, 26, 1.0);
      link(co, `E${i + 1}o`, 26, 0.2); // 권역 5개 출구 균등 분기(합=1.0)
    });
    add(nd({ id: ci, name: `${z.label}대합실·진입`, kind: "corridor", direction: "진입", group: `${z.label}대합실`, area: 320, p_stay_base: 0.4, x: 360, y: z.hubY }));
    add(nd({ id: co, name: `${z.label}대합실·진출`, kind: "corridor", direction: "진출", group: `${z.label}대합실`, area: 320, p_stay_base: 0.4, x: 360, y: z.hubY + 130 }));
    // 게이트 throughput=권역 게이트군 전체(자동개찰 약 30대) 기준
    add(nd({ id: gi, name: `${z.label}게이트·진입`, kind: "gate", direction: "진입", group: `${z.label}게이트`, area: 40, p_stay_base: 0.2, throughput_cap: 22, x: 540, y: z.hubY }));
    add(nd({ id: go, name: `${z.label}게이트·진출`, kind: "gate", direction: "진출", group: `${z.label}게이트`, area: 40, p_stay_base: 0.2, throughput_cap: 22, x: 540, y: z.hubY + 130 }));
    link(ci, gi, 30, 1.0);
    link(go, co, 30, 1.0);
    // 권역 게이트 → 공용 B1-B2 하행 수직동선(EV 비중은 저용량이라 작게)
    link(gi, "V12_st_d", 24, 0.48); link(gi, "V12_es_d", 24, 0.50); link(gi, "V12_ev_d", 24, 0.02);
  });

  // ── B1→B2 수직동선(계단/ES/EV, 서·동 공용) ──
  add(...vert("V12_st_d", "V12_st_u", "B1-B2계단", "stairs", [740, 150], [740, 330]));
  add(...vert("V12_es_d", "V12_es_u", "B1-B2ES", "escalator", [740, 460], [740, 590]));
  add(...vert("V12_ev_d", "V12_ev_u", "B1-B2EV", "elevator", [740, 700], [740, 800]));
  // 상행 수직동선 → 서/동 게이트 진출(균등 분기)
  ["V12_st_u", "V12_es_u", "V12_ev_u"].forEach((v) => { link(v, "GWo", 24, 0.5); link(v, "GEo", 24, 0.5); });

  // ── B2 환승홀 ──
  add(nd({ id: "H2i", name: "B2환승홀·진입", kind: "corridor", direction: "진입", group: "B2환승홀", area: 360, p_stay_base: 0.4, x: 930, y: 320 }));
  add(nd({ id: "H2o", name: "B2환승홀·진출", kind: "corridor", direction: "진출", group: "B2환승홀", area: 360, p_stay_base: 0.4, x: 930, y: 580 }));
  link("V12_st_d", "H2i", 26, 1.0); link("V12_es_d", "H2i", 26, 1.0); link("V12_ev_d", "H2i", 26, 1.0);
  link("H2o", "V12_st_u", 26, 0.48); link("H2o", "V12_es_u", 26, 0.50); link("H2o", "V12_ev_u", 26, 0.02);

  // ── B2 승강장: 1·2호선 상/하행 (피크 방향=상행 재차↑로 비대칭, 정원 약 48~58%) ──
  const b2 = [
    ["L1U", "1호선상행", 300, [1130, 40], [1330, 40], { first_arrival: 70, headway: 150, train_capacity: 1500, onboard_load: 840, board_cap: 46 }],
    ["L1D", "1호선하행", 260, [1130, 160], [1330, 160], { first_arrival: 110, headway: 150, train_capacity: 1500, onboard_load: 680, board_cap: 46 }],
    ["L2U", "2호선상행", 320, [1130, 280], [1330, 280], { first_arrival: 90, headway: 180, train_capacity: 1500, onboard_load: 880, board_cap: 48 }],
    ["L2D", "2호선하행", 290, [1130, 400], [1330, 400], { first_arrival: 140, headway: 180, train_capacity: 1500, onboard_load: 740, board_cap: 48 }],
  ];
  b2.forEach(([id, g, al, posBo, posAl, over]) => {
    add(...platformPair(`${id}_al`, `${id}_bo`, g, posAl, posBo, al, over, 250));
    link("H2i", `${id}_bo`, 36, 0.18);   // 신규 진입 승객 → 승차(합 0.72)
  });
  // B2 노선 간 승강장 환승(하차 → 다른 노선 승차) + 진출
  link("L1U_al", "H2o", 40, 0.6); link("L1U_al", "L2U_bo", 32, 0.2); link("L1U_al", "L2D_bo", 32, 0.2);
  link("L1D_al", "H2o", 40, 0.6); link("L1D_al", "L2U_bo", 32, 0.2); link("L1D_al", "L2D_bo", 32, 0.2);
  link("L2U_al", "H2o", 40, 0.6); link("L2U_al", "L1U_bo", 32, 0.2); link("L2U_al", "L1D_bo", 32, 0.2);
  link("L2D_al", "H2o", 40, 0.6); link("L2D_al", "L1U_bo", 32, 0.2); link("L2D_al", "L1D_bo", 32, 0.2);

  // ── B2→B3 수직동선(계단/ES/EV) ──
  add(...vert("V23_st_d", "V23_st_u", "B2-B3계단", "stairs", [1130, 540], [1330, 540]));
  add(...vert("V23_es_d", "V23_es_u", "B2-B3ES", "escalator", [1130, 650], [1330, 650]));
  add(...vert("V23_ev_d", "V23_ev_u", "B2-B3EV", "elevator", [1130, 760], [1330, 760]));
  link("H2i", "V23_st_d", 30, 0.13); link("H2i", "V23_es_d", 30, 0.13); link("H2i", "V23_ev_d", 30, 0.02);

  // ── B3 승강장: 3호선 상/하행 ──
  const b3 = [
    ["L3U", "3호선상행", 280, [1530, 540], [1530, 650], { first_arrival: 100, headway: 190, train_capacity: 1500, onboard_load: 660, board_cap: 44 }],
    ["L3D", "3호선하행", 250, [1530, 760], [1530, 870], { first_arrival: 160, headway: 190, train_capacity: 1500, onboard_load: 620, board_cap: 44 }],
  ];
  b3.forEach(([id, g, al, posBo, posAl, over]) => {
    add(...platformPair(`${id}_al`, `${id}_bo`, g, posAl, posBo, al, over, 250));
  });
  // 하행 수직동선 → 3호선 승차 / 3호선 하차 → 상행 수직동선
  ["V23_st_d", "V23_es_d", "V23_ev_d"].forEach((v) => { link(v, "L3U_bo", 28, 0.5); link(v, "L3D_bo", 28, 0.5); });
  link("L3U_al", "V23_st_u", 28, 0.4); link("L3U_al", "V23_es_u", 28, 0.5); link("L3U_al", "V23_ev_u", 28, 0.1);
  link("L3D_al", "V23_st_u", 28, 0.4); link("L3D_al", "V23_es_u", 28, 0.5); link("L3D_al", "V23_ev_u", 28, 0.1);
  link("V23_st_u", "H2o", 30, 1.0); link("V23_es_u", "H2o", 30, 1.0); link("V23_ev_u", "H2o", 30, 1.0);

  return base({
    name: "초대형 복합환승역 (10출입구·3노선·지하3층)",
    // 07:00 시작 → 08시 피크로 상승하는 아침 러시 램프업(시작 직후 포화 충격 회피)
    total_steps: 3600, warmup_steps: 120, start_time_sec: 25200,
    demand: { day_variability_sigma: 0.08, common_factor_phi: 0.8, common_factor_sigma: 0.1 },
    nodes, links,
  });
}

// ── 단순(출입구–통로–승강장, 모두 양방향 쌍) ──
function simpleConfig() {
  return base({
    name: "단순 통로형 (양방향)",
    nodes: [
      ...entrancePair("E_in", "E_out", "출입구", [60, 100], [60, 300], 1.5),
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
      ...entrancePair("E_in", "E_out", "출입구", [60, 110], [60, 320], 0.9),
      // 같은 승강기 1대를 방향별로 나눠 모델링 → 방향당 면적·용량 절반(EV 는 본질적으로 저용량 병목)
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
      nd({ id: "G_in", name: "진입 게이트", kind: "gate", direction: "진입", group: "게이트", area: 20, p_stay_base: 0.2, throughput_cap: 16, x: 240, y: 200 }),
      nd({ id: "G_out", name: "진출 게이트", kind: "gate", direction: "진출", group: "게이트", area: 20, p_stay_base: 0.2, throughput_cap: 16, x: 240, y: 380 }),
      nd({ id: "C_in", name: "대합실·진입", kind: "corridor", direction: "진입", group: "대합실", area: 80, x: 440, y: 200 }),
      nd({ id: "C_out", name: "대합실·진출", kind: "corridor", direction: "진출", group: "대합실", area: 80, x: 440, y: 380 }),
      ...platformPair("P1_al", "P1_bo", "승강장1(상행)", [700, 80], [700, 200], 120, { first_arrival: 90, headway: 210 }),
      ...platformPair("P2_al", "P2_bo", "승강장2(하행)", [700, 360], [700, 480], 120, { first_arrival: 150, headway: 210 }),
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
      nd({ id: "G_in", name: "진입 게이트", kind: "gate", direction: "진입", group: "게이트", area: 24, p_stay_base: 0.2, throughput_cap: 22, x: 220, y: 240 }),
      nd({ id: "G_out", name: "진출 게이트", kind: "gate", direction: "진출", group: "게이트", area: 24, p_stay_base: 0.2, throughput_cap: 22, x: 220, y: 420 }),
      // 대합실(신규 진입객이 노선을 고르는 곳) — 양방향
      nd({ id: "C_in", name: "대합실·진입", kind: "corridor", direction: "진입", group: "대합실", area: 90, p_stay_base: 0.4, x: 420, y: 240 }),
      nd({ id: "C_out", name: "대합실·진출", kind: "corridor", direction: "진출", group: "대합실", area: 90, p_stay_base: 0.4, x: 420, y: 420 }),
      // 1호선 승강장
      ...platformPair("L1_al", "L1_bo", "1호선", [640, 80], [640, 220], 130, { first_arrival: 90, headway: 175, onboard_load: 300 }),
      // 환승통로(하차 승객의 노선 간 이동 전용, 1↔2 양방향)
      nd({ id: "TR_a", name: "환승통로·1→2", kind: "corridor", direction: "1→2", group: "환승통로", area: 45, p_stay_base: 0.45, x: 860, y: 160 }),
      nd({ id: "TR_b", name: "환승통로·2→1", kind: "corridor", direction: "2→1", group: "환승통로", area: 45, p_stay_base: 0.45, x: 860, y: 360 }),
      // 2호선 승강장
      ...platformPair("L2_al", "L2_bo", "2호선", [1080, 360], [1080, 500], 140, { first_arrival: 140, headway: 200, onboard_load: 320 }),
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
      ...entrancePair("E_in", "E_out", "출입구", [40, 200], [40, 400], 1.9),
      nd({ id: "C_in", name: "대합실·진입", kind: "corridor", direction: "진입", group: "대합실", area: 120, x: 220, y: 200 }),
      nd({ id: "C_out", name: "대합실·진출", kind: "corridor", direction: "진출", group: "대합실", area: 120, x: 220, y: 400 }),
      nd({ id: "G_in", name: "진입 게이트", kind: "gate", direction: "진입", group: "게이트", area: 22, p_stay_base: 0.2, throughput_cap: 24, x: 400, y: 200 }),
      nd({ id: "G_out", name: "진출 게이트", kind: "gate", direction: "진출", group: "게이트", area: 22, p_stay_base: 0.2, throughput_cap: 24, x: 400, y: 400 }),
      // 하행 3종(계단/ES/EV) — throughput_cap 은 '설비군 전체'(여러 대/넓은 폭) 기준 처리율. ES가 하행 선호로 병목.
      nd({ id: "ST_dn", name: "계단·하행", kind: "stairs", direction: "하행", group: "계단", area: 14, p_stay_base: 0.5, throughput_cap: 60, x: 600, y: 120 }),
      nd({ id: "ES_dn", name: "에스컬레이터·하행", kind: "escalator", direction: "하행", group: "에스컬레이터", area: 12, p_stay_base: 0.55, throughput_cap: 45, x: 600, y: 220 }),
      nd({ id: "EV_dn", name: "엘리베이터·하강", kind: "elevator", direction: "하강", group: "엘리베이터", area: 6, elevator_cycle: 10, elevator_capacity: 6, x: 600, y: 320 }),
      // 상행 3종
      nd({ id: "ST_up", name: "계단·상행", kind: "stairs", direction: "상행", group: "계단", area: 14, p_stay_base: 0.55, throughput_cap: 60, x: 600, y: 420 }),
      nd({ id: "ES_up", name: "에스컬레이터·상행", kind: "escalator", direction: "상행", group: "에스컬레이터", area: 12, p_stay_base: 0.55, throughput_cap: 45, x: 600, y: 520 }),
      nd({ id: "EV_up", name: "엘리베이터·상승", kind: "elevator", direction: "상승", group: "엘리베이터", area: 6, elevator_cycle: 10, elevator_capacity: 6, x: 600, y: 620 }),
      ...platformPair("P_al", "P_bo", "승강장", [840, 460], [840, 220], 150, { first_arrival: 110, headway: 200, onboard_load: 300 }),
    ],
    links: [
      { src: "E_in", dst: "C_in", distance: 15, weight: 1.0, tau: null },
      { src: "C_in", dst: "G_in", distance: 25, weight: 1.0, tau: null },
      // 진입: 게이트 → 하행 3종(분기) → 승차. EV 는 저용량이라 분담 비중 작게.
      { src: "G_in", dst: "ST_dn", distance: 20, weight: 0.32, tau: null },
      { src: "G_in", dst: "ES_dn", distance: 20, weight: 0.6, tau: null },
      { src: "G_in", dst: "EV_dn", distance: 20, weight: 0.08, tau: null },
      { src: "ST_dn", dst: "P_bo", distance: 25, weight: 1.0, tau: null },
      { src: "ES_dn", dst: "P_bo", distance: 25, weight: 1.0, tau: null },
      { src: "EV_dn", dst: "P_bo", distance: 25, weight: 1.0, tau: null },
      // 진출: 하차 → 상행 3종(분기) → 게이트 → 대합실 → 출구. EV 는 저용량이라 분담 비중 작게.
      { src: "P_al", dst: "ST_up", distance: 25, weight: 0.37, tau: null },
      { src: "P_al", dst: "ES_up", distance: 25, weight: 0.55, tau: null },
      { src: "P_al", dst: "EV_up", distance: 25, weight: 0.08, tau: null },
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
  { id: "concourse", name: "동·서 대합실 분리형", description: "동·서 출입구·대합실·게이트가 공용 2호선 상/하행으로 수렴. 2게이트 병목.", make: concourseSplitConfig },
  { id: "mega", name: "초대형 복합환승역(10출입구·3노선·지하3층)", description: "출입구 10·서/동 분산 대합실·게이트군·1~3호선 상/하행 6승강장·B1~B3 수직동선·노선 간 승강장 환승까지. 54노드 27그룹의 최대 복잡 예제.", make: megaStationConfig },
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
