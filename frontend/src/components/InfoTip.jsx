import { useEffect, useRef, useState } from "react";
import { PARAM_INFO } from "../paramInfo";

// 파라미터 옆 ⓘ 아이콘. 클릭하면 간단한 설명 팝오버를 보여준다.
export default function InfoTip({ k, text }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const body = text || PARAM_INFO[k] || "설명이 없습니다.";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="infotip" ref={ref}>
      <button
        type="button"
        className="infotip-btn"
        aria-label="설명 보기"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        i
      </button>
      {open && <span className="infotip-box" role="tooltip">{body}</span>}
    </span>
  );
}
