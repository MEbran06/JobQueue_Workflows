import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { CanvasNode } from '../workflow.ts';
import { TYPE_META } from '../constants.ts';

interface CodeEditorModalProps {
  value: string;
  otherNodes: CanvasNode[];
  onChange: (value: string) => void;
  onClose: () => void;
}

function CodeEditorModal({ value, otherNodes, onChange, onClose }: CodeEditorModalProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function insertVariable(id: string) {
    const snippet = `context["${id}"]`;
    const el = textareaRef.current;
    if (!el) {
      onChange(value + snippet);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    onChange(value.slice(0, start) + snippet + value.slice(end));
    const cursor = start + snippet.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }

  return createPortal(
    <div className="code-modal-overlay" onClick={onClose}>
      <div className="code-modal" onClick={(e) => e.stopPropagation()}>
        <div className="code-modal-header">
          <div className="code-modal-dots">
            <span />
            <span />
            <span />
          </div>
          <span className="code-modal-title">Edit Code</span>
          <button className="code-modal-close" onClick={onClose} title="Close">
            ×
          </button>
        </div>
        <div className="code-modal-body">
          <textarea
            ref={textareaRef}
            className="code-modal-textarea"
            value={value}
            spellCheck={false}
            autoFocus
            onChange={(e) => onChange(e.target.value)}
          />
          <div className="code-modal-vars">
            <h3>Context Variables</h3>
            <p className="code-modal-vars-hint">Click to insert</p>
            {otherNodes.length === 0 ? (
              <p className="hint" style={{ padding: '1rem 0' }}>
                No other steps yet
              </p>
            ) : (
              otherNodes.map((n) => {
                const meta = TYPE_META[n.type];
                return (
                  <button key={n.id} className="code-modal-var" onClick={() => insertVariable(n.id)}>
                    <span style={{ color: meta.color }}>{meta.icon}</span>
                    {n.id}
                  </button>
                );
              })
            )}
          </div>
        </div>
        <div className="code-modal-footer">
          <span className="code-modal-lang">JavaScript</span>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default CodeEditorModal;
