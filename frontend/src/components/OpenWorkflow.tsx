import { useState } from 'react';
import type { WorkflowDefinition } from '../../../src/types.ts';
import type { DefinitionSummary } from '../api.ts';
import { deleteDefinition, fetchDefinition, listDefinitions } from '../api.ts';

interface OpenWorkflowProps {
  onLoad: (def: WorkflowDefinition) => void;
  onDeleted: (id: string) => void;
}

function OpenWorkflow({ onLoad, onDeleted }: OpenWorkflowProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<DefinitionSummary[] | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function toggle() {
    if (!open) {
      setItems(null);
      setConfirmingId(null);
      const list = await listDefinitions();
      setItems(list);
    }
    setOpen((o) => !o);
  }

  async function handleSelect(id: string) {
    const def = await fetchDefinition(id);
    onLoad(def);
    setOpen(false);
  }

  async function handleDelete(id: string) {
    await deleteDefinition(id);
    setItems((prev) => (prev ? prev.filter((item) => item.id !== id) : prev));
    setConfirmingId(null);
    onDeleted(id);
  }

  return (
    <div className="open-workflow">
      <button onClick={toggle}>Open</button>
      {open && (
        <div className="open-dropdown">
          {items === null && <p className="hint">Loading…</p>}
          {items?.length === 0 && <p className="hint">No saved workflows yet</p>}
          {items?.map((item) =>
            confirmingId === item.id ? (
              <div key={item.id} className="open-dropdown-row open-dropdown-confirm">
                <span className="open-dropdown-confirm-text">Delete "{item.name}"?</span>
                <button className="open-dropdown-confirm-yes" onClick={() => handleDelete(item.id)}>
                  Yes
                </button>
                <button className="open-dropdown-confirm-cancel" onClick={() => setConfirmingId(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <div key={item.id} className="open-dropdown-row">
                <button className="open-dropdown-item" onClick={() => handleSelect(item.id)}>
                  {item.name}
                  <span className="open-dropdown-id">{item.id}</span>
                </button>
                <button
                  className="open-dropdown-delete"
                  title={`Delete ${item.name}`}
                  onClick={() => setConfirmingId(item.id)}
                >
                  🗑
                </button>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

export default OpenWorkflow;
