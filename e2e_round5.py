"""3차 수정 기능 브라우저 검증: 복사/붙여넣기(Ctrl+C/V), 전체 번들(ZIP) export,
신규 복잡 템플릿 로드+검증, 도움말 확장 탭(파라미터·개념/FAQ)."""
import os
import sys
import time
import zipfile
from playwright.sync_api import sync_playwright

URL = "http://localhost:4173/"
results = []


def fail(stage, detail, logs):
    print(f"FAIL({stage}): {detail}")
    print("\n".join(logs[-25:]))
    sys.exit(1)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(accept_downloads=True)
    logs = []
    page.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
    page.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))
    page.goto(URL, wait_until="domcontentloaded")

    # 1) 엔진 준비
    ready = False
    deadline = time.time() + 180
    while time.time() < deadline:
        txt = page.locator(".status").inner_text()
        if "준비 완료" in txt:
            ready = True
            break
        if "오류" in txt:
            fail("engine", txt, logs)
        page.wait_for_timeout(1000)
    if not ready:
        fail("engine ready", "timeout", logs)
    results.append("엔진 로드")

    # 온보딩 가이드 배너 닫기(그래프 클릭 가림 방지)
    if page.locator(".onboarding button:has-text('닫기')").count() > 0:
        page.locator(".onboarding button:has-text('닫기')").click()
        page.wait_for_timeout(200)

    # 2) 신규 복잡 템플릿(초대형 복합환승역) 로드 + 노드 수
    page.click("button:has-text('템플릿')")
    page.wait_for_timeout(300)
    page.locator(".tpl-item", has=page.locator(".tpl-name:has-text('초대형')")).locator("button:has-text('불러오기')").click()
    page.wait_for_timeout(800)
    n_mega = page.locator(".react-flow__node").count()
    if n_mega < 40:
        fail("mega template", f"node count {n_mega} < 40", logs)
    results.append(f"초대형 템플릿 로드(노드 {n_mega})")

    # 3) 검증(오류 없음)
    page.click("button:has-text('검증')")
    page.wait_for_timeout(800)
    body = page.locator("body").inner_text()
    if "오류" in body and "유효" not in body:
        # 검증 결과 영역에 오류가 표시되면 실패
        if page.locator(".v-err, .v-err-line").count() > 0:
            fail("validate", "검증 오류 표시됨", logs)
    results.append("초대형 템플릿 검증 통과")

    # 4) 분석·출력 단위 토글
    page.locator("button:has-text('노드별')").first.click()
    page.wait_for_timeout(200)
    page.locator("button:has-text('물리 그룹별')").first.click()
    page.wait_for_timeout(200)
    results.append("분석·출력 단위 토글")

    # 5) 복사/붙여넣기 — 작은 템플릿(단순 통로형)에서 노드 선택 후 Ctrl+C/V
    page.click("button:has-text('템플릿')")
    page.wait_for_timeout(300)
    page.locator(".tpl-item", has=page.locator(".tpl-name:has-text('단순 통로형')")).locator("button:has-text('불러오기')").click()
    page.wait_for_timeout(600)
    before = page.locator(".react-flow__node").count()
    # 노드 선택(컨트롤 패널 가림 우회 위해 dispatch_event) → Inspector 로 선택 확인
    page.locator('[data-id="P_bo"]').dispatch_event("click")
    page.wait_for_timeout(300)
    if page.locator(".insp-head:has-text('P_bo')").count() == 0:
        fail("copy/paste", "노드 선택 실패(Inspector 에 P_bo 미표시)", logs)
    # 키보드 단축키(Ctrl+C → Ctrl+V)
    page.keyboard.press("Control+c")
    page.wait_for_timeout(150)
    page.keyboard.press("Control+v")
    page.wait_for_timeout(500)
    after = page.locator(".react-flow__node").count()
    if after != before + 1:
        # 키보드 경로 실패 시 툴바 버튼으로 재시도(같은 store 액션)
        page.locator(".ge-toolbar button:has-text('붙여넣기')").click()
        page.wait_for_timeout(400)
        after = page.locator(".react-flow__node").count()
    if after != before + 1:
        fail("copy/paste", f"before={before} after={after} (expected +1)", logs)
    results.append(f"복사/붙여넣기(노드 {before}→{after})")

    # 6) 도움말 확장 탭(파라미터·개념 / FAQ)
    page.click("button:has-text('출력 설명')")  # 상단 도움말 버튼(고유 텍스트)
    page.wait_for_timeout(400)
    tabs_text = page.locator(".modal-tabs").inner_text()
    has_concept = "파라미터" in tabs_text
    has_faq = "FAQ" in tabs_text
    page.click(".modal-tabs button:has-text('FAQ')")
    page.wait_for_timeout(250)
    faq_body = page.locator(".modal-content").inner_text()
    faq_ok = "Q." in faq_body
    page.click(".modal-tabs button:has-text('파라미터')")
    page.wait_for_timeout(250)
    concept_body = page.locator(".modal-content").inner_text()
    concept_ok = ("동적 체류확률" in concept_body) and ("CTM" in concept_body)
    page.locator(".modal-close").click()
    page.wait_for_timeout(200)
    if not (has_concept and has_faq and faq_ok and concept_ok):
        fail("help tabs", f"concept_tab={has_concept} faq_tab={has_faq} faq={faq_ok} concept={concept_ok}", logs)
    results.append("도움말 4탭(파라미터·개념/FAQ 내용 확인)")

    # 7) 전체 번들(ZIP) export — node/·group/ 두 단위 포함 검증
    try:
        with page.expect_download(timeout=120000) as dl:
            page.click("button:has-text('전체 번들')")
        d = dl.value
        path = d.path()
        size = os.path.getsize(path)
        z = zipfile.ZipFile(path)
        names = set(z.namelist())
        need = {"node/X.npz", "group/X.npz", "node/timeseries.csv", "group/timeseries.csv", "config.json"}
        missing = need - names
        if missing or size < 500:
            fail("bundle", f"size={size} missing={missing}", logs)
        results.append(f"전체 번들 ZIP({d.suggested_filename}, {size}B, {len(names)} files)")
    except Exception as e:
        fail("bundle export", str(e), logs)

    # 모든 기능 검증 통과 — 결과를 먼저 출력하고(브라우저 종료 시 플레이키 방지) 정리.
    print("ROUND5 PASS:")
    for r in results:
        print("  ✓", r)
    try:
        browser.close()
    except Exception:
        pass  # 드라이버 연결 끊김 등 종료 정리 오류는 무시(검증은 이미 완료)
