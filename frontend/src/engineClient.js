// 메인 스레드 ↔ Pyodide 워커 래퍼. 명령은 Promise, 스냅샷은 콜백으로 전달.

export class EngineClient {
  constructor({ onSnapshot, onProgress, onReady, onError } = {}) {
    this.pending = new Map();
    this.idc = 0;
    this.ready = false;

    this.worker = new Worker(new URL("./worker/pyodideWorker.js", import.meta.url), {
      type: "module",
    });

    this.worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === "ready") {
        this.ready = true;
        onReady && onReady();
      } else if (m.type === "progress") {
        onProgress && onProgress(m.msg);
      } else if (m.type === "snapshot" || m.type === "finished") {
        onSnapshot && onSnapshot(m.snap, m.type === "finished");
      } else if (m.type === "fatal" || m.type === "error") {
        onError && onError(m.error);
      } else if (m.type === "result") {
        const p = this.pending.get(m.id);
        if (p) {
          this.pending.delete(m.id);
          m.error ? p.reject(new Error(m.error)) : p.resolve(m.data);
        }
      }
    };

    const WHEEL = "station_congestion_simulator-0.1.0-py3-none-any.whl";
    const wheelUrl = new URL(import.meta.env.BASE_URL + WHEEL, location.href).href;
    this.worker.postMessage({ type: "init", wheelUrl });
  }

  _call(type, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.idc;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type, id, ...payload });
    });
  }

  validate(config) {
    return this._call("validate", { config: JSON.stringify(config) });
  }
  create(config) {
    return this._call("create", { config: JSON.stringify(config) });
  }
  reset() {
    return this._call("reset");
  }
  runAll() {
    return this._call("runAll");
  }
  exportCsv(kind) {
    return this._call("exportCsv", { kind });
  }
  exportNpz() {
    return this._call("exportNpz");
  }

  run() {
    this.worker.postMessage({ type: "run" });
  }
  pause() {
    this.worker.postMessage({ type: "pause" });
  }
  stop() {
    this.worker.postMessage({ type: "stop" });
  }
  setSpeed(speed) {
    this.worker.postMessage({ type: "setSpeed", speed });
  }
}
