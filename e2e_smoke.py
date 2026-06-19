"""브라우저 스모크 테스트(헤드리스): Pyodide 엔진 로드 → 시뮬 실행 → 대시보드 갱신 →
브라우저 내 데이터 export(CSV/npz 다운로드)까지 end-to-end 검증."""
import os
import sys
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:4173/"
results = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(accept_downloads=True)
    logs = []
    page.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
    page.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))
    page.goto(URL, wait_until="domcontentloaded")

    # 1) 엔진 준비(= Pyodide + numpy + 엔진 wheel)
    ready = False
    err = None
    deadline = time.time() + 180
    while time.time() < deadline:
        txt = page.locator(".status").inner_text()
        if "준비 완료" in txt:
            ready = True
            break
        if "오류" in txt:
            err = txt
            break
        page.wait_for_timeout(1000)
    if not ready:
        print("FAIL(engine ready):", err)
        print("\n".join(logs[-40:]))
        browser.close()
        sys.exit(1)
    results.append("엔진 로드(Pyodide+numpy+wheel)")

    # 2) 생성·실행 → 대시보드 진행 확인 (버튼 클래스로 특정)
    page.click("button.btn-run")
    page.wait_for_timeout(6000)
    stats = page.locator(".stat-val").all_inner_texts()
    advanced = bool(stats) and stats and stats[0] != "-" and "/" in stats[0]
    if not advanced:
        print("FAIL(simulation):", stats)
        print("--- console logs ---")
        print("\n".join(logs[-30:]))
        page.screenshot(path="e2e_fail.png", full_page=True)
        browser.close()
        sys.exit(2)
    results.append(f"시뮬 진행·대시보드({stats[0]})")
    page.click("text=정지")
    page.wait_for_timeout(500)

    # 3) 데이터 export(CSV) 다운로드 — 브라우저 내 create→runAll→export→Blob
    try:
        with page.expect_download(timeout=120000) as dl:
            page.click("text=혼잡도 시계열")
        d = dl.value
        size = os.path.getsize(d.path())
        results.append(f"CSV 다운로드({d.suggested_filename}, {size}B)")
        if size < 100:
            raise RuntimeError("CSV too small")
    except Exception as e:
        print("FAIL(csv export):", e)
        print("\n".join(logs[-20:]))
        browser.close()
        sys.exit(3)

    # 4) X.npz 다운로드
    try:
        with page.expect_download(timeout=120000) as dl2:
            page.click("text=X.npz")
        d2 = dl2.value
        size2 = os.path.getsize(d2.path())
        results.append(f"npz 다운로드({d2.suggested_filename}, {size2}B)")
        if size2 < 200:
            raise RuntimeError("npz too small")
    except Exception as e:
        print("FAIL(npz export):", e)
        print("\n".join(logs[-20:]))
        browser.close()
        sys.exit(4)

    # 5) 새 UI 요소 검증 (도움말 모달 / 링크 연결 / 차트 컨트롤 / ⓘ 툴팁)
    try:
        page.click("button:has-text('사용법')")
        page.wait_for_timeout(400)
        modal_text = page.locator(".modal").inner_text()
        help_ok = ("출력 파일" in modal_text) and ("사용법" in modal_text)
        # 출력 설명 탭 전환
        page.click("button:has-text('출력 파일 설명')")
        page.wait_for_timeout(200)
        out_ok = "timeseries.csv" in page.locator(".modal").inner_text()
        page.locator(".modal-close").click()
        page.wait_for_timeout(200)
        results.append(f"도움말 모달(사용법={help_ok}, 출력설명={out_ok})")
        if not (help_ok and out_ok):
            raise RuntimeError("help modal content missing")

        link_btn = page.locator("button:has-text('링크 연결')").count() > 0
        chart_ctrl = page.locator("button:has-text('밀도(명/㎡)')").count() > 0
        infotip = page.locator(".infotip-btn").count()
        results.append(f"링크버튼={link_btn}, 차트컨트롤={chart_ctrl}, ⓘ개수={infotip}")
        if not (link_btn and chart_ctrl and infotip > 0):
            raise RuntimeError("new UI elements missing")

        # 2차 수정: 템플릿 모달 / 랜덤 시드 / ⓘ 포털 팝오버
        page.click("button:has-text('템플릿')")
        page.wait_for_timeout(400)
        tpl_ok = "내장 예제" in page.locator(".modal").inner_text()
        page.locator(".modal-close").click()
        page.wait_for_timeout(200)
        dice_ok = page.locator("button:has-text('랜덤 시드')").count() > 0
        # dispatch_event: Playwright 자동 스크롤(→ InfoTip scroll-close)을 피해 안정적으로 토글
        page.locator(".infotip-btn").first.dispatch_event("click")
        page.wait_for_timeout(200)
        pop_ok = page.locator(".infotip-pop").count() > 0  # body 포털에 렌더(안 잘림)
        results.append(f"템플릿모달={tpl_ok}, 랜덤시드={dice_ok}, ⓘ포털={pop_ok}")
        if not (tpl_ok and dice_ok and pop_ok):
            raise RuntimeError("2nd-revision UI elements missing")
    except Exception as e:
        print("FAIL(new UI):", e)
        print("\n".join(logs[-15:]))
        browser.close()
        sys.exit(5)

    page.screenshot(path="e2e_ok.png", full_page=True)
    browser.close()

print("ALL PASS:")
for r in results:
    print("  ✓", r)
