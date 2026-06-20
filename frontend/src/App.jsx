import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { EngineClient } from "./engineClient";
import GraphEditor from "./components/GraphEditor";
import Inspector from "./components/Inspector";
import Controls from "./components/Controls";
import Dashboard from "./components/Dashboard";
import ExportPanel from "./components/ExportPanel";
import HelpModal from "./components/HelpModal";
import TemplatesModal from "./components/TemplatesModal";

// 편집 가능한 필드에 포커스가 있으면 Ctrl+Z 는 브라우저 기본 텍스트 되돌리기에 양보.
function isEditable(el) {
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

export default function App() {
  const inited = useRef(false);
  const fileRef = useRef(null);
  const engineStatus = useStore((s) => s.engineStatus);
  const engineMsg = useStore((s) => s.engineMsg);
  const replaceConfig = useStore((s) => s.replaceConfig);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const [help, setHelp] = useState(false);
  const [tpl, setTpl] = useState(false);
  // 모달이 열려 있으면 전역 단축키(붙여넣기/되돌리기)가 숨은 그래프를 바꾸지 않도록 가드.
  const modalOpenRef = useRef(false);
  modalOpenRef.current = help || tpl;

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

  // 전역 단축키: Ctrl/⌘+Z 되돌리기, Ctrl/⌘+Shift+Z(또는 Ctrl+Y) 다시 실행,
  //            Ctrl/⌘+C 노드 복사, Ctrl/⌘+V 붙여넣기.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (modalOpenRef.current) return; // 모달(사용법/템플릿)이 열려 있으면 그래프 단축키 비활성
      const k = e.key.toLowerCase();
      if (isEditable(document.activeElement)) return; // 입력 중엔 기본 동작(텍스트 편집) 유지
      const st = useStore.getState();
      if (k === "z" || k === "y") {
        e.preventDefault();
        if (k === "y" || (k === "z" && e.shiftKey)) st.redo();
        else st.undo();
      } else if (k === "c") {
        // 선택된 노드(다중 또는 단일)를 복사. 노드 선택이 없으면 기본 텍스트 복사에 양보.
        const ids = st.selectedIds.length ? st.selectedIds
          : (st.selection?.type === "node" ? [st.selection.id] : []);
        if (!ids.length) return;
        e.preventDefault();
        st.copyNodes(ids);
      } else if (k === "v") {
        // 시뮬 실행 중에는 그래프 변경 금지(스냅샷과 어긋남 방지).
        if (st.running || !st.clipboard) return;
        e.preventDefault();
        st.pasteClipboard();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 현재 설정을 JSON 파일로 저장(다운로드).
  const handleSave = () => {
    const cfg = useStore.getState().config;
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = (cfg.name || "station_config").replace(/[^\w가-힣-]+/g, "_") || "station_config";
    a.href = url;
    a.download = `${safe}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // JSON 설정 파일 불러오기.
  const handleFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // 같은 파일 재선택 허용
    if (!file) return;
    try {
      const cfg = JSON.parse(await file.text());
      if (!cfg || !Array.isArray(cfg.nodes) || !Array.isArray(cfg.links)) {
        alert("올바른 설정 파일이 아닙니다 (nodes/links 항목이 필요합니다).");
        return;
      }
      replaceConfig(cfg);
    } catch (err) {
      alert("불러오기에 실패했습니다: " + (err && err.message ? err.message : err));
    }
  };

  const badge = engineStatus === "ready" ? "ready" : engineStatus === "error" ? "error" : "loading";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🚇 철도역사 혼잡도 시뮬레이터</div>
        <div className={`status ${badge}`}>
          <span className="dot" /> {engineMsg}
        </div>
        <div className="topbar-actions">
          <button onClick={() => undo()} disabled={!canUndo} title="되돌리기 (Ctrl+Z)">↶ 되돌리기</button>
          <button onClick={() => redo()} disabled={!canRedo} title="다시 실행 (Ctrl+Shift+Z)">↷ 다시</button>
          <span className="tb-sep" />
          <button onClick={handleSave} title="현재 설정을 JSON 파일로 저장">💾 저장</button>
          <button onClick={() => fileRef.current && fileRef.current.click()} title="JSON 설정 파일 불러오기">📂 불러오기</button>
          <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={handleFile} />
          <span className="tb-sep" />
          <button onClick={() => setTpl(true)}>📁 템플릿</button>
          <button onClick={() => setHelp(true)}>📖 사용법 · 출력 설명</button>
        </div>
        <div className="sub">브라우저 Python(Pyodide) · 서버 없음 · 자동 저장됨</div>
      </header>

      <div className="main">
        <div className="left">
          <GraphEditor />
        </div>
        <aside className="side-panel">
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
      {tpl && <TemplatesModal onClose={() => setTpl(false)} />}
    </div>
  );
}
