import { useEffect, useRef } from "react";

// 모달 접근성: ESC 닫기 + body 스크롤 잠금 + 닫힐 때 직전 포커스 복귀.
//
// open(기본 true)이 truthy 일 때만 활성화한다. 그리고 onClose 는 ref 로 보관해
// 함수 정체성이 매 렌더 바뀌어도 effect 가 재실행되지 않게 한다.
//
// ⚠ 과거 버그: effect 의존성이 [onClose] 였고 호출부가 인라인 함수를 넘기면,
//    부모가 재렌더될 때마다 effect 가 cleanup→재실행되며 cleanup 의
//    prevActive.focus() 가 입력 중인 포커스를 직전 요소로 빼앗았다
//    (예: 속성 패널에서 다른 칸에 입력하면 커서가 첫 칸으로 튐).
//    → open 변화에만 반응하도록 의존성을 [open] 으로 고정해 해결.
export function useEscClose(onClose, open = true) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const prevActive = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") onCloseRef.current && onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      if (prevActive && typeof prevActive.focus === "function") prevActive.focus();
    };
  }, [open]);
}
