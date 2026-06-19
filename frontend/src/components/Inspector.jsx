import { useStore } from "../store";
import { NODE_KINDS } from "../defaults";
import { round } from "../util";
import InfoTip from "./InfoTip";

function Field({ label, info, children }) {
  return (
    <label className="field">
      <span>
        {label}
        {info && <InfoTip k={info} />}
      </span>
      {children}
    </label>
  );
}

function NodeEditor({ node }) {
  const update = useStore((s) => s.updateNode);
  const remove = useStore((s) => s.removeNode);
  const links = useStore((s) => s.config.links);
  const set = (patch) => update(node.id, patch);

  const isEntrance = node.kind === "entrance";
  const isPlatform = node.kind === "platform";
  const canSource = isEntrance || isPlatform;

  const outW =
    links.filter((l) => l.src === node.id).reduce((a, l) => a + (l.weight || 0), 0) +
    (isEntrance ? node.exit_weight || 0 : 0);
  const hasOut = links.some((l) => l.src === node.id) || (isEntrance && node.exit_weight > 0);
  const pmove = 1 - (node.p_stay_base || 0);

  return (
    <div>
      <div className="insp-head">
        <strong>노드: {node.id}</strong>
        <button className="danger" onClick={() => remove(node.id)}>삭제</button>
      </div>

      <Field label="이름" info="name">
        <input value={node.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <Field label="종류" info="kind">
        <select
          value={node.kind}
          onChange={(e) => {
            const kind = e.target.value;
            const patch = { kind };
            if (kind !== "entrance") patch.exit_weight = 0;
            if (!(kind === "entrance" || kind === "platform")) {
              patch.source = null;
              patch.trains = [];
            }
            if (kind === "entrance" && !node.source) patch.source = { type: "poisson", rate: 1.0, sigma: 0, profile: null };
            set(patch);
          }}
        >
          {NODE_KINDS.map((k) => (
            <option key={k.key} value={k.key}>{k.label}</option>
          ))}
        </select>
      </Field>
      <Field label="물리 그룹" info="group">
        <input value={node.group || ""} placeholder="예: 출입구 (비우면 단독)"
          onChange={(e) => set({ group: e.target.value })} />
      </Field>
      <Field label="면적 (㎡)" info="area">
        <input type="number" value={node.area} onChange={(e) => set({ area: +e.target.value })} />
      </Field>
      <Field label="기본 체류확률" info="p_stay_base">
        <input type="number" step="0.05" min="0" max="1" value={node.p_stay_base} onChange={(e) => set({ p_stay_base: +e.target.value })} />
      </Field>
      <div className="hint">→ 이동확률(P_move) = {round(pmove, 2)}</div>
      <Field label="동적 체류확률(혼잡 반영)" info="dynamic_pstay">
        <input type="checkbox" checked={node.dynamic_pstay} onChange={(e) => set({ dynamic_pstay: e.target.checked })} />
      </Field>
      <Field label="초기 인원" info="n0">
        <input type="number" value={node.n0} onChange={(e) => set({ n0: +e.target.value })} />
      </Field>

      {node.kind === "gate" && (
        <Field label="통과 처리율/스텝" info="throughput_cap">
          <input type="number" min="0" value={node.throughput_cap || 0}
            onChange={(e) => set({ throughput_cap: +e.target.value })} />
        </Field>
      )}
      {node.kind === "elevator" && (
        <div className="subsection">
          <div className="sub-title">엘리베이터 거동</div>
          <Field label="운행 주기(슬롯)" info="elevator_cycle">
            <input type="number" min="1" value={node.elevator_cycle || 0}
              onChange={(e) => set({ elevator_cycle: +e.target.value })} />
          </Field>
          <Field label="수송 용량(명)" info="elevator_capacity">
            <input type="number" min="0" value={node.elevator_capacity || 0}
              onChange={(e) => set({ elevator_capacity: +e.target.value })} />
          </Field>
          <div className="hint">주기 슬롯마다 용량만큼 한 번에 하류로 유출됩니다.</div>
        </div>
      )}

      {isEntrance && (
        <Field label="퇴장 비율(→역사 밖)" info="exit_weight">
          <input type="number" step="0.05" min="0" max="1" value={node.exit_weight} onChange={(e) => set({ exit_weight: +e.target.value })} />
        </Field>
      )}

      {hasOut && (
        <div className={"weightsum " + (Math.abs(outW - 1) < 0.01 ? "ok" : "info")}>
          출력 가중치 합: {round(outW, 3)}
          {Math.abs(outW - 1) < 0.01 ? " ✓" : " — 합이 1이 되도록 비율을 유지한 채 자동 정규화됩니다"}
        </div>
      )}

      {canSource && <SourceEditor node={node} set={set} />}
      {isPlatform && <TrainEditor node={node} set={set} />}
    </div>
  );
}

function SourceEditor({ node, set }) {
  const src = node.source || { type: "none", rate: 0, sigma: 0, profile: null };
  const setSrc = (patch) => set({ source: { ...src, ...patch } });
  return (
    <div className="subsection">
      <div className="sub-title">자체 발생(유입) 패턴 <InfoTip k="source.type" /></div>
      <Field label="분포" info="source.type">
        <select value={src.type} onChange={(e) => setSrc({ type: e.target.value })}>
          <option value="none">없음</option>
          <option value="poisson">푸아송(Poisson)</option>
          <option value="normal">정규(Normal)</option>
          <option value="constant">상수(Constant)</option>
        </select>
      </Field>
      {src.type !== "none" && (
        <Field label="스텝당 평균(λ/μ)" info="source.rate">
          <input type="number" step="0.1" value={src.rate} onChange={(e) => setSrc({ rate: +e.target.value })} />
        </Field>
      )}
      {src.type === "normal" && (
        <Field label="표준편차(σ)" info="source.sigma">
          <input type="number" step="0.1" value={src.sigma} onChange={(e) => setSrc({ sigma: +e.target.value })} />
        </Field>
      )}
      <div className="hint">{src.profile ? "러시아워 시간대 프로파일 적용됨" : "시간대 프로파일 없음(균일)"}</div>
    </div>
  );
}

function TrainEditor({ node, set }) {
  const trains = node.trains || [];
  const upd = (i, patch) => set({ trains: trains.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const add = () =>
    set({ trains: [...trains, { t_arrival: 100, alight_mean: 100, alight_sigma: 15, alight_dist: "normal", dwell_steps: 30, train_capacity: 800, board_cap: 25 }] });
  const del = (i) => set({ trains: trains.filter((_, j) => j !== i) });
  return (
    <div className="subsection">
      <div className="sub-title">열차 스케줄 (하차=유입 / 탑승=유출) <InfoTip k="train.t_arrival" /></div>
      {trains.map((t, i) => (
        <div key={i} className="train-row">
          <div className="train-grid">
            <label>도착(스텝)<InfoTip k="train.t_arrival" /><input type="number" value={t.t_arrival} onChange={(e) => upd(i, { t_arrival: +e.target.value })} /></label>
            <label>하차 평균<InfoTip k="train.alight_mean" /><input type="number" value={t.alight_mean} onChange={(e) => upd(i, { alight_mean: +e.target.value })} /></label>
            <label>정차(스텝)<InfoTip k="train.dwell_steps" /><input type="number" value={t.dwell_steps} onChange={(e) => upd(i, { dwell_steps: +e.target.value })} /></label>
            <label>탑승/스텝<InfoTip k="train.board_cap" /><input type="number" value={t.board_cap} onChange={(e) => upd(i, { board_cap: +e.target.value })} /></label>
          </div>
          <button className="danger small" onClick={() => del(i)}>×</button>
        </div>
      ))}
      <button className="chip" onClick={add}>+ 열차 추가</button>
    </div>
  );
}

function LinkEditor({ link }) {
  const update = useStore((s) => s.updateLink);
  const remove = useStore((s) => s.removeLink);
  const set = (patch) => update(link.src, link.dst, patch);
  return (
    <div>
      <div className="insp-head">
        <strong>링크: {link.src} → {link.dst}</strong>
        <button className="danger" onClick={() => remove(link.src, link.dst)}>삭제</button>
      </div>
      <div className="hint">방향: {link.src} 에서 {link.dst} 로 향하는 <b>단방향</b> 흐름입니다.</div>
      <Field label="거리 (m)" info="distance">
        <input type="number" value={link.distance} onChange={(e) => set({ distance: +e.target.value })} />
      </Field>
      <Field label="가중치" info="weight">
        <input type="number" step="0.05" value={link.weight} onChange={(e) => set({ weight: +e.target.value })} />
      </Field>
      <Field label="소요시간 τ (스텝, 비우면 자동)" info="tau">
        <input
          type="number"
          value={link.tau ?? ""}
          placeholder="자동(거리/속력)"
          onChange={(e) => set({ tau: e.target.value === "" ? null : +e.target.value })}
        />
      </Field>
    </div>
  );
}

export default function Inspector() {
  const selection = useStore((s) => s.selection);
  const config = useStore((s) => s.config);

  if (!selection) {
    const nEnt = config.nodes.filter((n) => n.kind === "entrance").length;
    const nPlat = config.nodes.filter((n) => n.kind === "platform").length;
    return (
      <div className="insp-empty">
        <p>왼쪽 그래프에서 <b>노드나 링크를 클릭</b>하면 여기서 면적·체류확률·거리·가중치 등을 편집할 수 있습니다.</p>
        <div className="insp-summary">노드 {config.nodes.length} · 링크 {config.links.length} · 출입구 {nEnt} · 승강장 {nPlat}</div>
        <div className="insp-steps">① 노드 추가 → ② 링크 연결 → ③ 생성·실행</div>
      </div>
    );
  }
  if (selection.type === "node") {
    const node = config.nodes.find((n) => n.id === selection.id);
    return node ? <NodeEditor node={node} /> : <div className="insp-empty">선택한 노드가 없습니다.</div>;
  }
  const [src, dst] = selection.id.split("->");
  const link = config.links.find((l) => l.src === src && l.dst === dst);
  return link ? <LinkEditor link={link} /> : <div className="insp-empty">선택한 링크가 없습니다.</div>;
}
