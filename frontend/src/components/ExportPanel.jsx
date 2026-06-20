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

  // 노드 단위 + 물리 그룹 단위 GNN 파일을 한 번에(ZIP)
  const bundle = async () => {
    if (!ready) return;
    setBusy("bundle");
    setMsg(null);
    try {
      await ensureFullRun();
      const { bytes } = await engine.exportBundle();
      const safe = (config.name || "station").replace(/[^\w가-힣-]+/g, "_") || "station";
      downloadBlob(`${safe}_GNN_bundle.zip`, new Blob([bytes]), "application/zip");
      setMsg({ ok: true, text: "전체 번들(ZIP) 저장됨 — node/·group/ 두 단위 모두 포함" });
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
        <span>분석·출력 단위 <small style={{ color: "#94a3b8" }}>(아래 대시보드 차트와 공통)</small></span>
        <div className="seg seg-sm" role="group" aria-label="분석·출력 단위">
          <button className={level === "group" ? "on" : ""} aria-pressed={level === "group"} onClick={() => setExport({ output_level: "group" })}>물리 그룹별</button>
          <button className={level === "node" ? "on" : ""} aria-pressed={level === "node"} onClick={() => setExport({ output_level: "node" })}>노드별</button>
        </div>
      </div>
      <button className="primary bundle-btn" disabled={!ready || !!busy} onClick={bundle}>
        {busy === "bundle" ? "생성 중…" : "⬇ 전체 번들(ZIP) — 노드+그룹 GNN 한 번에"}
      </button>
      <div className="export-or">또는 단일 파일(<b>{level === "node" ? "노드별" : "물리 그룹별"}</b> 단위)</div>
      <div className="export-grid">
        <button disabled={!ready || !!busy} onClick={() => csv("timeseries", "timeseries.csv")}>
          {busy === "timeseries" ? "생성 중…" : "혼잡도 시계열 (CSV)"}
        </button>
        <button disabled={!ready || !!busy} onClick={() => csv("departures", "departures.csv")} title="시스템 밖으로 나간 인원(출입구 퇴장·승강장 탑승)의 누적/증분">
          {busy === "departures" ? "생성 중…" : "퇴장·탑승량 (CSV)"}
        </button>
        <button disabled={!ready || !!busy} onClick={() => csv("nodes", "nodes.csv")}>노드 (CSV)</button>
        <button disabled={!ready || !!busy} onClick={() => csv("edges", "edges.csv")}>엣지 (CSV)</button>
        <button disabled={!ready || !!busy} onClick={npz}>
          {busy === "npz" ? "생성 중…" : "X.npz (텐서+그래프)"}
        </button>
      </div>
      {msg && <div className={"export-msg " + (msg.ok ? "ok" : "err")} role="status">{msg.text}</div>}
      <div className="hint">
        <b>전체 번들(ZIP)</b>은 <code>node/</code>(노드별)·<code>group/</code>(물리 그룹별) 두 단위의
        연결성·거리·시간·피처(GNN 구성) 파일과 <code>X.npz</code>·<code>config.json</code>을 모두 담습니다.
        단일 파일은 위 <b>분석·출력 단위</b> 설정({level === "node" ? "노드별" : "물리 그룹별"})을 따릅니다.
        X.npz: X[T,N,F] 특징텐서 + adjacency + edge_index → STGCN 직결.
      </div>
    </div>
  );
}
