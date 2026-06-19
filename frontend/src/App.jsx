import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { EngineClient } from "./engineClient";
import GraphEditor from "./components/GraphEditor";
import Inspector from "./components/Inspector";
import Controls from "./components/Controls";
import Dashboard from "./components/Dashboard";
import ExportPanel from "./components/ExportPanel";
import HelpModal from "./components/HelpModal";

export default function App() {
  const inited = useRef(false);
  const engineStatus = useStore((s) => s.engineStatus);
  const engineMsg = useStore((s) => s.engineMsg);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    if (inited.current) return;
    inited.current = true;
    const st = useStore.getState();
    const client = new EngineClient({
      onReady: () => st.setEngine("ready", "엔진 준비 완료"),
      onProgress: (msg) => st.setEngine("progress", msg),
      onError: (err) => st.setEngine("error", "오류: " + err),
      onSnapshot: (snap, finished) => {
        useStore.getState().pushSnapshot(snap);
        if (finished) useStore.getState().setRunning(false);
      },
    });
    st.setEngineClient(client);
  }, []);

  const badge = engineStatus === "ready" ? "ready" : engineStatus === "error" ? "error" : "loading";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🚇 철도역사 혼잡도 시뮬레이터</div>
        <div className={`status ${badge}`}>
          <span className="dot" /> {engineMsg}
        </div>
        <div className="topbar-actions">
          <button onClick={() => setHelp(true)}>📖 사용법 · 출력 설명</button>
        </div>
        <div className="sub">브라우저 Python(Pyodide) · 서버 없음</div>
      </header>

      <div className="main">
        <div className="left">
          <GraphEditor />
        </div>
        <aside className="right">
          <section className="card">
            <h3>시뮬레이션</h3>
            <Controls />
          </section>
          <section className="card">
            <h3>속성</h3>
            <Inspector />
          </section>
          <section className="card">
            <ExportPanel />
          </section>
        </aside>
      </div>

      <div className="bottom">
        <Dashboard />
      </div>

      {help && <HelpModal onClose={() => setHelp(false)} />}
    </div>
  );
}
