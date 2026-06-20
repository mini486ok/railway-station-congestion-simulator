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
        시뮬레이션해 지점별 <b>혼잡도(인원수) 시계열</b> 을 생성합니다. 생성 데이터는
        혼잡도 예측 <b>AI 모델</b> 학습에 바로 쓸 수 있습니다.
      </p>

      <div className="help-note">
        <b>처음이신가요?</b> 상단 <b>📁 템플릿</b>에서 예제(가장 작은 “단순 통로형” 또는 기본 예제)를 불러와
        <b>▶ 생성·실행</b>만 눌러 보세요. 익숙해지면 노드를 추가/편집하면 됩니다.
        용어·분포·CTM 등 개념은 <b>파라미터·개념</b> 탭, 자주 묻는 질문은 <b>FAQ</b> 탭을 참고하세요.
      </div>

      <h4>① 역사 그래프 만들기</h4>
      <ul>
        <li><b>양방향 쌍 추가</b>: 툴바의 추가 모드가 <b>"양방향 쌍"</b>이면 종류(출입구/통로/…/승강장)를 누를 때
          서로 반대 방향 2노드(예: 입구+출구, 진입+진출)가 <b>같은 물리 그룹</b>으로 한 번에 생깁니다.
          (모드를 <b>"단일"</b>로 바꾸면 노드 1개만 추가됩니다.)</li>
        <li><b>링크 연결</b>: 툴바의 <b>"링크 연결"</b> 버튼을 누른 뒤 <b>출발 노드 → 도착 노드</b> 순으로 클릭하면 단방향 화살표가 생깁니다. (노드 테두리를 드래그해도 됩니다.)</li>
        <li><b>복사/붙여넣기</b>: 노드를 클릭(또는 빈 곳을 드래그해 여러 개 선택)하고 <b>Ctrl+C → Ctrl+V</b>
          (또는 툴바의 <b>“복사” / “붙여넣기”</b> 버튼)로 똑같은 노드·내부 링크를 빠르게 복제합니다.
          붙여넣은 노드는 <b>새 id·새 물리 그룹</b>으로 생기며 살짝 옆에 놓입니다(원본과 자동 합쳐지지 않음).</li>
        <li><b>속성 편집</b>: 노드나 링크를 클릭하면 오른쪽 "속성"에서 방향·물리 그룹·면적·체류확률·거리·가중치 등을 바꿀 수 있습니다. 각 항목의 <span className="ibadge">i</span> 를 누르면 설명이 나옵니다.</li>
        <li><b>이동/삭제</b>: 노드를 드래그해 배치하고, 속성 창의 "삭제"(또는 Del 키)로 지웁니다. <b>Ctrl+Z</b>로 되돌릴 수 있습니다.</li>
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
        <li><b>출입구</b>: 유입 분포(푸아송/정규/<b>음이항</b>/균등/<b>로그정규</b>/상수)와 평균·표준편차를 정합니다. (러시아워 프로파일도 적용 가능 — 자세한 분포 설명은 <b>파라미터·개념</b> 탭)</li>
        <li><b>승강장 역할</b>: <b>하차</b>(열차→역사 유입) / <b>승차</b>(역사→열차 유출) / 둘 다 중에서 고릅니다.
          하차·승차를 따로 만들고 같은 물리 그룹으로 묶으면 혼잡도가 합산됩니다.</li>
        <li><b>열차 스케줄</b>: <b>첫 도착 스텝 + 배차간격</b> + 운행 대수(0=시뮬 끝까지)로 정의합니다.
          하차 인원(분포/평균)·정차 시간·탑승량을 함께 설정합니다.</li>
      </ul>

      <h4>④ 시뮬레이션 실행</h4>
      <ul>
        <li>"시뮬레이션" 패널에서 총 스텝·Δ(초/스텝)·시드 등을 정하고 <b>"검증"</b>으로 설정 오류를 확인합니다.</li>
        <li><b>"▶ 생성·실행"</b>으로 시작합니다. <b>속도(배속)</b>·<b>일시정지</b>·<b>정지</b>로 제어합니다.</li>
        <li><b>용량/스필백(CTM)</b>을 켜면 밀도가 ρ_cap을 넘지 않고 혼잡이 상류로 번집니다(현실적). 개념은 <b>파라미터·개념</b> 탭 참고.</li>
      </ul>

      <h4>⑤ 결과 보기 & 내보내기</h4>
      <ul>
        <li>아래 <b>대시보드</b>에서 지점별 혼잡도 추이를, 그래프에서 노드 색(밀도 히트맵)을 봅니다.</li>
        <li><b>분석 단위</b>(<b>물리 그룹별</b> / <b>노드별</b>): 같은 그룹의 양방향 2노드를 하나의 장소로 합산해 볼지,
          노드 하나하나로 볼지 고릅니다. 차트·히트맵·내보내기에 모두 같이 적용됩니다.</li>
        <li>"데이터셋 내보내기"의 <b>전체 번들(ZIP)</b>은 <b>노드별·물리 그룹별</b> GNN 파일을 한 번에 담습니다.
          개별 CSV/X.npz는 위 ‘분석 단위’를 따릅니다. (각 파일 설명은 "출력 파일 설명" 탭 참고)</li>
      </ul>
    </div>
  );
}

function ConceptGuide() {
  return (
    <div className="help-body">
      <p className="lead">
        파라미터의 의미와 시뮬레이터가 쓰는 핵심 개념(시간 단위, 확률 분포, 동적 체류확률,
        용량/스필백)을 정리했습니다. 각 입력 옆 <span className="ibadge">i</span> 버튼에서도
        같은 설명을 볼 수 있습니다.
      </p>

      <h4>⏱ 시간 단위 — “스텝”과 “초” 두 가지만</h4>
      <p>
        모든 시간은 <b>스텝(step)</b> 하나로 셉니다. 스텝은 시뮬레이션의 <b>이산 시간 단위(=시점)</b>이며,
        한 스텝의 실제 길이는 <Code>Δ(초/스텝)</Code> 로 정합니다(예: Δ=1 → 1스텝=1초).
        화면·문서의 “시점”은 곧 그 스텝을 가리키고, 실제 시계 시각이 필요할 때만 <b>초</b>(time_sec, 시작시각)를 씁니다.
        엘리베이터 운행 주기, 열차 첫 도착·배차간격, 정차 시간, 워밍업, 집계 간격, 소요시간 τ —
        시간과 관련된 값은 <b>모두 스텝 단위</b>입니다.
      </p>

      <h4>📊 유입·하차 확률 분포</h4>
      <p>출입구 유입과 열차 하차 인원을 어떤 무작위성으로 발생시킬지 고릅니다. 평균은 <b>스텝당 평균(λ/μ)</b> 또는 <b>하차 평균(명/열차)</b> 입니다.</p>
      <ul>
        <li><b>푸아송(Poisson)</b>: 도착이 서로 독립인 무작위 흐름. 분산=평균. <i>대부분의 출입구 유입 기본값.</i></li>
        <li><b>정규(Normal)</b>: 평균 근처로 부드럽게 변동(σ로 폭 조절). 음수는 0으로 자릅니다.</li>
        <li><b>음이항(Neg. Binomial)</b>: <b>과분산</b>(분산&gt;평균). 도착이 몰렸다 뜸했다 하는 <b>군집·변동</b>을 반영. σ를 평균보다 크게.</li>
        <li><b>균등(Uniform)</b>: 평균 ± 반치폭(σ) 사이에서 고르게.</li>
        <li><b>로그정규(LogNormal)</b>: 우편향(가끔 큰 <b>버스트</b>). 갑작스러운 인파를 만들 때.</li>
        <li><b>상수(Constant)</b>: 변동 없이 정확히 평균만큼. 검증·디버그용.</li>
      </ul>
      <p>
        <b>러시아워 프로파일</b>을 켜면 평균에 시간대 배율(예: 08시 ×2.5, 18시 ×2.2, 야간 ×0.2)이 곱해집니다.
        <b>수요 다양성</b>(전역 설정)은 런(시드)별 일간 배율과 노드 간 공통요인을 더해 AI 모델 학습 신호를 풍부하게 합니다.
      </p>

      <h4>🚶 동적 체류확률(혼잡 → 느려짐)</h4>
      <p>
        각 노드는 매 스텝 <b>체류확률 P_stay</b> 로 머물고 <b>이동확률 P_move=1−P_stay</b> 로 다음 노드로 갑니다.
        <b>동적 체류확률</b>을 켜면 <b>밀도-속력 기본도</b>(Weidmann)에 따라 <b>혼잡할수록 보행속력이 느려져 더 오래 머뭅니다</b>:
      </p>
      <pre className="sample">
v(ρ) = v0 · [1 − exp(−γ·(1/ρ − 1/ρ_max))]   (밀도 ρ가 클수록 속력 v 감소){"\n"}
P_stay = clip( 1 − (1−P_stay_base)·v(ρ)/v0,  P_stay_base,  0.98 )</pre>
      <ul>
        <li>한산할 때(ρ→0): P_stay ≈ <b>기본 체류확률</b>. 혼잡할 때(ρ→ρ_max): P_stay → 정체.</li>
        <li>진동을 막기 위해 1차 저역통과(lpf_alpha)로 부드럽게 바뀌고, 상한(0.98)으로 완전 잠김을 방지합니다.</li>
        <li>끄면 P_stay는 항상 <b>기본 체류확률</b> 고정(혼잡과 무관).</li>
      </ul>

      <h4>🚧 용량 / 스필백 (CTM)</h4>
      <p>
        <b>CTM</b>(Cell Transmission Model)은 교통류 이론의 셀 전달 모형으로, “하류가 꽉 차면 상류가 못 들어간다”는
        <b>용량 제약과 정체의 역전파</b>를 표현합니다. 이 시뮬레이터에선 다음을 적용합니다:
      </p>
      <ul>
        <li><b>용량 상한</b>: 노드가 받을 수 있는 최대 인원 = 면적 × <Code>ρ_cap</Code>(명/㎡, 보통 5~6). 밀도가 이 상한을 넘지 못합니다.</li>
        <li><b>스필백(역전파)</b>: 하류 노드가 가득 차면 들어가지 못한 인원이 <b>상류 노드에 그대로 남아</b> 대기합니다 → 정체가 입구 쪽으로 번집니다.</li>
        <li><b>게이트 처리율</b>: 게이트는 <Code>통과 처리율/스텝</Code>만큼만 통과시켜 개찰 병목을 모사합니다.</li>
        <li>끄면 밀도 상한·역전파가 없어 혼잡이 무한히 쌓일 수 있습니다(이론적 상한 검증용).</li>
      </ul>
      <div className="help-note">
        CTM을 켜면 비현실적 발산을 막고 “정체가 번지는” 현실적 혼잡 패턴이 생깁니다. 데이터 생성에는 <b>켜는 것을 권장</b>합니다.
      </div>

      <h4>🧩 주요 파라미터 요약</h4>
      <table className="param-table">
        <tbody>
          <tr><td>면적(㎡)</td><td>밀도 = 인원 ÷ 면적. 용량 상한(면적×ρ_cap)·동적 체류확률에 사용. 공유 공간을 양방향 2노드로 나누면 <b>방향당 면적은 절반</b>(그룹 합=실제).</td></tr>
          <tr><td>기본 체류확률</td><td>0~1. 한산할 때의 머무를 확률. 이동확률=1−값.</td></tr>
          <tr><td>퇴장 비율(출입구)</td><td>출입구에서 역사 <b>밖으로</b> 나가는 비율. 출구 전용이면 1.</td></tr>
          <tr><td>통과 처리율/스텝(게이트·계단·ES)</td><td>한 스텝에 통과시킬 최대 인원. 0=무제한. 한 노드는 보통 <b>여러 대를 묶은 설비군 전체</b>(예: 개찰구 뱅크, 계단군)를 뜻하므로 값도 설비군 기준입니다.</td></tr>
          <tr><td>엘리베이터 주기/용량</td><td>주기(스텝)마다 용량만큼 한 번에 수송(배치 거동).</td></tr>
          <tr><td>거리(m) / τ(스텝)</td><td>거리로 소요시간 τ를 자동 계산(최소 1). t 스텝에 출발 → t+τ 도착.</td></tr>
          <tr><td>가중치</td><td>한 노드의 여러 출력 링크 중 이 링크로 갈 비율. 같은 노드 출력 합이 1이 되도록 자동 정규화.</td></tr>
          <tr><td>열차: 첫 도착·배차간격(스텝)</td><td>첫 열차 스텝과 반복 간격. 운행 대수 0=끝까지.</td></tr>
          <tr><td>열차 용량 / 재차 / 탑승·스텝</td><td>가용 좌석=용량−재차. 정차 동안 스텝당 탑승 상한까지 태웁니다.</td></tr>
          <tr><td>집계 간격(스텝)</td><td>export를 N스텝씩 묶어 다운샘플(혼잡도=평균, 유입·유출=합). 1=원해상도.</td></tr>
          <tr><td>관측 노이즈</td><td>센서 오차를 흉내낸 count_noisy 채널을 추가(가우시안/포아송).</td></tr>
          <tr><td>분석·출력 단위</td><td>물리 그룹별(양방향 합산) / 노드별. 차트·히트맵·내보내기에 공통 적용.</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function OutputGuide() {
  return (
    <div className="help-body">
      <p className="lead">
        "데이터셋 내보내기"는 끝까지 시뮬레이션한 결과를 아래 파일들로 저장합니다.
        <b>전체 번들(ZIP)</b>은 <Code>node/</Code>(노드별)·<Code>group/</Code>(물리 그룹별) 두 단위를
        한 번에 담고, 개별 버튼은 화면의 ‘분석·출력 단위’ 설정을 따릅니다.
      </p>

      <h4><Code>전체 번들(ZIP)</Code> — 노드 + 그룹 한 번에</h4>
      <pre className="sample">
station_GNN_bundle.zip{"\n"}
├─ node/   nodes.csv  edges.csv  timeseries.csv  departures.csv  X.npz   ← 노드별{"\n"}
├─ group/  nodes.csv  edges.csv  timeseries.csv  departures.csv  X.npz   ← 물리 그룹별{"\n"}
├─ config.json   (재현용 전체 설정){"\n"}
└─ README.txt</pre>
      <p>
        <b>연결성</b>(edges의 adjacency)·<b>거리</b>(distance)·<b>시간</b>(τ)·<b>피처</b>(timeseries/X.npz)의
        구성 파일을 <b>두 해상도로 동시에</b> 얻습니다. 물리 그룹이 없으면 두 폴더 내용은 동일합니다.
      </p>

      <h4><Code>대량 생성(ZIP)</Code> — 여러 시드 한 번에</h4>
      <p>그래프 구조는 반복 횟수 N과 무관하게 같으므로 <b>1번만</b>, 혼잡도는 시드별로 <b>N개</b> 저장합니다.</p>
      <pre className="sample">
station_dataset_x20.zip{"\n"}
├─ nodes.csv  edges.csv          ← 공유 그래프 구조(1회){"\n"}
├─ runs/  run_0000.csv … run_0019.csv   ← 시드별 혼잡도 시계열(N개){"\n"}
├─ X_all.npz                     ← X_all[R,T,N,F] + 공유 그래프(1회) — AI 직결{"\n"}
└─ config.json   manifest.json(seeds·단위·shape)</pre>
      <p>
        “실행 횟수”를 정하면 <b>시드를 자동으로 1씩 바꿔 N회</b> 실행합니다.
        <Code>runs/run_XXXX.csv</Code>는 시드별 혼잡도(사람이 읽기 쉬움), <Code>X_all.npz</Code>는
        모든 실현을 쌓은 <Code>X_all[R,T,N,F]</Code> 텐서에 그래프를 1회만 담은 AI 모델 직결 파일입니다.
        <b>run(시드) 단위로 train/val/test를 나누면</b> 같은 시나리오의 시간조각이 섞이는 누설을 막을 수 있습니다.
        (저장소 <Code>ml/dataset.py</Code> 의 <Code>build_dataset_from_stack</Code>로 바로 학습 데이터를 만들 수 있습니다.)
      </p>

      <h4><Code>timeseries.csv</Code> — 혼잡도 시계열(핵심)</h4>
      <p>긴(long) 형식. 행마다 (스텝, 노드)별 값이 들어갑니다.</p>
      <pre className="sample">
step,time_sec,node_id,count,density,inflow,outflow,p_stay{"\n"}
60,60.0,E_in,10.6,0.27,7.5,7.2,0.30{"\n"}
60,60.0,G_in,5.0,0.28,4.0,4.1,0.20{"\n"}
...</pre>
      <ul>
        <li><b>step / time_sec</b>: 스텝(시점) / 초 환산(step×Δ)</li>
        <li><b>node_id</b>: 노드(또는 물리 그룹) 식별자</li>
        <li><b>count</b>: 그 스텝 인원수(= 혼잡도, 예측 타깃)</li>
        <li><b>density</b>: 밀도(명/㎡) = count ÷ 면적</li>
        <li><b>inflow / outflow</b>: 그 구간 유입·유출 인원</li>
        <li><b>p_stay</b>: 그 스텝 체류확률(동적이면 변동)</li>
      </ul>

      <h4><Code>departures.csv</Code> — 시스템 밖 유출</h4>
      <p>출입구별 퇴장, 승강장별 열차 탑승의 <b>누적/증분</b> 인원. 흐름 균형(무한 누적 방지) 확인용.</p>

      <h4><Code>nodes.csv</Code> / <Code>edges.csv</Code> — 그래프 구조</h4>
      <ul>
        <li><b>nodes.csv</b>: node_id, name, kind, group, direction, area … (노드별 출력 시 group·direction 열로 물리 그룹·방향을 확인)</li>
        <li><b>edges.csv</b>: src_id, dst_id, weight, distance, tau (방향성 링크 = 연결성+거리+시간)</li>
        <li><b>출력 단위</b>: ‘물리 그룹별’이면 같은 그룹의 양방향 노드가 1개로 합쳐져 행/노드 수가 줄고 adjacency도 그룹 그래프가 됩니다.</li>
      </ul>

      <h4><Code>X.npz</Code> — AI 모델 직결 텐서(가장 중요)</h4>
      <p>numpy 압축 파일. 아래 배열들을 담습니다.</p>
      <ul>
        <li><Code>X</Code> [T, N, F]: 특징 텐서 (스텝 × 노드 × 채널). 채널 예: count, density, inflow, outflow, (옵션)count_noisy</li>
        <li><Code>adjacency</Code> [N, N]: 인접행렬(그래프 구조) — 그래프 기반 AI 모델 입력</li>
        <li><Code>edge_index</Code> [2, M], <Code>edge_attr</Code> [M, 3]: 엣지 리스트 + (weight, distance, tau)</li>
        <li><Code>node_ids</Code>, <Code>node_kinds</Code>, <Code>channels</Code>, <Code>output_level</Code>: 메타데이터(출력 단위 node/group)</li>
        <li><Code>feat_mean</Code>, <Code>feat_std</Code> [N, F]: 채널별 정규화 통계(+ 하위호환 <Code>count_mean/std</Code>)</li>
        <li><Code>group_members</Code> 또는 <Code>node_direction</Code>/<Code>node_group</Code>: 그룹↔노드·방향 매핑(출력 단위에 따라)</li>
      </ul>
      <pre className="sample">
import numpy as np{"\n"}
d = np.load("group/X.npz", allow_pickle=True){"\n"}
X = d["X"]            # [T, N, F]{"\n"}
A = d["adjacency"]    # [N, N]{"\n"}
print(X.shape, A.shape)</pre>

      <h4><Code>config.json</Code> — 재현용 설정</h4>
      <p>전체 파라미터·시드. 같은 config면 같은 결과가 재현됩니다.</p>

      <div className="help-note">
        시간 해상도: 시뮬은 세밀한 Δ로 돌고, "집계 간격"으로 export를 N스텝씩 묶어 다운샘플할 수
        있습니다(혼잡도=평균, 유입·유출=합계). 예측 주기에 맞춰 조정하세요.
      </div>

      <h4>🎯 AI 모델 학습에 쓸 때(권장)</h4>
      <ul>
        <li><b>학습 단위는 ‘물리 그룹별(group/)’ 권장</b>: 양방향 2노드를 한 장소로 합쳐 신호가 풍부합니다.
          ‘노드별(node/)’은 하차·진출 노드가 대부분 0인 희소 신호라, 그래프 구조 실험용으로 적합합니다.
          node 단위로 학습하면 그런 희소 타깃엔 <b>마스킹/가중 손실</b>을 쓰세요.</li>
        <li><b>정규화는 채널별 z-score</b>로 하되 <b>학습(train) 구간에서 다시 계산</b>하세요. npz의
          <Code>feat_mean</Code>/<Code>feat_std</Code>는 전체 구간 통계라 <b>참고용</b>입니다(그대로 쓰면 미세 누수). 노드 간 인원 규모 차이가 커서 raw <Code>count</Code>를 그대로 쓰면 안 되며,
          규모에 덜 민감한 <Code>density</Code> 채널을 타깃으로 두는 것도 좋습니다.</li>
        <li><b>관측 노이즈는 Poisson 기본</b>(평균 비례). 고정 σ 가우시안은 저수요 노드 신호를 덮으므로, count 노이즈가 필요하면 Poisson을 쓰세요.</li>
        <li><b>단위 혼합 금지</b>: <Code>value_scale</Code> 메타가 <Code>node</Code> / <Code>group_member_sum</Code>로 표시됩니다. node와 group 데이터를 한 모델에 섞지 마세요.</li>
        <li><Code>edge_attr</Code>(distance/tau/weight)도 스케일이 달라, 엣지 특징으로 쓸 땐 별도 정규화하세요.</li>
      </ul>
      <div className="help-note">
        기본 예제는 <b>07:00 시작 → 08시 피크로 상승하는 아침 러시 단면</b>입니다. 하루 전체 주기가 필요하면
        시작시각·총 스텝을 늘리고, 코퍼스는 <b>시드를 여러 개</b> 바꿔 생성하세요(런마다 수요가 달라집니다).
      </div>
    </div>
  );
}

function FaqItem({ q, children }) {
  return (
    <div className="faq-item">
      <div className="faq-q">Q. {q}</div>
      <div className="faq-a">{children}</div>
    </div>
  );
}

function FaqGuide() {
  return (
    <div className="help-body">
      <p className="lead">자주 묻는 질문입니다. 더 깊은 개념은 <b>파라미터·개념</b> 탭을 참고하세요.</p>

      <FaqItem q="어디서부터 시작하나요?">
        상단 <b>📁 템플릿</b>에서 예제를 불러와 <b>▶ 생성·실행</b>만 눌러 보세요. 가장 작은 입문 예제는
        “<b>단순 통로형</b>”, 표준 구성은 “기본: 양방향 표준역”, 가장 복잡한 것은 “초대형 복합환승역”입니다.
      </FaqItem>
      <FaqItem q="왜 한 공간을 노드 2개로 나누나요?">
        링크가 단방향이라, 들어오는 흐름과 나가는 흐름을 한 노드에 섞으면 서로 상쇄돼 버립니다.
        그래서 <b>진입/진출(또는 하차/승차)</b> 2노드로 나누고 같은 <b>물리 그룹</b>으로 묶어, 혼잡도는 하나의 장소로 합산해 봅니다.
      </FaqItem>
      <FaqItem q="‘노드별’과 ‘물리 그룹별’ 출력은 뭐가 다른가요?">
        같은 시뮬 결과를 다른 해상도로 보는 것입니다. <b>노드별</b>은 방향 노드 하나하나(N개), <b>물리 그룹별</b>은
        양방향 2노드를 한 장소로 합친 그래프(G개)입니다. 전체 번들(ZIP)을 받으면 둘 다 들어 있습니다.
      </FaqItem>
      <FaqItem q="혼잡도(인원)가 계속 쌓이기만 해요 / 발산해요.">
        역사 밖으로 나가는 길이 없을 때 생깁니다. ① <b>출구</b> 출입구의 <b>퇴장 비율</b>이 0보다 큰지, ② 승강장에
        <b>승차(board) 역할 + 열차 스케줄</b>이 있는지, ③ 각 노드의 <b>출력 가중치 합이 1</b>인지 확인하세요.
        <b>용량/스필백(CTM)</b>을 켜면 상한이 생겨 발산을 막습니다.
      </FaqItem>
      <FaqItem q="혼잡도가 너무 낮아요 / 너무 높아요.">
        유입(출입구 <b>스텝당 평균</b>·열차 <b>하차 평균</b>)을 키우거나 줄이고, <b>면적</b>을 조절하세요(밀도=인원÷면적).
        승강장이 계속 가득 차면 <b>열차 용량</b>↑·<b>재차(onboard)</b>↓·<b>탑승/스텝</b>↑ 또는 <b>배차간격</b>↓로 더 많이 태우게 하세요.
      </FaqItem>
      <FaqItem q="결과가 매번 같나요? 데이터를 여러 벌 만들려면?">
        같은 <b>시드</b>+같은 설정이면 항상 동일하게 재현됩니다. 시드를 바꾸면 다른 실현(run)이 나옵니다.
        대량 코퍼스는 로컬에서 <Code>python cli.py config.json --out out --batch-seeds 0 1 2 …</Code> 로 만드세요(노드·그룹 두 단위 동시 출력).
      </FaqItem>
      <FaqItem q="노드·링크를 빠르게 여러 개 만들려면?">
        노드를 선택하고 <b>Ctrl+C → Ctrl+V</b>(또는 툴바 “복사”/“붙여넣기”)로 복제하세요. 빈 곳을 드래그하면 여러 노드를 한꺼번에 선택해
        그 사이 링크까지 함께 복사됩니다. 또는 <b>양방향 쌍 추가</b>로 2노드를 한 번에 만듭니다.
      </FaqItem>
      <FaqItem q="만든 역사를 저장/공유하려면?">
        상단 <b>💾 저장</b>으로 config JSON을 내려받고, <b>📂 불러오기</b>로 다시 엽니다. 작업 내용은 브라우저에 <b>자동 저장</b>되어 새로고침해도 유지됩니다.
        <b>📁 템플릿</b>의 “현재 설정을 템플릿으로 저장”도 쓸 수 있습니다.
      </FaqItem>
      <FaqItem q="시뮬이 느리거나 버벅여요.">
        노드 수가 많거나(예: 초대형 역) 총 스텝이 크면 느려질 수 있습니다. <b>배속</b>을 높이거나, 화면 관찰 없이 결과만 필요하면
        바로 <b>내보내기</b>(끝까지 실행 후 저장)를 누르세요. 대규모는 로컬 <Code>cli.py</Code>가 가장 빠릅니다.
      </FaqItem>
      <FaqItem q="생성한 데이터를 AI 모델에 어떻게 넣나요?">
        <Code>X.npz</Code>의 <Code>X[T,N,F]</Code>(특징)와 <Code>adjacency[N,N]</Code>(그래프)를 그대로 입력으로 쓰면 됩니다.
        대량 데이터셋이 필요하면 “데이터셋 내보내기”의 <b>대량 생성</b>으로 여러 시드를 한 번에 받으세요.
        저장소 <Code>ml/</Code>에 참조 예시 모델(STGCN) 학습·평가 스크립트(로컬 PyTorch)가 있습니다.
      </FaqItem>
    </div>
  );
}

const TABS = [
  { key: "usage", label: "📖 사용법", render: () => <UsageGuide /> },
  { key: "concept", label: "🧠 파라미터·개념", render: () => <ConceptGuide /> },
  { key: "output", label: "📄 출력 파일 설명", render: () => <OutputGuide /> },
  { key: "faq", label: "❓ FAQ", render: () => <FaqGuide /> },
];

export default function HelpModal({ onClose }) {
  const [tab, setTab] = useState("usage");
  useEscClose(onClose);
  const active = TABS.find((t) => t.key === tab) || TABS[0];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="사용법 및 출력 파일 설명" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-tabs">
            {TABS.map((t) => (
              <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>{t.label}</button>
            ))}
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-content">{active.render()}</div>
      </div>
    </div>
  );
}
