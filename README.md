# 철도역사 혼잡도 합성데이터 생성 시뮬레이터

철도역사 내부 주요 지점(노드)과 연결성(링크)으로 구성된 그래프 위에서, 보행 특성·물리
사실을 반영한 **이산 시간 시뮬레이션**으로 노드별 혼잡도(존재 인원수) 시계열을 생성한다.
생성 데이터는 **STGCN 등 GNN 기반 혼잡도 예측 모델**의 학습/평가/테스트에 바로 사용할 수
있다. 최종적으로 **GitHub Pages 정적 웹앱**(브라우저 Pyodide로 Python 엔진 실행)으로 배포한다.

전체 설계는 [개발 계획 문서](../../Users/SMYU/.claude/plans/resilient-floating-mitten.md)
참조(엔진 수학 모델·아키텍처·배포·STGCN 형식 등).

---

## 진행 현황

- [x] **Phase 1 — 엔진 코어 (완료·검증)**: 보존 정합식, in-transit 링버퍼(소요시간 지연),
      유출 sink(출입구 퇴장·승강장 탑승), 동적 체류확률(Weidmann), 자체발생/열차 스케줄,
      CSV/npz export, CLI.
- [x] **Phase 2 (일부) — 용량/스필백 CTM (완료·검증)**: 노드 밀도를 `ρ_cap`으로 엄격히 제한,
      수신 여유용량 기반 상류 유출 비례 제한 → **혼잡 상류 역전파(backpressure)**, 초과 인원은
      노드 입구 대기큐에 보존. `dynamics.capacity_enabled`로 on/off.
- [x] **Phase 3 — Pyodide 브리지 + Web Worker (완료·검증)**: `engine/bridge.py` + 브라우저
      Web Worker 에서 Pyodide 로 엔진 실행. 브라우저 스모크 테스트 통과(엔진 로드→시뮬→export).
- [x] **Phase 4 — 프론트엔드 (완료·검증)**: React Flow 그래프 에디터(노드/링크 작도·속성·검증) +
      자체발생/열차 스케줄 UI + 시뮬 컨트롤(배속/일시정지) + 실시간 대시보드(차트+히트맵) + export.
- [x] **Phase 5 — GitHub Pages 배포 (구성 완료)**: `.github/workflows/deploy-pages.yml`
      (엔진 wheel 빌드 → Vite 빌드 → Pages 배포). 완전 클라이언트 사이드(서버 0대).
- [x] **Phase 6 — 참조 STGCN 베이스라인 (완료·검증)**: `ml/`(dataset 로더 + STGCN + 학습/평가).
      생성 X.npz 로 학습→평가 end-to-end 동작 확인(데이터 형식·유효성 검증, persistence 대비 비교).
- [ ] Phase 2 (잔여, 선택) — 게이트 throughput 전용 모델 등

> **검증 근거 (용량/스필백 효과)**: 용량 제약이 없으면 강한 러시 수요에서 동적 체류확률 양의
> 되먹임으로 밀도가 비현실적으로 발산(예: 게이트 50~97명/㎡). CTM 용량 모드를 켜면 밀도가
> ρ_cap=5명/㎡로 **엄격히 제한**되고 혼잡이 상류로 역전파되며 초과 인원은 입구 대기큐에 보존
> (보존오차 ~1e-11). 단위테스트 15종 통과(보존/지연/불변식/재현성/흐름균형/유출/용량).

---

## 설치 & 실행 (로컬)

```bash
pip install -r requirements.txt          # numpy, pytest

# 단일 시뮬레이션 실행 + 데이터셋 export
python cli.py examples/sample_station.json --out out/run1

# 배치(코퍼스) 생성 — 여러 시드
python cli.py examples/sample_station.json --out out/corpus --batch-seeds 0 1 2 3 4

# 테스트
python -m pytest -q
```

## 웹앱 (브라우저) — 빌드·실행·배포

핵심 Python 엔진을 **Pyodide(WASM)** 로 브라우저에서 그대로 실행한다(서버 불필요). 그래프
에디터로 역사를 작도하고, 실시간 대시보드로 관찰하며, CSV/npz 를 다운로드한다.

```bash
# 1) 엔진 wheel 빌드 후 프론트엔드 public 에 배치
python -m pip wheel . --no-deps -w dist
cp dist/station_congestion_simulator-*.whl frontend/public/

# 2) 프론트엔드 의존성 설치 & 개발 서버
cd frontend
npm install
npm run dev        # http://localhost:5173

# 3) 정적 빌드 / 미리보기
npm run build
npm run preview    # http://localhost:4173
```

**GitHub Pages 배포**: `main` 푸시 시 `.github/workflows/deploy-pages.yml` 가 엔진 wheel →
Vite 빌드 → Pages 배포를 자동 수행한다. 저장소 Settings → Pages → Source 를 **GitHub Actions**
로 설정하면 된다. `base: './'` 라 어떤 `/<repo>/` 경로에서도 동작한다.

> 브라우저 스모크 테스트: `python e2e_smoke.py`(Playwright, 미리보기 서버 필요) — Pyodide
> 엔진 로드 → 시뮬 실행 → CSV/npz 다운로드까지 end-to-end 검증.

## 출력 데이터셋 (STGCN 직결)

| 파일 | 내용 |
|---|---|
| `X.npz` | `X[T,N,F]` + `adjacency[N,N]` + `edge_index[2,M]` + `edge_attr[M,3]`(weight,distance,tau) + `feat_mean/std[N,F]` + `output_level`·그룹↔노드 매핑 메타 |
| `nodes.csv` | 노드 메타(id, name, kind, group, direction, area) |
| `edges.csv` | 그래프 구조(src, dst, weight, distance, tau) |
| `timeseries.csv` | long 포맷 시계열(count/density/inflow/outflow/p_stay) |
| `departures.csv` | 출입구 퇴장·승강장 탑승 유출량(누적/증분) |
| `config.json` | 전체 파라미터·시드(재현용) |

- **출력 단위**: `export.output_level`(`group`/`node`). `group`이면 같은 물리 그룹의 양방향 노드를 하나로 합산해
  N(=노드)이 G(=그룹)로 줄고 adjacency도 그룹 그래프가 된다. `node`면 모든 노드를 그대로 출력한다.
- **시간 해상도**: 시뮬 Δ(세밀)와 export 간격을 분리. `export.aggregate_steps`로 N스텝 집계
  다운샘플(혼잡도=평균/스냅샷, 유입·유출=합계).
- **관측 노이즈(선택)**: `export.noise_enabled` 시 `count_noisy` 채널 추가(가우시안/포아송).

## 참조 STGCN 베이스라인 (로컬, PyTorch)

생성 데이터셋(X.npz)으로 STGCN 을 학습·평가해 데이터 형식·유효성을 end-to-end 검증한다
(데모 목적; SOTA 아님). 브라우저가 아닌 **로컬**에서 실행한다.

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu   # CPU 전용

# 데이터 생성(예: 더 긴 시뮬) 후 학습
python cli.py examples/sample_station.json --out out/run1
python ml/train.py --data out/run1/X.npz --epochs 30 --P 12 --Q 3
```

`ml/dataset.py`(X.npz→슬라이딩 윈도우·정규화·분할), `ml/stgcn.py`(시간 게이트 conv + 그래프 conv),
`ml/train.py`(학습 + MAE/RMSE/MAPE 평가 + persistence 베이스라인 비교).

## 검증·고도화 (전문가 4관점 × 2회 리뷰 반영)

서로 다른 관점의 에이전트 4종(외부 LLM 코드리뷰 = Codex, 시뮬레이션 현실성, UI/UX, 코드 품질)이
2회에 걸쳐 비판적 리뷰를 수행했고, 타당하고 위험이 낮은 항목을 선별 반영했다.

**반영됨(요지)**
- 정확성/견고성: 전수 수치·NaN/Inf·범위 검증, null 입력 안전 파싱, 음수 가중치/거리 거부,
  상태량 sum 집계 금지, over-aggregate 시간축 보호, 용량 초기 클립 인원 보존, 정차창 겹침 다중 탑승,
  정수 탑승 정원 준수, CSV 인젝션·시간축 정렬, 거대 tau OOM 방어, bridge 검증 강제, 워커 준비 가드.
- 현실성/데이터 가치: **수요 다양성**(전역 공통요인 z_t로 공간상관 + 일간변동 + 열차지연),
  **게이트 throughput 상한**, **열차 onboard_load(가용좌석)**, **탑승 유출을 outflow 채널에 일관 기록**.
- RNG 스트림 용도별 분리(코퍼스 재현성/CRN), CI pytest 게이트.
- STGCN: **다중 run 시나리오 홀드아웃 로더**, **하루 시각 sin/cos 외생특징**, **forward+backward 인접행렬**
  → 단일 run에서 STGCN MAE가 단순지속 대비 개선(역전).
- UI/UX: 온보딩, 엔진 로딩 피드백, 모달 ESC·스크롤잠금·포커스복귀, Delete 키 삭제, 밀도 컬러바,
  차트 ρ_cap 임계선·시각축·노드별 안정색, 고급설정 접이, 실행 중 편집 잠금, 빈 상태 안내, aria/대비/반응형.

## 알려진 한계 / 향후 과제 (리뷰에서 고가치로 지적되었으나 대규모·고위험이라 보류)

- **OD/방향 분리(2-commodity)**: 노드-점유 Markov는 목적지를 추적하지 않아, 한 노드에서 '탑승하러
  가는 흐름'과 '하차해 나가는 흐름'이 섞인다(승강장에서 하차객 일부가 재탑승될 수 있음). 현재는
  진입/진출 경로를 분리한 단방향 토폴로지로 완화. 근본 해결은 점유를 색(commodity)별로 쪼개는 것.
- **혼잡의 링크 지연 전파(동적 τ)**: 현재 혼잡은 체류확률·수신용량에만 반영되고 링크 통과시간 τ는
  자유속력 고정이라, 정체의 "느려짐"이 링크로 전파되지 않는다. 링크별 밀도 기반 τ_eff + 링버퍼 재산정 필요.
- **CTM 스필백 정교화**: 합류부 우선순위 배분(Daganzo merge), 동기갱신 진동 억제, in-transit 임박분만
  수용용량에서 차감(과도 차단 완화). 현재도 인원 보존은 정확하나 동역학이 거칠다.
- **STGCN 아키텍처**: 시간축 평균풀링 대신 causal TCN/attention head, edge_attr(거리/지연) 활용,
  대규모 그래프 성능 최적화(증분 intransit 합) 등.

> 위 항목은 모두 합리적이나 검증된 엔진·앱의 안정성을 해치지 않도록 별도 작업으로 분리했다.

## 데이터 채널 주의(시간축 계약)

- `outflow[t]`: t-1→t 전이의 유출(링크 유출 + 승강장 탑승)을 t 에 기록. `inflow[t]`: t 시점 도착.
  `count[t] = count[t-1] − outflow[t] + inflow[t]` 가 노드별로 정합한다.
- `departures.csv` 의 `*_cum` 은 누적(워밍업 포함), `*_delta` 는 워밍업 이후 구간 증분. timeseries 와
  동일한 step/집계 시간축을 사용해 조인 가능하다.

## 주요 사용 기능 (사용자 요청 보완)

- **예제 템플릿**: 상단 "📁 템플릿" 에서 내장 예제(양방향 표준역 / 단순 통로형 / 엘리베이터 환승 /
  2개 승강장 분기 / **환승역(2개 노선)** / **심층 역사(병렬 수직동선)**)를 불러오거나,
  **현재 구성을 내 템플릿으로 저장·불러오기·삭제**(브라우저 localStorage). 모든 내장 예제는 양방향 2노드·물리 그룹 구조.
- **양방향 2노드 모델링 + 물리 그룹**: 출입구·통로·게이트·계단·에스컬레이터·엘리베이터·승강장 등 **모든 물리 공간**을
  서로 다른 방향의 **2노드**(입구/출구, 진입/진출, 상행/하행, 하차/승차 등)로 만들어 진입·진출 흐름이 섞이지 않게 하고,
  두 노드를 같은 **"물리 그룹"** 으로 묶는다. 그래프 툴바의 **"양방향 쌍"** 추가 모드가 이 쌍을 한 번에 생성한다.
  노드 속성의 **"방향"** 필드는 그래프·CSV 메타로만 쓰이고 동역학엔 영향이 없다.
- **분석·출력 단위(노드별 / 물리 그룹별)**: 혼잡도를 **물리 그룹별**(같은 그룹의 양방향 노드를 하나의 장소로 합산)
  또는 **노드별**(각 노드 그대로)로 분석·출력할 수 있다(`export.output_level`). 대시보드 차트·그래프 히트맵·
  timeseries/nodes/edges CSV·X.npz(텐서·adjacency 노드 수) 모두 같은 단위로 적용된다. 노드별 nodes.csv 에는
  `group`·`direction` 열이 포함되어 사후 재집계도 가능하다. 기본 예제는 10노드 → 5개 물리 장소(출입구/대합실/게이트/계단/승강장1)로 집계된다.
- **승강장 승차/하차 분리**: 승강장은 물리적으로 하나지만 흐름이 반대인 **하차(열차→역사 유입)** 와
  **승차(역사→열차 유출)** 를 각각 노드로 만들고 같은 **물리 그룹** 으로 묶을 수 있다. 노드 속성의
  **"승강장 역할"**(둘 다/하차/승차)로 지정 — 하차 노드는 열차 도착 시 인원이 유입되고, 승차 노드는
  정차 동안 대기객이 열차로 탑승(유출)한다. 혼잡도는 그룹 단위로 합산된다.
- **열차 스케줄(첫 도착 + 배차간격)**: 열차를 일일이 입력하는 대신 **첫 도착 시점·배차간격(headway)·
  운행 대수(0=시뮬 끝까지)** 로 정의한다. 모든 열차가 동일한 하차/탑승 파라미터를 공유한다.
- **유입 분포 선택**: 출입구·하차 유입을 **푸아송 / 정규 / 음이항(과분산·군집) / 균등 / 로그정규(버스트) /
  상수** 중에서 선택·설정한다(평균 + 표준편차/반치폭). 음이항은 분산>평균의 현실적 도착 변동,
  로그정규는 우편향 버스트를 모사한다.
- **엘리베이터**: 노드 종류를 엘리베이터로 하면 **운행 주기(슬롯)·수송 용량(명)** 으로 동작 —
  주기 슬롯 동안 머문 뒤 주기마다 용량만큼 한 번에 하류로 배치 유출(연속 흐름과 다른 거동).
- **난수 시드 + 🎲 랜덤**: 같은 구조라도 시드를 바꾸면 결과가 달라진다. 시뮬 패널에 시드 입력과
  "랜덤 시드" 버튼을 두어 손쉽게 다양화. (구조 외 다양성은 `demand`(공통요인·일간변동·열차지연)로도 확장 가능)
- **파라미터 설명(ⓘ)**: 모든 입력 옆 ⓘ 클릭 시 설명 팝오버가 **화면 최상단(portal)** 에 떠 가려지지 않음.

## 핵심 모델 (요약)

- 인원 갱신(보존 정합식): `N_i(t+1) = N_i(t)·P_stay_i + 도착(arr)`. 유출은 한 번만 빠지고
  하류/sink로 한 번만 들어가 **인원 보존**(`ΣN + in-transit + Σsink = 초기 + 누적생성`).
- 유출(필수): 출입구→OUTSIDE(가중치 기반), 승강장→TRAIN(열차 정차창 우선 탑승). → 무한 누적 방지.
- 동적 체류확률: Weidmann 밀도-속력 기본도로 혼잡 시 보행속력↓→체류↑ 반영(LPF 안정화).
- 자체발생: 출입구(Poisson/Normal/음이항/균등/로그정규/Constant + 러시아워 프로파일),
  승강장(열차 하차 버스트). 승강장 역할(하차/승차/둘다)·열차 스케줄(첫 도착+배차간격)로 분리 모델링 가능.

## 디렉터리

```
engine/      순수 Python+numpy 엔진(Pyodide·네이티브 공용)
  config.py  설정 dataclass + JSON 직렬화/검증
  model.py   설정 -> SoA(numpy), sink 합성, 가중치 정규화, tau 자동계산
  dynamics.py Weidmann 기본도 -> 동적 체류확률
  generators.py 자체발생 분포 + 시간대 프로파일 + 열차 하차
  simulator.py 이산시간 메인 루프(보존 정합식 + 유출 sink)
  rounding.py  정수 모드(multinomial 보존 분배)
  recorder.py  적재 + CSV/npz export(집계·노이즈)
  validate.py  불변식·보존 모니터
  bridge.py    Pyodide↔JS 경계(브라우저용, 네이티브 공용)
cli.py       단독/배치 실행 진입점
frontend/    React+Vite 웹앱(React Flow 에디터·대시보드 + Pyodide Web Worker)
ml/          참조 STGCN(dataset/stgcn/train) — 로컬 PyTorch
examples/    예제 역사 config
tests/       단위테스트(보존/지연/불변식/재현성/흐름균형/유출/용량/bridge)
.github/workflows/deploy-pages.yml   GitHub Pages 자동 배포
e2e_smoke.py 브라우저 end-to-end 스모크 테스트(Playwright)
```
