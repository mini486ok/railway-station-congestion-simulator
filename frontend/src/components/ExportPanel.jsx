import { useState } from "react";
import { useStore } from "../store";
import { downloadBlob } from "../util";

export default function ExportPanel() {
  const engine = useStore((s) => s.engine);
  const config = useStore((s) => s.config);
  const setExport = useStore((s) => s.setExport);
  const engineStatus = useStore((s) => s.engineStatus);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null); // {ok, text}
  const ready = engineStatus === "ready" && engine;
  const level = config.export?.output_level || "group";

  // 전체 시뮬을 끝까지 돌린 뒤 export (export 데이터 완전 보장)
  const ensureFullRun = async () => {
    const info = await engine.create(config);
    if (info && info.ok === false) {
      throw new Error("설정 오류: " + (info.errors || []).join("; "));
    }
    await engine.runAll();
  };

  const csv = async (kind, filename) => {
    if (!ready) return;
    setBusy(kind);
    setMsg(null);
    try {
      await ensureFullRun();
      const { text } = await engine.exportCsv(kind);
      downloadBlob(filename, "﻿" + text, "text/csv;charset=utf-8");
      setMsg({ ok: true, text: `${filename} 저장됨` });
    } catch (e) {
      setMsg({ ok: false, text: `내보내기 실패: ${e?.message || e}` });
    } finally {
      setBusy("");
    }
  };

  const npz = async () => {
    if (!ready) return;
    setBusy("npz");
    setMsg(null);
    try {
      await ensureFullRun();
      const { bytes } = await engine.exportNpz();
      downloadBlob("X.npz", new Blob([bytes]), "application/octet-stream");
      setMsg({ ok: true, text: "X.npz 저장됨" });
    } catch (e) {
      setMsg({ ok: false, text: `내보내기 실패: ${e?.message || e}` });
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="export">
      <div className="sub-title">데이터셋 내보내기 (STGCN 학습용)</div>
      <div className="export-level">
        <span>분석·출력 단위</span>
        <div className="seg seg-sm" role="group" aria-label="분석·출력 단위">
          <button className={level === "group" ? "on" : ""} aria-pressed={level === "group"} onClick={() => setExport({ output_level: "group" })}>물리 그룹별</button>
          <button className={level === "node" ? "on" : ""} aria-pressed={level === "node"} onClick={() => setExport({ output_level: "node" })}>노드별</button>
        </div>
      </div>
      <div className="export-grid">
        <button disabled={!ready || busy} onClick={() => csv("timeseries", "timeseries.csv")}>
          {busy === "timeseries" ? "생성 중…" : "혼잡도 시계열 (CSV)"}
        </button>
        <button disabled={!ready || busy} onClick={() => csv("departures", "departures.csv")}>
          {busy === "departures" ? "생성 중…" : "유출량 (CSV)"}
        </button>
        <button disabled={!ready || busy} onClick={() => csv("nodes", "nodes.csv")}>노드 (CSV)</button>
        <button disabled={!ready || busy} onClick={() => csv("edges", "edges.csv")}>엣지 (CSV)</button>
        <button className="primary" disabled={!ready || busy} onClick={npz}>
          {busy === "npz" ? "생성 중…" : "X.npz (텐서+그래프)"}
        </button>
      </div>
      {msg && <div className={"export-msg " + (msg.ok ? "ok" : "err")} role="status">{msg.text}</div>}
      <div className="hint">
        전체 시뮬을 끝까지 실행한 뒤 저장합니다. <b>{level === "node" ? "노드별" : "물리 그룹별"}</b> 단위로 출력됩니다(대시보드 ‘분석·출력 단위’와 동일 설정).
        X.npz: X[T,N,F] 특징텐서 + adjacency + edge_index → STGCN 직결.
      </div>
    </div>
  );
}
