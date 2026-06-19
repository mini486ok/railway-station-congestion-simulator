import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PARAM_INFO } from "../paramInfo";

// 파라미터 옆 ⓘ. 클릭 시 설명 팝오버를 화면 최상단(portal, position:fixed)에 띄워
// 어떤 스크롤/overflow 컨테이너에도 가려지지 않게 한다.
export default function InfoTip({ k, text }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const body = text || PARAM_INFO[k] || "설명이 없습니다.";

  const toggle = (e) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const W = 250;
      let left = r.left;
      if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8; // 우측 경계 보정
      setPos({ top: r.bottom + 6, left: Math.max(8, left) });
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (btnRef.current && btnRef.current.contains(e.target)) return; // 버튼 클릭은 토글이 처리
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", () => setOpen(false), true);
    window.addEventListener("resize", () => setOpen(false));
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="infotip">
      <button
        ref={btnRef}
        type="button"
        className="infotip-btn"
        aria-label="설명 보기"
        aria-expanded={open}
        onClick={toggle}
      >
        i
      </button>
      {open &&
        createPortal(
          <span className="infotip-pop" role="tooltip" style={{ top: pos.top, left: pos.left }}
            onMouseDown={(e) => e.stopPropagation()}>
            {body}
          </span>,
          document.body
        )}
    </span>
  );
}
