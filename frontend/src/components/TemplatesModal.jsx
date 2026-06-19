import { useState } from "react";
import { useStore } from "../store";
import { BUILTIN_TEMPLATES, loadUserTemplates, saveUserTemplate, deleteUserTemplate } from "../templates";
import { useEscClose } from "./useModal";

const clone = (o) => JSON.parse(JSON.stringify(o));

export default function TemplatesModal({ onClose }) {
  const config = useStore((s) => s.config);
  const replaceConfig = useStore((s) => s.replaceConfig);
  const [userT, setUserT] = useState(loadUserTemplates());
  const [name, setName] = useState("");
  useEscClose(onClose);

  const load = (cfg) => {
    replaceConfig(clone(cfg));
    onClose();
  };
  const save = () => {
    const nm = name.trim();
    if (!nm) return;
    saveUserTemplate(nm, clone(config));
    setUserT(loadUserTemplates());
    setName("");
  };
  const del = (nm) => {
    deleteUserTemplate(nm);
    setUserT(loadUserTemplates());
  };

  const userNames = Object.keys(userT);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="템플릿 불러오기 및 저장" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>📁 템플릿 — 불러오기 / 저장</strong>
          <button className="modal-close" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="modal-content">
          <h4 className="tpl-h">내장 예제</h4>
          <div className="tpl-list">
            {BUILTIN_TEMPLATES.map((t) => (
              <div key={t.id} className="tpl-item">
                <div className="tpl-info">
                  <div className="tpl-name">{t.name}</div>
                  <div className="tpl-desc">{t.description}</div>
                </div>
                <button className="primary" onClick={() => load(t.make())}>불러오기</button>
              </div>
            ))}
          </div>

          <h4 className="tpl-h">내 템플릿 (이 브라우저에 저장)</h4>
          <div className="tpl-save">
            <input placeholder="현재 노드/링크 구성을 저장할 이름" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="primary" onClick={save} disabled={!name.trim()}>현재 구성 저장</button>
          </div>
          {userNames.length === 0 ? (
            <div className="hint">저장된 템플릿이 없습니다. 위에 이름을 입력하고 저장하세요.</div>
          ) : (
            <div className="tpl-list">
              {userNames.map((nm) => (
                <div key={nm} className="tpl-item">
                  <div className="tpl-name">{nm}</div>
                  <div className="tpl-actions">
                    <button onClick={() => load(userT[nm])}>불러오기</button>
                    <button className="danger" onClick={() => del(nm)}>삭제</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
