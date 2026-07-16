import { useState } from 'react';
import type { WorkflowDefinition } from '../../../src/types.ts';
import type { DefinitionSummary } from '../api.ts';
import { fetchDefinition, listDefinitions } from '../api.ts';

interface OpenWorkflowProps {
  onLoad: (def: WorkflowDefinition) => void;
}

function OpenWorkflow({ onLoad }: OpenWorkflowProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<DefinitionSummary[] | null>(null);

  async function toggle() {
    if (!open) {
      setItems(null);
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

  return (
    <div className="open-workflow">
      <button onClick={toggle}>Open</button>
      {open && (
        <div className="open-dropdown">
          {items === null && <p className="hint">Loading…</p>}
          {items?.length === 0 && <p className="hint">No saved workflows yet</p>}
          {items?.map((item) => (
            <button key={item.id} className="open-dropdown-item" onClick={() => handleSelect(item.id)}>
              {item.name}
              <span className="open-dropdown-id">{item.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default OpenWorkflow;
