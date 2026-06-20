// Pyodide Web Worker — 브라우저에서 Python 시뮬레이션 엔진을 실행한다.
// ESM 동적 import 로 Pyodide(WASM)를 로드 → numpy 로드 → 엔진 wheel(micropip) 설치 →
// engine.bridge 호출. 시뮬 루프(재생/일시정지/배속/정지)는 이 워커에서 페이싱한다.

const PYODIDE_VERSION = "0.28.3";
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyodide = null;
let bridge = null;

// 시뮬 루프 상태
let running = false;
let paused = false;
let speed = 1; // X배속
let timer = null;

function post(msg) {
  self.postMessage(msg);
}

async function init(wheelUrl) {
  try {
    post({ type: "progress", msg: "Pyodide 로딩 중…" });
    const { loadPyodide } = await import(/* @vite-ignore */ PYODIDE_BASE + "pyodide.mjs");
    pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });

    post({ type: "progress", msg: "numpy 로딩 중…" });
    await pyodide.loadPackage(["numpy", "micropip"]);

    post({ type: "progress", msg: "시뮬레이션 엔진 설치 중…" });
    console.log("[worker] installing wheel:", wheelUrl);
    // deps=False: numpy 는 Pyodide 내장본 사용(PyPI 에서 받지 않음)
    await pyodide.runPythonAsync(
      `import micropip\nawait micropip.install(${JSON.stringify(wheelUrl)}, deps=False)\nimport engine.bridge`
    );
    console.log("[worker] engine installed");
    bridge = pyodide.pyimport("engine.bridge");
    post({ type: "ready" });
  } catch (err) {
    const detail = String((err && (err.stack || err.message)) || err);
    console.error("[worker] INIT ERROR:", detail);
    post({ type: "fatal", error: detail });
  }
}

function tick() {
  if (!running) return;
  try {
    if (!paused && bridge) {
      const steps = Math.max(1, Math.round(speed * 5));
      const snap = JSON.parse(bridge.step_many(steps));
      post({ type: "snapshot", snap });
      if (snap.done) {
        running = false;
        post({ type: "finished", snap });
        return;
      }
    }
  } catch (err) {
    running = false;
    post({ type: "error", error: String(err) });
    return;
  }
  timer = setTimeout(tick, 33);
}

self.onmessage = async (e) => {
  const m = e.data || {};
  // init 외 모든 명령은 엔진(bridge) 준비 후에만 처리(준비 전 호출 경합 방지)
  if (m.type !== "init" && !bridge) {
    if (m.id != null) post({ type: "result", id: m.id, error: "엔진이 아직 준비되지 않았습니다." });
    return;
  }
  switch (m.type) {
    case "init":
      await init(m.wheelUrl);
      break;

    case "validate":
      try {
        post({ type: "result", id: m.id, data: JSON.parse(bridge.validate(m.config)) });
      } catch (err) {
        post({ type: "result", id: m.id, error: String(err) });
      }
      break;

    case "create":
      try {
        running = false;
        if (timer) clearTimeout(timer);
        const info = JSON.parse(bridge.create(m.config));
        post({ type: "result", id: m.id, data: info });
      } catch (err) {
        post({ type: "result", id: m.id, error: String(err) });
      }
      break;

    case "run":
      if (!running) {
        running = true;
        paused = false;
        tick();
      } else {
        paused = false;
      }
      break;

    case "pause":
      paused = true;
      break;

    case "resume":
      paused = false;
      break;

    case "stop":
      running = false;
      if (timer) clearTimeout(timer);
      break;

    case "setSpeed":
      speed = Math.max(0.1, Number(m.speed) || 1);
      break;

    case "reset":
      try {
        running = false;
        if (timer) clearTimeout(timer);
        const snap = JSON.parse(bridge.reset());
        post({ type: "result", id: m.id, data: snap });
      } catch (err) {
        post({ type: "result", id: m.id, error: String(err) });
      }
      break;

    case "runAll":
      try {
        running = false;
        if (timer) clearTimeout(timer);
        const snap = JSON.parse(bridge.run_all());
        post({ type: "result", id: m.id, data: snap });
      } catch (err) {
        post({ type: "result", id: m.id, error: String(err) });
      }
      break;

    case "exportCsv":
      try {
        const text = bridge.export_csv(m.kind, m.level || "");
        post({ type: "result", id: m.id, data: { kind: m.kind, text } });
      } catch (err) {
        post({ type: "result", id: m.id, error: String(err) });
      }
      break;

    case "exportNpz":
      try {
        const pyBytes = bridge.export_npz(m.level || "");
        const u8 = pyBytes.toJs();
        pyBytes.destroy();
        // TypedArray 의 실제 뷰 구간만 복사(byteOffset>0 일 때 앞부분 쓰레기 혼입 방지)
        const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
        post({ type: "result", id: m.id, data: { bytes: buf } }, [buf]);
      } catch (err) {
        post({ type: "result", id: m.id, error: String(err) });
      }
      break;

    case "exportBundle":
      try {
        const pyBytes = bridge.export_bundle();
        const u8 = pyBytes.toJs();
        pyBytes.destroy();
        const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
        post({ type: "result", id: m.id, data: { bytes: buf } }, [buf]);
      } catch (err) {
        post({ type: "result", id: m.id, error: String(err) });
      }
      break;

    case "exportBatch":
      try {
        const info = JSON.parse(bridge.batch_prepare(m.num, m.seedStart || 0, m.level || ""));
        const total = info.num;
        for (let i = 0; i < total; i++) {
          bridge.batch_run_one();
          post({ type: "batchProgress", id: m.id, done: i + 1, total });
        }
        const pyBytes = bridge.batch_finish();
        const u8 = pyBytes.toJs();
        pyBytes.destroy();
        const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
        post({ type: "result", id: m.id, data: { bytes: buf } }, [buf]);
      } catch (err) {
        post({ type: "result", id: m.id, error: String(err) });
      }
      break;

    default:
      break;
  }
};
