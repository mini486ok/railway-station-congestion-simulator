import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, { Background, Controls as RFControls, MiniMap, useNodesState, useEdgesState } from "reactflow";
import "reactflow/dist/style.css";
import { useStore } from "../store";
import { KIND_COLOR, NODE_KINDS, groupOf } from "../defaults";
import { heatColor, round } from "../util";
import DeletableEdge from "./DeletableEdge";

// 커스텀 엣지(가중치 라벨 + ✕ 삭제 버튼). 모듈 상수로 두어 매 렌더 재생성 방지.
const EDGE_TYPES = { deletable: DeletableEdge };

const kindLabel = (k) => NODE_KINDS.find((x) => x.key === k)?.label || k;

function nodeLabel(n, cnt, dens) {
  return (
    <div style={{ lineHeight: 1.25 }}>
      <div style={{ fontWeight: 700 }}>{n.name || n.id}</div>
      <div style={{ fontSize: 10, color: "#475569" }}>{kindLabel(n.kind)}</div>
      {cnt != null && (
        <div style={{ fontSize: 11 }}>{round(cnt, 0)}명 · {round(dens, 2)}/㎡</div>
      )}
    </div>
  );
}

function nodeStyle(n, dens, selected, hasSnap, rhoCap) {
  return {
    background: hasSnap ? heatColor(dens, rhoCap) : "#ffffff",
    color: "#0f172a",
    border: selected ? "3px solid #111827" : `2.5px solid ${KIND_COLOR[n.kind] || "#64748b"}`,
    borderRadius: 10,
    width: 132,
    padding: 8,
    fontSize: 12,
    textAlign: "center",
    boxShadow: "0 2px 8px rgba(15,23,42,0.18)",
  };
}

export default function GraphEditor() {
  const config = useStore((s) => s.config);
  const snapshot = useStore((s) => s.snapshot);
  const selection = useStore((s) => s.selection);
  const moveNode = useStore((s) => s.moveNode);
  const setSelection = useStore((s) => s.setSelection);
  const addLink = useStore((s) => s.addLink);
  const addNode = useStore((s) => s.addNode);
  const addNodePair = useStore((s) => s.addNodePair);
  const removeNode = useStore((s) => s.removeNode);
  const removeLink = useStore((s) => s.removeLink);
  const running = useStore((s) => s.running);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);

  // 노드 집합(추가/삭제) 키 — 속성 편집으로는 바뀌지 않음
  const nodeIdsKey = useMemo(() => config.nodes.map((n) => n.id).join("|"), [config.nodes]);

  // 구조 동기화: 노드 추가/삭제 시에만 React Flow 노드 배열을 (재)생성.
  // 속성/위치 편집으로는 재생성하지 않아 입력 포커스가 유지된다.
  useEffect(() => {
    setRfNodes(
      config.nodes.map((n) => ({
        id: n.id,
        position: { x: n.x, y: n.y },
        data: { label: nodeLabel(n, null, 0) },
        style: nodeStyle(n, 0, false, false, config.dynamics.rho_cap),
      }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeIdsKey, setRfNodes]);

  // 링크 동기화 — 커스텀 엣지(✕ 삭제 버튼 포함)
  useEffect(() => {
    setRfEdges(
      config.links.map((l) => {
        const id = `${l.src}->${l.dst}`;
        const sel = selection?.type === "link" && selection.id === id;
        return {
          id,
          source: l.src,
          target: l.dst,
          type: "deletable",
          data: { weight: l.weight, running, onDelete: () => removeLink(l.src, l.dst) },
          markerEnd: { type: "arrowclosed" },
          style: { stroke: sel ? "#111827" : "#94a3b8", strokeWidth: sel ? 2.5 : 2 },
        };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.links, selection, running, removeLink, setRfEdges]);

  // 히트맵/선택 시각화: 스냅샷·선택 변화 시 style·label 만 갱신(위치·측정 유지)
  const outputLevel = config.export?.output_level || "group";
  useEffect(() => {
    // 분석 단위(노드별/물리 그룹별)에 따라 노드에 표시할 혼잡도 계산
    const gCount = {};
    const gDens = {};
    if (snapshot) {
      if (outputLevel === "node") {
        // 노드별: 각 노드 자신의 혼잡도
        config.nodes.forEach((nn, i) => {
          gCount[nn.id] = snapshot.count[i] || 0;
          gDens[nn.id] = (snapshot.count[i] || 0) / (nn.area || 1);
        });
      } else {
        // 물리 그룹별: 분리 노드는 같은 장소이므로 합산
        const sums = {};
        const areas = {};
        config.nodes.forEach((nn, i) => {
          const g = groupOf(nn);
          sums[g] = (sums[g] || 0) + (snapshot.count[i] || 0);
          areas[g] = (areas[g] || 0) + (nn.area || 1);
        });
        config.nodes.forEach((nn) => {
          const g = groupOf(nn);
          gCount[nn.id] = sums[g];
          gDens[nn.id] = sums[g] / (areas[g] || 1);
        });
      }
    }
    setRfNodes((nds) =>
      nds.map((node) => {
        const n = config.nodes.find((x) => x.id === node.id);
        if (!n) return node;
        const dens = snapshot ? gDens[node.id] : 0;
        const cnt = snapshot ? gCount[node.id] : null;
        const selected = selection?.type === "node" && selection.id === node.id;
        return {
          ...node,                                   // 기존 노드 보존(포커스/측정 유지)
          position: { x: n.x, y: n.y },              // 위치 편집 반영
          data: { label: nodeLabel(n, cnt, dens) },  // 이름/종류/혼잡도 반영
          style: nodeStyle(n, dens, selected, !!snapshot, config.dynamics.rho_cap),
        };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, selection, config.nodes, outputLevel]);

  // 드래그 중에는 React Flow 내부 상태(onNodesChange)만 갱신해 부드럽게 움직이고,
  // 드래그가 끝나면 onNodeDragStop 에서 최종 좌표를 config 에 커밋한다.
  // (v11 의 position change 이벤트는 종료 시 position 을 항상 담지 않아 커밋이 누락 →
  //  재렌더 때 원위치로 튀던 문제를 onNodeDragStop 으로 확실히 해결.)
  const onNodeDragStop = useCallback(
    (_e, node) => {
      if (node && node.position) moveNode(node.id, Math.round(node.position.x), Math.round(node.position.y));
    },
    [moveNode]
  );

  const onConnect = useCallback((p) => addLink(p.source, p.target), [addLink]);
  const onInit = useCallback((inst) => {
    setTimeout(() => inst.fitView({ padding: 0.25, duration: 0 }), 80);
  }, []);

  // 캔버스에서 Delete/Backspace 로 삭제
  const onNodesDelete = useCallback((deleted) => deleted.forEach((n) => removeNode(n.id)), [removeNode]);
  const onEdgesDelete = useCallback(
    (deleted) => deleted.forEach((e) => { const [s, d] = e.id.split("->"); removeLink(s, d); }),
    [removeLink]
  );

  // 온보딩 가이드(최초 1회)
  const [showGuide, setShowGuide] = useState(() => {
    try { return !localStorage.getItem("sc_guide_dismissed"); } catch { return true; }
  });
  const dismissGuide = () => {
    try { localStorage.setItem("sc_guide_dismissed", "1"); } catch { /* ignore */ }
    setShowGuide(false);
  };

  // 노드 추가 모드: 양방향 쌍(권장) | 단일 노드
  const [pairMode, setPairMode] = useState(true);
  const addByMode = useCallback((kind) => (pairMode ? addNodePair(kind) : addNode(kind)), [pairMode, addNodePair, addNode]);

  // 명시적 링크 연결 모드: 출발 노드 → 도착 노드 클릭으로 단방향 링크 생성
  const [connectMode, setConnectMode] = useState(false);
  const [connectSrc, setConnectSrc] = useState(null);
  const handleNodeClick = useCallback(
    (e, n) => {
      if (connectMode) {
        if (!connectSrc) setConnectSrc(n.id);
        else if (n.id !== connectSrc) {
          addLink(connectSrc, n.id);
          setConnectSrc(null);
        }
      } else {
        setSelection({ type: "node", id: n.id });
      }
    },
    [connectMode, connectSrc, addLink, setSelection]
  );

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div className="ge-toolbar">
        <div className="seg seg-sm" role="group" aria-label="추가 모드">
          <button className={pairMode ? "on" : ""} aria-pressed={pairMode} disabled={running}
            title="진입/진출(또는 하차/승차)을 같은 물리 그룹으로 한 번에 추가" onClick={() => setPairMode(true)}>양방향 쌍</button>
          <button className={!pairMode ? "on" : ""} aria-pressed={!pairMode} disabled={running}
            title="노드 1개만 추가" onClick={() => setPairMode(false)}>단일</button>
        </div>
        <span style={{ fontSize: 12, color: "#475569", margin: "0 4px" }}>추가:</span>
        {NODE_KINDS.map((k) => (
          <button key={k.key} className="chip" disabled={running} style={{ borderColor: KIND_COLOR[k.key] }} onClick={() => addByMode(k.key)}>
            {k.label}
          </button>
        ))}
        <span className="ge-divider" />
        <button
          className={"chip linkbtn" + (connectMode ? " active" : "")}
          aria-pressed={connectMode}
          disabled={running}
          onClick={() => {
            setConnectMode((m) => !m);
            setConnectSrc(null);
          }}
        >
          {connectMode ? "연결 중 — 클릭해 종료" : "링크 연결"}
        </button>
        <span className="ge-hint">클릭=선택 · 드래그=이동 · Del=삭제</span>
      </div>

      {showGuide && (
        <div className="onboarding">
          <strong>시작하기</strong>
          <span>① 노드 추가 → ② “링크 연결”로 노드 잇기 → ③ “생성·실행”</span>
          <button onClick={dismissGuide} aria-label="가이드 닫기">닫기</button>
        </div>
      )}
      {connectMode && (
        <div className="connect-hint">
          {connectSrc ? `② 도착 노드 클릭 (출발: ${connectSrc})` : "① 출발 노드를 클릭하세요"} · 노드 테두리를 드래그해도 연결됩니다
        </div>
      )}

      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        nodesDraggable={!running}
        deleteKeyCode={running ? null : ["Backspace", "Delete"]}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onEdgeClick={(e, ed) => setSelection({ type: "link", id: ed.id })}
        onPaneClick={() => setSelection(null)}
        onInit={onInit}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} color="#e2e8f0" />
        <RFControls />
        <MiniMap pannable zoomable />
      </ReactFlow>

      {snapshot && (
        <div className="heat-legend" aria-hidden="true">
          <div className="hl-title">밀도(명/㎡)</div>
          <div className="hl-bar" />
          <div className="hl-scale"><span>0</span><span>{config.dynamics.rho_cap}</span></div>
        </div>
      )}
    </div>
  );
}
