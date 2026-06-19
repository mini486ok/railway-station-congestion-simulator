import { useEffect } from "react";

// 모달 접근성: ESC 닫기 + body 스크롤 잠금 + 닫힐 때 직전 포커스 복귀
export function useEscClose(onClose) {
  useEffect(() => {
    const prevActive = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      if (prevActive && typeof prevActive.focus === "function") prevActive.focus();
    };
  }, [onClose]);
}
