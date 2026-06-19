import { create } from "zustand";
import { defaultConfig } from "./defaults";

let _seq = 100;
const nextId = (prefix) => `${prefix}${_seq++}`;

export const useStore = create((set, get) => ({
  // ── 설정(역사 그래프 + 시뮬 파라미터) ──
  config: defaultConfig(),

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

  // ── 설정 갱신 ──
  setConfig: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),
  setDynamics: (patch) =>
    set((s) => ({ config: { ...s.config, dynamics: { ...s.config.dynamics, ...patch } } })),
  setExport: (patch) =>
    set((s) => ({ config: { ...s.config, export: { ...s.config.export, ...patch } } })),
  replaceConfig: (cfg) => set({ config: cfg, selection: null, history: [], snapshot: null }),

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
    set((s) => ({ config: { ...s.config, nodes: [...s.config.nodes, node] }, selection: { type: "node", id } }));
  },
  updateNode: (id, patch) =>
    set((s) => ({
      config: { ...s.config, nodes: s.config.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) },
    })),
  moveNode: (id, x, y) =>
    set((s) => ({ config: { ...s.config, nodes: s.config.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) } })),
  removeNode: (id) =>
    set((s) => ({
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
    set((s) => ({ config: { ...s.config, links: [...s.config.links, link] }, selection: { type: "link", id: `${src}->${dst}` } }));
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
      config: { ...s.config, links: s.config.links.filter((l) => !(l.src === src && l.dst === dst)) },
      selection: null,
    })),

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
