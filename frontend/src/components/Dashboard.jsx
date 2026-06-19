import { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend, Brush, ReferenceLine,
} from "recharts";
import { useStore } from "../store";
import { CHART_COLORS, colorOf } from "../defaults";
import { round } from "../util";
import { useEscClose } from "./useModal";

function Stat({ label, value, unit }) {
  return (
    <div className="stat">
      <div className="stat-val">{value}{unit && <span className="stat-unit">{unit}</span>}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function clockOf(t, dt, startSec) {
  const s = startSec + t * dt;
  const h = Math.floor(s / 3600) % 24;
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function ChartPanel({ data, nodes, hidden, metric, dt, startSec, rhoCap, timeAxis, height, brush }) {
  const unit = metric === "density" ? " /㎡" : "명";
  const xFmt = timeAxis === "clock" ? (t) => clockOf(t, dt, startSec) : (t) => `${t}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 18, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
        <XAxis dataKey="t" tick={{ fontSize: 11 }} minTickGap={44} tickFormatter={xFmt} />
        <YAxis tick={{ fontSize: 11 }} width={44}
          label={{ value: metric === "density" ? "명/㎡" : "명", angle: -90, position: "insideLeft", fontSize: 11, fill: "#64748b" }} />
        <Tooltip
          isAnimationActive={false}
          labelFormatter={(t) => (timeAxis === "clock" ? `${clockOf(t, dt, startSec)} (t=${t})` : `t=${t} (${round(t * dt, 0)}초)`)}
          formatter={(v, name) => [round(v, metric === "density" ? 2 : 1) + unit, name]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {metric === "density" && rhoCap > 0 && (
          <ReferenceLine y={rhoCap} stroke="#dc2626" strokeDasharray="5 4"
            label={{ value: `정체(ρ_cap=${rhoCap})`, fontSize: 10, fill: "#dc2626", position: "insideTopRight" }} />
        )}
        {nodes.map((n, i) =>
          hidden[n.id] ? null : (
            <Line key={n.id} type="monotone" dataKey={n.id} name={n.name || n.id}
              stroke={colorOf(n.id)} dot={false} strokeWidth={1.8}
              isAnimationActive={false} connectNulls />
          )
        )}
        {brush && <Brush dataKey="t" height={18} stroke="#94a3b8" travellerWidth={8} tickFormatter={xFmt} />}
      </LineChart>
    </ResponsiveContainer>
  );
}

export default function Dashboard() {
  const config = useStore((s) => s.config);
  const snapshot = useStore((s) => s.snapshot);
  const history = useStore((s) => s.history);

  const [metric, setMetric] = useState("count"); // count | density
  const [timeAxis, setTimeAxis] = useState("step"); // step | clock
  const [hidden, setHidden] = useState({});
  const [big, setBig] = useState(false);
  useEscClose(() => setBig(false));

  const nodes = config.nodes;
  const areaById = useMemo(() => {
    const m = {};
    nodes.forEach((n) => (m[n.id] = n.area || 1));
    return m;
  }, [nodes]);

  const data = useMemo(() => {
    if (metric !== "density") return history;
    return history.map((row) => {
      const r = { t: row.t };
      nodes.forEach((n) => {
        if (row[n.id] != null) r[n.id] = row[n.id] / (areaById[n.id] || 1);
      });
      return r;
    });
  }, [history, metric, nodes, areaById]);

  const pct = snapshot ? Math.min(100, (snapshot.t / config.total_steps) * 100) : 0;
  const toggle = (id) => setHidden((h) => ({ ...h, [id]: !h[id] }));
  const allHidden = nodes.length > 0 && nodes.every((n) => hidden[n.id]);

  const chartProps = {
    data, nodes, hidden, metric, dt: config.dt_seconds, startSec: config.start_time_sec,
    rhoCap: config.dynamics.rho_cap, timeAxis,
  };

  const Controls = (
    <div className="chart-controls">
      <div className="seg" role="group" aria-label="값 종류">
        <button className={metric === "count" ? "on" : ""} aria-pressed={metric === "count"} onClick={() => setMetric("count")}>인원수</button>
        <button className={metric === "density" ? "on" : ""} aria-pressed={metric === "density"} onClick={() => setMetric("density")}>밀도(명/㎡)</button>
      </div>
      <div className="seg" role="group" aria-label="가로축">
        <button className={timeAxis === "step" ? "on" : ""} aria-pressed={timeAxis === "step"} onClick={() => setTimeAxis("step")}>스텝</button>
        <button className={timeAxis === "clock" ? "on" : ""} aria-pressed={timeAxis === "clock"} onClick={() => setTimeAxis("clock")}>시각</button>
      </div>
      <button className="mini" onClick={() => setHidden(allHidden ? {} : Object.fromEntries(nodes.map((n) => [n.id, true])))}>
        {allHidden ? "모두 표시" : "모두 숨김"}
      </button>
      <div className="node-toggles">
        {nodes.map((n, i) => (
          <button key={n.id} className={"ntoggle" + (hidden[n.id] ? " off" : "")} aria-pressed={!hidden[n.id]}
            style={{ borderColor: colorOf(n.id) }} onClick={() => toggle(n.id)}>
            <span className="dot" style={{ background: colorOf(n.id) }} />
            {n.name || n.id}
          </button>
        ))}
      </div>
      <button className="expand-btn" onClick={() => setBig((b) => !b)}>{big ? "축소" : "크게 보기"}</button>
    </div>
  );

  return (
    <div className="dashboard">
      <div className="stat-row">
        <Stat label="진행" value={snapshot ? `${snapshot.t}/${config.total_steps}` : "-"} />
        <Stat label="역사 내 인원" value={snapshot ? round(snapshot.total_in_station, 0) : "-"} unit="명" />
        <Stat label="입구 대기큐" value={snapshot ? round(snapshot.queue, 0) : "-"} unit="명" />
        <Stat label="누적 유출" value={snapshot ? round(snapshot.egress, 0) : "-"} unit="명" />
        <Stat label="누적 유입" value={snapshot ? round(snapshot.generated, 0) : "-"} unit="명" />
      </div>
      <div className="progress"><div className="progress-bar" style={{ width: `${pct}%` }} /></div>

      {Controls}
      <div className="chart-wrap">
        {history.length === 0 ? (
          <div className="chart-empty">“생성·실행”을 누르면 지점별 혼잡도 시계열이 여기에 표시됩니다.</div>
        ) : (
          <ChartPanel {...chartProps} height="100%" brush />
        )}
      </div>
      <div className="chart-caption">
        {metric === "count" ? "지점별 인원수" : "지점별 밀도(명/㎡)"} 추이 · 아래 막대로 구간 확대 · 칩으로 노드 표시 토글
      </div>

      {big && (
        <div className="modal-overlay" onClick={() => setBig(false)}>
          <div className="modal chart-modal" role="dialog" aria-modal="true" aria-label="혼잡도 시계열 자세히 보기" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>혼잡도 시계열 — 자세히 보기</strong>
              <button className="modal-close" onClick={() => setBig(false)} aria-label="닫기">✕</button>
            </div>
            <div style={{ padding: "8px 12px 0" }}>{Controls}</div>
            <div style={{ flex: 1, minHeight: 0, padding: "0 12px 12px" }}>
              <ChartPanel {...chartProps} height="100%" brush />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
