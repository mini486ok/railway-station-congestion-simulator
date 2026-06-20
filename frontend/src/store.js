import { create } from "zustand";
import { defaultConfig, DIRECTION_LABELS, GROUP_BASE } from "./defaults";

// 단일 노드(공간 전체) 기본 면적
const AREA_BY_KIND = { platform: 250, corridor: 100, gate: 18, stairs: 30, escalator: 30, elevator: 12, entrance: 40 };
// 양방향 쌍의 '방향당' 면적 — 같은 물리 공간을 둘이 나눠 쓰는 종류는 절반(합=실제 면적),
// 출입구(별도 출입문)·게이트(별도 개찰 뱅크)는 방향별로 독립 공간이라 각자 면적 유지.
const PAIR_AREA = { entrance: 40, gate: 18, corridor: 50, stairs: 15, escalator: 15, elevator: 6, platform: 130 };
const platSchedule = (alight) => ({
  first_arrival: 100, headway: 210, num_trains: 0, alight_mean: alight, alight_sigma: 15,
  alight_dist: "normal", dwell_steps: 32, train_capacity: 1200, board_cap: 38, onboard_load: 0, delay_std: 0,
});

let _seq = 100;
const nextId = (prefix) => `${prefix}${_seq++}`;

// 불러온 config 에 N### 형식 노드가 있으면 다음 자동 id 가 겹치지 않게 시퀀스를 올린다.
function bumpSeq(cfg) {
  let mx = 99;
  (cfg?.nodes || []).forEach((n) => {
    const m = /^N(\d+)$/.exec(n.id || "");
    if (m) mx = Math.max(mx, +m[1]);
  });
  if (mx + 1 > _seq) _seq = mx + 1;
}

const AUTOSAVE_KEY = "sc_autosave_v1";
const HISTORY_MAX = 60;

// 시작 시 자동저장된 설정을 복원(없으면 기본 예제).
function loadInitialConfig() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) {
      const cfg = JSON.parse(raw);
      if (cfg && Array.isArray(cfg.nodes) && Array.isArray(cfg.links)) {
        bumpSeq(cfg);
        return cfg;
      }
    }
  } catch {
    /* ignore */
  }
  return defaultConfig();
}

// 되돌리기 히스토리에 직전 config 를 적재(이후 redo 는 무효화).
const pushPast = (s) => ({ past: [...s.past, s.config].slice(-HISTORY_MAX), future: [] });

export const useStore = create((set, get) => ({
  // ── 설정(역사 그래프 + 시뮬 파라미터) ──
  config: loadInitialConfig(),

  // ── 되돌리기/다시실행 히스토리(노드·링크 생성/삭제/이동/불러오기 단위) ──
  past: [],
  future: [],

  // ── 선택/검증/런타임 ──
  selection: null, // { type: 'node'|'link', id }
  selectedIds: [], // 그래프에서 다중 선택된 노드 id(복사용) — React Flow onSelectionChange 가 갱신
  clipboard: null, // 복사한 { nodes, links } (붙여넣기 대기)
  validation: null, // validate 결과
  engineStatus: "loading", // loading | progress | ready | error
  engineMsg: "Pyodide 초기화 대기…",
  running: false,
  snapshot: null, // 최신 스냅샷
  history: [], // [{t, ...counts}] 차트용
  nodeMax: {}, // id -> N_max
  engine: null, // EngineClient 인스턴스
  setEngineClient: (engine) => set({ engine }),

  // ── 설정 갱신(파라미터 편집은 히스토리에 쌓지 않음 — 생성/삭제/이동만) ──
  setConfig: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),
  setDynamics: (patch) =>
    set((s) => ({ config: { ...s.config, dynamics: { ...s.config.dynamics, ...patch } } })),
  setExport: (patch) =>
    set((s) => ({ config: { ...s.config, export: { ...s.config.export, ...patch } } })),
  // 설정 전체 교체(불러오기/템플릿). 되돌리기 가능하도록 히스토리에 적재.
  replaceConfig: (cfg) => {
    bumpSeq(cfg);
    set((s) => ({ ...pushPast(s), config: cfg, selection: null, history: [], snapshot: null }));
  },

  // ── 노드 ──
  addNode: (kind = "corridor") => {
    const id = nextId("N");
    const count = get().config.nodes.length;
    const node = {
      id, name: id, kind, direction: "", group: "", area: AREA_BY_KIND[kind] || 30, p_stay_base: 0.4, dynamic_pstay: true,
      exit_weight: kind === "entrance" ? 0.5 : 0, n0: 0,
      throughput_cap: 0,
      elevator_cycle: kind === "elevator" ? 5 : 0,
      elevator_capacity: kind === "elevator" ? 10 : 0,
      // 격자 배치로 겹침 방지
      x: 140 + (count % 4) * 175, y: 110 + Math.floor(count / 4) * 125,
      source: (kind === "entrance" ? { type: "poisson", rate: 1.0, sigma: 0, profile: null } : null),
      trains: [],
      platform_role: "both",
      train_schedule: kind === "platform" ? platSchedule(100) : null,
    };
    set((s) => ({ ...pushPast(s), config: { ...s.config, nodes: [...s.config.nodes, node] }, selection: { type: "node", id } }));
  },

  // 양방향 쌍 추가: 진입/진출(또는 하차/승차 등) 2노드를 같은 물리 그룹으로 한 번에 생성.
  addNodePair: (kind = "corridor") => {
    const nodes = get().config.nodes;
    const [dirA, dirB] = DIRECTION_LABELS[kind] || ["정방향", "역방향"];
    const baseLabel = GROUP_BASE[kind] || "장소";
    // 자동 그룹명은 전역(모든 기존 그룹) 유니크 — 엔진이 group 문자열만으로 병합하므로
    // 다른 종류의 동일 그룹명과 우발 병합을 막는다(의도적 병합은 속성창에서 수동으로).
    const existing = new Set(nodes.map((n) => (n.group || "").trim()).filter(Boolean));
    let group = baseLabel, k = 1;
    while (existing.has(group)) { k += 1; group = `${baseLabel}${k}`; }
    const idA = nextId("N"), idB = nextId("N");
    // 기존 노드(단일·쌍·삭제 후 재추가 무관) 오른쪽 새 열에 진입(위)/진출(아래)로 배치 → 겹침 없음
    const maxX = nodes.length ? Math.max(...nodes.map((n) => n.x || 0)) : -45;
    const x = maxX + 195;
    const yA = 90, yB = 240;
    const area = PAIR_AREA[kind] || 30;
    const evCyc = kind === "elevator" ? 8 : 0;
    const evCap = kind === "elevator" ? 6 : 0;  // 방향당 절반 용량(쌍 합 ≈ 승강기 1대)
    const mk = (id, dir, y, over) => ({
      id, name: `${group}·${dir}`, kind, direction: dir, group, area,   // 표시명은 유니크 그룹 기반
      p_stay_base: 0.4, dynamic_pstay: true, exit_weight: 0, n0: 0, throughput_cap: 0,
      elevator_cycle: evCyc, elevator_capacity: evCap,
      x, y, source: null, trains: [], platform_role: "both", train_schedule: null, ...over,
    });
    let A, B;
    if (kind === "entrance") {
      A = mk(idA, dirA, yA, { p_stay_base: 0.3, source: { type: "poisson", rate: 1.0, sigma: 0, profile: null } });
      B = mk(idB, dirB, yB, { p_stay_base: 0.2, exit_weight: 1.0 });
    } else if (kind === "platform") {
      // dirA=하차(유입), dirB=승차(유출)
      A = mk(idA, dirA, yA, { p_stay_base: 0.45, platform_role: "alight", train_schedule: platSchedule(110) });
      B = mk(idB, dirB, yB, { p_stay_base: 0.55, platform_role: "board", train_schedule: platSchedule(0) });
    } else {
      A = mk(idA, dirA, yA, {});
      B = mk(idB, dirB, yB, {});
    }
    set((s) => ({ ...pushPast(s), config: { ...s.config, nodes: [...s.config.nodes, A, B] }, selection: { type: "node", id: idA } }));
  },
  updateNode: (id, patch) =>
    set((s) => ({
      config: { ...s.config, nodes: s.config.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) },
    })),
  // 드래그 종료 위치 커밋(되돌리기 단위로 기록).
  moveNode: (id, x, y) =>
    set((s) => ({ ...pushPast(s), config: { ...s.config, nodes: s.config.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) } })),
  removeNode: (id) =>
    set((s) => ({
      ...pushPast(s),
      config: {
        ...s.config,
        nodes: s.config.nodes.filter((n) => n.id !== id),
        links: s.config.links.filter((l) => l.src !== id && l.dst !== id),
      },
      selection: null,
    })),

  // ── 링크 ──
  addLink: (src, dst) => {
    if (src === dst) return;
    const exists = get().config.links.some((l) => l.src === src && l.dst === dst);
    if (exists) return;
    const link = { src, dst, distance: 15, weight: 1.0, tau: null };
    set((s) => ({ ...pushPast(s), config: { ...s.config, links: [...s.config.links, link] }, selection: { type: "link", id: `${src}->${dst}` } }));
  },
  updateLink: (src, dst, patch) =>
    set((s) => ({
      config: {
        ...s.config,
        links: s.config.links.map((l) => (l.src === src && l.dst === dst ? { ...l, ...patch } : l)),
      },
    })),
  removeLink: (src, dst) =>
    set((s) => ({
      ...pushPast(s),
      config: { ...s.config, links: s.config.links.filter((l) => !(l.src === src && l.dst === dst)) },
      selection: null,
    })),

  // ── 되돌리기 / 다시실행 ──
  undo: () =>
    set((s) => {
      if (!s.past.length) return {};
      const prev = s.past[s.past.length - 1];
      return {
        config: prev,
        past: s.past.slice(0, -1),
        future: [s.config, ...s.future].slice(0, HISTORY_MAX),
        selection: null,
      };
    }),
  redo: () =>
    set((s) => {
      if (!s.future.length) return {};
      const nxt = s.future[0];
      return {
        config: nxt,
        future: s.future.slice(1),
        past: [...s.past, s.config].slice(-HISTORY_MAX),
        selection: null,
      };
    }),

  setSelection: (selection) => set({ selection }),
  setSelectedIds: (selectedIds) => set({ selectedIds }),

  // ── 복사 / 붙여넣기(Ctrl+C / Ctrl+V) ──
  // 선택한 노드들(과 그 사이 내부 링크)을 클립보드에 깊은 복사로 담는다.
  copyNodes: (ids) => {
    const idset = new Set(ids || []);
    const nodes = get().config.nodes.filter((n) => idset.has(n.id));
    if (!nodes.length) return 0;
    const links = get().config.links.filter((l) => idset.has(l.src) && idset.has(l.dst));
    set({ clipboard: JSON.parse(JSON.stringify({ nodes, links })) });
    return nodes.length;
  },
  // 클립보드 노드/링크를 새 id·새 그룹명(전역 유니크)·위치 오프셋으로 붙여넣는다.
  // 같은 그룹으로 묶였던 노드들은 함께 새 그룹으로 유지되어 양방향 쌍의 물리 그룹이 보존된다.
  pasteClipboard: () => {
    const cb = get().clipboard;
    if (!cb || !cb.nodes.length) return null;
    const cfg = get().config;
    const idMap = {};
    cb.nodes.forEach((n) => { idMap[n.id] = nextId("N"); });
    // 복사된 비어있지 않은 그룹 → 기존 모든 그룹과 겹치지 않는 새 이름(같은 그룹은 한 이름으로)
    const existing = new Set(cfg.nodes.map((n) => (n.group || "").trim()).filter(Boolean));
    const groupMap = {};
    cb.nodes.forEach((n) => {
      const g = (n.group || "").trim();
      if (!g || groupMap[g]) return;
      let name = `${g} 사본`, k = 1;
      while (existing.has(name)) { k += 1; name = `${g} 사본${k}`; }
      existing.add(name);
      groupMap[g] = name;
    });
    const newNodes = cb.nodes.map((n) => {
      const g = (n.group || "").trim();
      return { ...n, id: idMap[n.id], name: `${n.name || n.id} 사본`,
        group: g ? groupMap[g] : "", x: (n.x || 0) + 40, y: (n.y || 0) + 40 };
    });
    const newLinks = cb.links.map((l) => ({ ...l, src: idMap[l.src], dst: idMap[l.dst] }));
    set((s) => ({ ...pushPast(s),
      config: { ...s.config, nodes: [...s.config.nodes, ...newNodes], links: [...s.config.links, ...newLinks] },
      selection: { type: "node", id: newNodes[0].id } }));
    return newNodes.length;
  },

  // ── 런타임 ──
  setValidation: (validation) => set({ validation }),
  setEngine: (engineStatus, engineMsg) => set((s) => ({ engineStatus, engineMsg: engineMsg ?? s.engineMsg })),
  setRunning: (running) => set({ running }),
  setNodeMax: (nodeMax) => set({ nodeMax }),
  resetHistory: () => set({ history: [], snapshot: null }),

  pushSnapshot: (snap) =>
    set((s) => {
      const ids = s.config.nodes.map((n) => n.id);
      const row = { t: snap.t };
      snap.count.forEach((c, i) => {
        if (ids[i] != null) row[ids[i]] = c;
      });
      const history = [...s.history, row];
      // 차트 과밀 방지: 최근 600 포인트 유지
      if (history.length > 600) history.splice(0, history.length - 600);
      return { snapshot: snap, history };
    }),
}));

// 자동 저장: config 가 바뀔 때마다 localStorage 에 보존(새로고침/재방문 시 복원).
// config 참조가 실제로 바뀐 경우에만 직렬화해 시뮬 스냅샷 갱신에는 반응하지 않는다.
let _lastSavedConfig = useStore.getState().config;
try {
  localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(_lastSavedConfig));
} catch {
  /* ignore */
}
useStore.subscribe((s) => {
  if (s.config !== _lastSavedConfig) {
    _lastSavedConfig = s.config;
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(s.config));
    } catch {
      /* ignore */
    }
  }
});
