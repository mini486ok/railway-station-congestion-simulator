import { useState } from "react";
import { useStore } from "../store";
import InfoTip from "./InfoTip";

export default function Controls() {
  const config = useStore((s) => s.config);
  const setConfig = useStore((s) => s.setConfig);
  const setDynamics = useStore((s) => s.setDynamics);
  const setExport = useStore((s) => s.setExport);
  const engine = useStore((s) => s.engine);
  const engineStatus = useStore((s) => s.engineStatus);
  const running = useStore((s) => s.running);
  const setRunning = useStore((s) => s.setRunning);
  const setValidation = useStore((s) => s.setValidation);
  const validation = useStore((s) => s.validation);
  const setNodeMax = useStore((s) => s.setNodeMax);
  const resetHistory = useStore((s) => s.resetHistory);

  const [speed, setSpeed] = useState(2);
  const [paused, setPaused] = useState(false);
  const ready = engineStatus === "ready" && engine;

  const doValidate = async () => {
    if (!ready) return;
    setValidation(await engine.validate(config));
  };

  const doRun = async () => {
    if (!ready) return;
    const v = await engine.validate(config);
    setValidation(v);
    if (!v.ok) return;
    const info = await engine.create(config);
    const nm = {};
    info.node_ids.forEach((id, i) => (nm[id] = info.node_max[i]));
    setNodeMax(nm);
    resetHistory();
    engine.setSpeed(speed);
    engine.run();
    setRunning(true);
    setPaused(false);
  };

  const togglePause = () => {
    if (!running) return;
    if (paused) { engine.run(); setPaused(false); }
    else { engine.pause(); setPaused(true); }
  };

  const doStop = () => { engine.stop(); setRunning(false); setPaused(false); };
  const doReset = async () => {
    engine.stop(); setRunning(false); setPaused(false);
    resetHistory();
    if (ready) await engine.reset();
  };

  const onSpeed = (v) => { setSpeed(v); engine && engine.setSpeed(v); };

  return (
    <div className="controls">
      <div className="run-primary">
        <button className="btn-run" onClick={doRun} disabled={!ready}>생성·실행</button>
        <div className="run-secondary">
          <button onClick={togglePause} disabled={!running} aria-pressed={paused}>{paused ? "재개" : "일시정지"}</button>
          <button onClick={doStop} disabled={!running}>정지</button>
          <button onClick={doReset} disabled={!ready}>리셋</button>
          <button onClick={doValidate} disabled={!ready}>검증</button>
        </div>
      </div>
      {!ready && (
        <div className="engine-loading" role="status">엔진(Pyodide) 준비 중… 준비되면 실행할 수 있습니다.</div>
      )}
      {running && <div className="run-badge" role="status">실행 중 — 그래프/설정 편집은 다음 실행에 반영됩니다.</div>}

      <div className="speed-row">
        <span>속도 {speed}×</span>
        <input type="range" min="0.5" max="20" step="0.5" value={speed} onChange={(e) => onSpeed(+e.target.value)} aria-label="시뮬레이션 속도" />
      </div>

      <div className="grid2">
        <label>총 스텝<InfoTip k="total_steps" /><input type="number" value={config.total_steps} onChange={(e) => setConfig({ total_steps: +e.target.value })} /></label>
        <label>Δ(초/스텝)<InfoTip k="dt_seconds" /><input type="number" step="0.5" value={config.dt_seconds} onChange={(e) => setConfig({ dt_seconds: +e.target.value })} /></label>
      </div>

      <div className="toggles">
        <label><input type="checkbox" checked={config.dynamics.capacity_enabled}
          onChange={(e) => setDynamics({ capacity_enabled: e.target.checked, spillback_enabled: e.target.checked })} /> 용량/스필백(CTM)<InfoTip k="capacity_enabled" /></label>
        {config.dynamics.capacity_enabled && (
          <label>ρ_cap<InfoTip k="rho_cap" /><input type="number" step="0.5" style={{ width: 56 }} value={config.dynamics.rho_cap}
            onChange={(e) => setDynamics({ rho_cap: +e.target.value })} /></label>
        )}
        <label><input type="checkbox" checked={config.integer_mode}
          onChange={(e) => setConfig({ integer_mode: e.target.checked })} /> 정수 인원<InfoTip k="integer_mode" /></label>
        <label><input type="checkbox" checked={config.export.noise_enabled}
          onChange={(e) => setExport({ noise_enabled: e.target.checked })} /> 관측 노이즈<InfoTip k="noise_enabled" /></label>
      </div>

      <details className="advanced">
        <summary>고급 설정</summary>
        <div className="grid2">
          <label>시작시각(초)<InfoTip k="start_time_sec" /><input type="number" value={config.start_time_sec} onChange={(e) => setConfig({ start_time_sec: +e.target.value })} /></label>
          <label>시드<InfoTip k="seed" /><input type="number" value={config.seed} onChange={(e) => setConfig({ seed: +e.target.value })} /></label>
          <label>워밍업 스텝<InfoTip k="warmup_steps" /><input type="number" value={config.warmup_steps} onChange={(e) => setConfig({ warmup_steps: +e.target.value })} /></label>
          <label>집계 간격<InfoTip k="aggregate_steps" /><input type="number" value={config.export.aggregate_steps} onChange={(e) => setExport({ aggregate_steps: +e.target.value })} /></label>
        </div>
      </details>

      {validation && (
        <div className="validation">
          <div className={validation.ok ? "v-ok" : "v-err"}>
            {validation.ok ? "✓ 설정 유효" : "✗ 설정 오류"} (노드 {validation.n_real ?? "?"}, 링크 {validation.n_links ?? "?"})
          </div>
          {(validation.errors || []).map((e, i) => <div key={i} className="v-err-line">• {e}</div>)}
          {(validation.warnings || []).map((w, i) => <div key={i} className="v-warn-line">⚠ {w}</div>)}
        </div>
      )}
    </div>
  );
}
