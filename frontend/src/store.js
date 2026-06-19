import { create } from "zustand";
import { defaultConfig } from "./defaults";

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
      id, name: id, kind, group: "", area: 30, p_stay_base: 0.4, dynamic_pstay: true,
      exit_weight: kind === "entrance" ? 0.5 : 0, n0: 0,
      throughput_cap: 0,
      elevator_cycle: kind === "elevator" ? 5 : 0,
      elevator_capacity: kind === "elevator" ? 10 : 0,
      // 격자 배치로 겹침 방지
      x: 140 + (count % 4) * 175, y: 110 + Math.floor(count / 4) * 125,
      source: (kind === "entrance" ? { type: "poisson", rate: 1.0, sigma: 0, profile: null } : null),
      trains: [],
    };
    set((s) => ({ ...pushPast(s), config: { ...s.config, nodes: [...s.config.nodes, node] }, selection: { type: "node", id } }));
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
