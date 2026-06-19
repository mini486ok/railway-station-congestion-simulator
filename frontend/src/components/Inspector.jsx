import { useStore } from "../store";
import { NODE_KINDS, DIRECTION_LABELS } from "../defaults";
import { round } from "../util";
import InfoTip from "./InfoTip";

// 유입/하차 인원 분포 — 평균(rate/mean)·표준편차(sigma) 기반
const DISTS = [
  { v: "poisson", l: "푸아송(Poisson) · 무작위 도착" },
  { v: "normal", l: "정규(Normal)" },
  { v: "negative_binomial", l: "음이항(과분산·군집)" },
  { v: "uniform", l: "균등(Uniform)" },
  { v: "lognormal", l: "로그정규(LogNormal·버스트)" },
  { v: "constant", l: "상수(Constant)" },
];
// sigma(표준편차/반치폭) 입력이 의미 있는 분포
const USES_SIGMA = new Set(["normal", "negative_binomial", "uniform", "lognormal"]);
const DEFAULT_SCHEDULE = {
  first_arrival: 100, headway: 300, num_trains: 0,
  alight_mean: 100, alight_sigma: 15, alight_dist: "normal",
  dwell_steps: 30, train_capacity: 800, board_cap: 25, onboard_load: 0, delay_std: 0,
};

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
            if (kind === "platform") {
              if (!node.train_schedule) patch.train_schedule = { ...DEFAULT_SCHEDULE };
              if (!node.platform_role) patch.platform_role = "both";
            }
            set(patch);
          }}
        >
          {NODE_KINDS.map((k) => (
            <option key={k.key} value={k.key}>{k.label}</option>
          ))}
        </select>
      </Field>
      <Field label="방향" info="direction">
        <input value={node.direction || ""} list={`dir-${node.kind}`} placeholder="예: 진입/진출, 상행/하행 (선택)"
          onChange={(e) => set({ direction: e.target.value })} />
        <datalist id={`dir-${node.kind}`}>
          {(DIRECTION_LABELS[node.kind] || []).map((d) => <option key={d} value={d} />)}
        </datalist>
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

      {isEntrance && <SourceEditor node={node} set={set} />}
      {isPlatform && <PlatformEditor node={node} set={set} />}
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
          {DISTS.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}
        </select>
      </Field>
      {src.type !== "none" && (
        <Field label="스텝당 평균(λ/μ)" info="source.rate">
          <input type="number" step="0.1" value={src.rate} onChange={(e) => setSrc({ rate: +e.target.value })} />
        </Field>
      )}
      {USES_SIGMA.has(src.type) && (
        <Field label="표준편차/반치폭(σ)" info="source.sigma">
          <input type="number" step="0.1" value={src.sigma} onChange={(e) => setSrc({ sigma: +e.target.value })} />
        </Field>
      )}
      <div className="hint">{src.profile ? "러시아워 시간대 프로파일 적용됨" : "시간대 프로파일 없음(균일)"}</div>
    </div>
  );
}

// 승강장 역할(둘다/하차/승차) + 열차 스케줄(첫 도착 + 배차간격)
function PlatformEditor({ node, set }) {
  const role = node.platform_role || "both";
  const s = node.train_schedule || DEFAULT_SCHEDULE;
  const setS = (patch) => set({ train_schedule: { ...DEFAULT_SCHEDULE, ...s, ...patch } });
  const showAlight = role === "both" || role === "alight";
  const showBoard = role === "both" || role === "board";
  return (
    <div className="subsection">
      <div className="sub-title">승강장 역할 · 열차 스케줄 <InfoTip k="platform_role" /></div>
      <Field label="역할" info="platform_role">
        <select value={role} onChange={(e) => set({ platform_role: e.target.value })}>
          <option value="both">둘 다(하차+승차)</option>
          <option value="alight">하차(열차→역사 유입)</option>
          <option value="board">승차(역사→열차 유출)</option>
        </select>
      </Field>
      <div className="hint">
        {role === "alight" && "열차에서 내린 승객이 이 노드로 유입됩니다(하차 전용). 같은 그룹의 승차 노드와 묶으면 혼잡도가 합산됩니다."}
        {role === "board" && "역사에서 온 승객이 여기 모여 열차에 탑승(유출)합니다(승차 전용). 같은 그룹의 하차 노드와 묶으세요."}
        {role === "both" && "한 노드에서 하차(유입)와 승차(유출)를 모두 처리합니다."}
      </div>

      <div className="train-grid sched-grid">
        <label>첫 도착(스텝)<InfoTip k="schedule.first_arrival" /><input type="number" min="0" value={s.first_arrival} onChange={(e) => setS({ first_arrival: +e.target.value })} /></label>
        <label>배차간격(스텝)<InfoTip k="schedule.headway" /><input type="number" min="0" value={s.headway} onChange={(e) => setS({ headway: +e.target.value })} /></label>
        <label>운행 대수(0=끝까지)<InfoTip k="schedule.num_trains" /><input type="number" min="0" value={s.num_trains} onChange={(e) => setS({ num_trains: +e.target.value })} /></label>
        {showBoard && (
          <label>정차(스텝)<InfoTip k="train.dwell_steps" /><input type="number" min="1" value={s.dwell_steps} onChange={(e) => setS({ dwell_steps: +e.target.value })} /></label>
        )}
      </div>

      {showAlight && (
        <div className="sched-block">
          <div className="sched-h">하차(유입)</div>
          <Field label="하차 분포" info="schedule.alight_dist">
            <select value={s.alight_dist} onChange={(e) => setS({ alight_dist: e.target.value })}>
              {DISTS.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}
            </select>
          </Field>
          <Field label="하차 평균(명/열차)" info="train.alight_mean">
            <input type="number" min="0" value={s.alight_mean} onChange={(e) => setS({ alight_mean: +e.target.value })} />
          </Field>
          {USES_SIGMA.has(s.alight_dist) && (
            <Field label="표준편차/반치폭(σ)" info="source.sigma">
              <input type="number" min="0" value={s.alight_sigma} onChange={(e) => setS({ alight_sigma: +e.target.value })} />
            </Field>
          )}
        </div>
      )}

      {showBoard && (
        <div className="sched-block">
          <div className="sched-h">승차(유출)</div>
          <Field label="열차 용량(명)" info="schedule.train_capacity">
            <input type="number" min="0" value={s.train_capacity} onChange={(e) => setS({ train_capacity: +e.target.value })} />
          </Field>
          <Field label="탑승/스텝(명)" info="train.board_cap">
            <input type="number" min="0" value={s.board_cap} onChange={(e) => setS({ board_cap: +e.target.value })} />
          </Field>
        </div>
      )}
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
