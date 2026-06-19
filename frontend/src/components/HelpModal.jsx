import { useState } from "react";
import { useEscClose } from "./useModal";

function Code({ children }) {
  return <code className="ic">{children}</code>;
}

function UsageGuide() {
  return (
    <div className="help-body">
      <p className="lead">
        철도역사 내부를 <b>노드(지점)</b> 와 <b>링크(연결)</b> 로 그리고, 이용자 흐름을 이산 시간으로
        시뮬레이션해 지점별 <b>혼잡도(인원수) 시계열</b> 을 생성합니다. 생성 데이터는 STGCN 등
        혼잡도 예측 AI 모델 학습에 바로 쓸 수 있습니다.
      </p>

      <h4>① 역사 그래프 만들기</h4>
      <ul>
        <li><b>양방향 쌍 추가</b>: 툴바의 추가 모드가 <b>"양방향 쌍"</b>이면 종류(출입구/통로/…/승강장)를 누를 때
          서로 반대 방향 2노드(예: 입구+출구, 진입+진출)가 <b>같은 물리 그룹</b>으로 한 번에 생깁니다.
          (모드를 <b>"단일"</b>로 바꾸면 노드 1개만 추가됩니다.)</li>
        <li><b>링크 연결</b>: 툴바의 <b>"링크 연결"</b> 버튼을 누른 뒤 <b>출발 노드 → 도착 노드</b> 순으로 클릭하면 단방향 화살표가 생깁니다. (노드 테두리를 드래그해도 됩니다.)</li>
        <li><b>속성 편집</b>: 노드나 링크를 클릭하면 오른쪽 "속성"에서 방향·물리 그룹·면적·체류확률·거리·가중치 등을 바꿀 수 있습니다. 각 항목의 <span className="ibadge">i</span> 를 누르면 설명이 나옵니다.</li>
        <li><b>이동/삭제</b>: 노드를 드래그해 배치하고, 속성 창의 "삭제"로 지웁니다.</li>
      </ul>

      <h4>② 양방향 2노드 모델링 · 물리 그룹</h4>
      <p>
        링크는 <b>단방향</b>이라, 들어오는 사람과 나가는 사람이 섞이지 않습니다. 그래서 모든 물리 공간
        (출입구·통로·게이트·계단·에스컬레이터·엘리베이터·승강장)은 <b>서로 다른 방향의 2노드</b>로 만들고
        진입 경로와 진출 경로를 따로 그립니다. (예: 입구→대합실→게이트→계단→<b>승차</b> / <b>하차</b>→계단→게이트→대합실→출구).
        두 노드에 같은 <b>"물리 그룹"</b> 이름을 주면 혼잡도가 <b>하나의 물리적 장소</b>로 합산됩니다.
        기본 예제가 이렇게 구성되어 있고, <b>"양방향 쌍 추가"</b>가 이 작업을 자동으로 해 줍니다.
      </p>

      <h4>③ 발생·열차 설정</h4>
      <ul>
        <li><b>출입구</b>: 유입 분포(푸아송/정규/<b>음이항</b>/균등/<b>로그정규</b>/상수)와 평균·표준편차를 정합니다. (러시아워 프로파일도 적용 가능)</li>
        <li><b>승강장 역할</b>: <b>하차</b>(열차→역사 유입) / <b>승차</b>(역사→열차 유출) / 둘 다 중에서 고릅니다.
          하차·승차를 따로 만들고 같은 물리 그룹으로 묶으면 혼잡도가 합산됩니다.</li>
        <li><b>열차 스케줄</b>: <b>첫 도착 시점 + 배차간격</b> + 운행 대수(0=시뮬 끝까지)로 정의합니다.
          하차 인원(분포/평균)·정차 시간·탑승량을 함께 설정합니다.</li>
      </ul>

      <h4>④ 시뮬레이션 실행</h4>
      <ul>
        <li>"시뮬레이션" 패널에서 총 스텝·Δ(초)·시드 등을 정하고 <b>"검증"</b>으로 설정 오류를 확인합니다.</li>
        <li><b>"▶ 생성·실행"</b>으로 시작합니다. <b>속도(배속)</b>·<b>일시정지</b>·<b>정지</b>로 제어합니다.</li>
        <li><b>용량/스필백(CTM)</b>을 켜면 밀도가 ρ_cap을 넘지 않고 혼잡이 상류로 번집니다(현실적).</li>
      </ul>

      <h4>⑤ 결과 보기 & 내보내기</h4>
      <ul>
        <li>아래 <b>대시보드</b>에서 지점별 혼잡도 추이를, 그래프에서 노드 색(밀도 히트맵)을 봅니다.</li>
        <li><b>분석 단위</b>(<b>물리 그룹별</b> / <b>노드별</b>): 같은 그룹의 양방향 2노드를 하나의 장소로 합산해 볼지,
          노드 하나하나로 볼지 고릅니다. 차트·히트맵·내보내기에 모두 같이 적용됩니다.</li>
        <li>"데이터셋 내보내기"에서 CSV/X.npz를 내려받습니다. 위 ‘분석 단위’가 그대로 출력 단위가 됩니다(그룹별=G개 노드, 노드별=N개 노드). (각 파일 설명은 "출력 파일 설명" 탭 참고)</li>
      </ul>
    </div>
  );
}

function OutputGuide() {
  return (
    <div className="help-body">
      <p className="lead">
        "데이터셋 내보내기"는 끝까지 시뮬레이션한 결과를 아래 파일들로 저장합니다. 표 형태(CSV)와
        STGCN 직결 텐서(<Code>X.npz</Code>)를 함께 제공합니다.
      </p>

      <h4><Code>timeseries.csv</Code> — 혼잡도 시계열(핵심)</h4>
      <p>긴(long) 형식. 행마다 (시점, 노드)별 값이 들어갑니다.</p>
      <pre className="sample">
step,time_sec,node_id,count,density,inflow,outflow,p_stay{"\n"}
60,60.0,E_in,10.6,0.27,7.5,7.2,0.30{"\n"}
60,60.0,G_in,5.0,0.28,4.0,4.1,0.20{"\n"}
...</pre>
      <ul>
        <li><b>step / time_sec</b>: 시점(스텝) / 초 환산</li>
        <li><b>node_id</b>: 노드 식별자</li>
        <li><b>count</b>: 그 시점 노드 인원수(= 혼잡도, 예측 타깃)</li>
        <li><b>density</b>: 밀도(명/㎡) = count ÷ 면적</li>
        <li><b>inflow / outflow</b>: 그 구간 유입·유출 인원</li>
        <li><b>p_stay</b>: 그 시점 체류확률(동적이면 변동)</li>
      </ul>

      <h4><Code>departures.csv</Code> — 시스템 밖 유출</h4>
      <p>출입구별 퇴장, 승강장별 열차 탑승의 <b>누적/증분</b> 인원. 흐름 균형(무한 누적 방지) 확인용.</p>

      <h4><Code>nodes.csv</Code> / <Code>edges.csv</Code> — 그래프 구조</h4>
      <ul>
        <li><b>nodes.csv</b>: node_id, name, kind, group, direction, area … (노드별 출력 시 group·direction 열로 물리 그룹·방향을 확인)</li>
        <li><b>edges.csv</b>: src_id, dst_id, weight, distance, tau (방향성 링크)</li>
        <li><b>출력 단위</b>: ‘물리 그룹별’이면 같은 그룹의 양방향 노드가 1개로 합쳐져 행/노드 수가 줄고 adjacency도 그룹 그래프가 됩니다. ‘노드별’이면 모든 노드를 그대로 내보냅니다.</li>
      </ul>

      <h4><Code>X.npz</Code> — STGCN 직결 텐서(가장 중요)</h4>
      <p>numpy 압축 파일. 아래 배열들을 담습니다.</p>
      <ul>
        <li><Code>X</Code> [T, N, F]: 특징 텐서 (시점 × 노드 × 채널). 채널 예: count, density, inflow, outflow, (옵션)count_noisy</li>
        <li><Code>adjacency</Code> [N, N]: 인접행렬(그래프 구조) — STGCN 그래프 입력</li>
        <li><Code>edge_index</Code> [2, M], <Code>edge_attr</Code> [M, 3]: 엣지 리스트 + (weight, distance, tau)</li>
        <li><Code>node_ids</Code>, <Code>node_kinds</Code>, <Code>channels</Code>, <Code>output_level</Code>: 메타데이터(출력 단위 node/group)</li>
        <li><Code>feat_mean</Code>, <Code>feat_std</Code> [N, F]: 채널별 정규화 통계(+ 하위호환 <Code>count_mean/std</Code>)</li>
        <li><Code>group_members</Code> 또는 <Code>node_direction</Code>/<Code>node_group</Code>: 그룹↔노드·방향 매핑(출력 단위에 따라)</li>
      </ul>
      <pre className="sample">
import numpy as np{"\n"}
d = np.load("X.npz", allow_pickle=True){"\n"}
X = d["X"]            # [T, N, F]{"\n"}
A = d["adjacency"]    # [N, N]{"\n"}
print(X.shape, A.shape)</pre>

      <h4><Code>config.json</Code> — 재현용 설정</h4>
      <p>전체 파라미터·시드. 같은 config면 같은 결과가 재현됩니다.</p>

      <div className="help-note">
        시간 해상도: 시뮬은 세밀한 Δ로 돌고, "집계 간격"으로 export를 N스텝씩 묶어 다운샘플할 수
        있습니다(혼잡도=평균, 유입·유출=합계). 예측 주기에 맞춰 조정하세요.
      </div>
    </div>
  );
}

export default function HelpModal({ onClose }) {
  const [tab, setTab] = useState("usage");
  useEscClose(onClose);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="사용법 및 출력 파일 설명" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-tabs">
            <button className={tab === "usage" ? "active" : ""} onClick={() => setTab("usage")}>📖 사용법</button>
            <button className={tab === "output" ? "active" : ""} onClick={() => setTab("output")}>📄 출력 파일 설명</button>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-content">{tab === "usage" ? <UsageGuide /> : <OutputGuide />}</div>
      </div>
    </div>
  );
}
