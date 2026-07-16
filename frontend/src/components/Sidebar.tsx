import { useState } from 'react';
import type { FocusEvent, ReactNode } from 'react';
import { useWorkflow } from '../store.tsx';
import type { StepType } from '../constants.ts';
import ConditionBuilder from './ConditionBuilder.tsx';

const TYPE_OPTIONS: { value: StepType; label: string }[] = [
  { value: 'ai_prompt', label: '🤖 AI Prompt' },
  { value: 'http_request', label: '🌐 HTTP Request' },
  { value: 'branch', label: '⟐ Branch' },
  { value: 'set_variable', label: '=  Set Variable' },
  { value: 'code', label: '{} Code' },
  { value: 'loop', label: '↻ Loop' },
];

const hintStyle = { fontSize: '0.7rem', color: '#4b5563', marginTop: '0.5rem' };
const codeStyle = { color: '#94a3b8' };

const HINTS: Partial<Record<StepType, ReactNode>> = {
  set_variable: (
    <p style={hintStyle}>
      Use <code style={codeStyle}>{'{{stepId}}'}</code> to interpolate prior outputs.
    </p>
  ),
  code: (
    <p style={hintStyle}>
      Function receives <code style={codeStyle}>context</code> object. Must <code style={codeStyle}>return</code> a string.
    </p>
  ),
  loop: (
    <p style={hintStyle}>
      If the condition is true, jumps back to <code style={codeStyle}>loopBackTo</code>. Otherwise continues to the connected
      next step.
    </p>
  ),
};

interface ConfigRowProps {
  nodeId: string;
  configKey: string;
  value: string;
  expandable?: boolean;
}

function ConfigRow({ nodeId, configKey, value, expandable }: ConfigRowProps) {
  const { dispatch } = useWorkflow();
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="config-row">
      <input
        key={configKey}
        defaultValue={configKey}
        placeholder="key"
        onBlur={(e: FocusEvent<HTMLInputElement>) => {
          if (e.target.value && e.target.value !== configKey) {
            dispatch({ kind: 'RENAME_KEY', nodeId, oldKey: configKey, newKey: e.target.value });
          }
        }}
      />
      <textarea
        className={expanded ? 'expanded' : undefined}
        placeholder="value"
        value={value}
        onChange={(e) => dispatch({ kind: 'SET_VAL', nodeId, key: configKey, value: e.target.value })}
      />
      {expandable && (
        <button
          type="button"
          className="expand-btn"
          title={expanded ? 'Collapse' : 'Expand'}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? '⤡' : '⤢'}
        </button>
      )}
      <button onClick={() => dispatch({ kind: 'REMOVE_KEY', nodeId, key: configKey })}>×</button>
    </div>
  );
}

interface SidebarProps {
  width: number;
}

function Sidebar({ width }: SidebarProps) {
  const { state, dispatch } = useWorkflow();
  const node = state.nodes.find((n) => n.id === state.selected);

  if (!node) {
    return (
      <div id="sidebar" style={{ width }}>
        <h2>Properties</h2>
        <div id="props-content">
          <p className="hint">Click a node to edit it</p>
        </div>
      </div>
    );
  }

  const otherNodes = state.nodes.filter((n) => n.id !== node.id);

  return (
    <div id="sidebar" style={{ width }}>
      <h2>Properties</h2>
      <div id="props-content">
        <label>Step ID</label>
        <input
          key={node.id}
          defaultValue={node.id}
          onBlur={(e: FocusEvent<HTMLInputElement>) => {
            if (e.target.value !== node.id) dispatch({ kind: 'RENAME_NODE', oldId: node.id, newId: e.target.value });
          }}
        />

        <label>Type</label>
        <select
          value={node.type}
          onChange={(e) => dispatch({ kind: 'CHANGE_TYPE', id: node.id, nodeType: e.target.value as StepType })}
        >
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {node.type === 'branch' ? (
          <>
            <label>
              Branches <span style={{ color: '#64748b', fontSize: '0.65rem' }}>(top to bottom)</span>
            </label>
            {node.branches.map((branch, i) => (
              <div className="branch-row" key={i}>
                <ConditionBuilder
                  value={branch.condition}
                  otherNodes={otherNodes}
                  onChange={(value) => dispatch({ kind: 'SET_BRANCH_CONDITION', nodeId: node.id, index: i, value })}
                />
                <div className="branch-row-footer">
                  <select
                    value={branch.next}
                    onChange={(e) =>
                      dispatch({ kind: 'SET_BRANCH_NEXT', nodeId: node.id, index: i, value: e.target.value })
                    }
                  >
                    <option value="">— next —</option>
                    {otherNodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.id}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => dispatch({ kind: 'REMOVE_BRANCH', nodeId: node.id, index: i })}>×</button>
                </div>
              </div>
            ))}
            <button className="add-btn" onClick={() => dispatch({ kind: 'ADD_BRANCH', nodeId: node.id })}>
              + Add branch
            </button>
          </>
        ) : (
          <>
            <label>Config</label>
            {Object.entries(node.config).map(([k, v]) =>
              node.type === 'loop' && k === 'condition' ? (
                <div key={k}>
                  <label style={{ fontSize: '0.7rem', color: '#64748b' }}>condition</label>
                  <ConditionBuilder
                    value={v}
                    otherNodes={otherNodes}
                    onChange={(value) => dispatch({ kind: 'SET_VAL', nodeId: node.id, key: 'condition', value })}
                  />
                </div>
              ) : node.type === 'loop' && k === 'loopBackTo' ? (
                <div className="config-row" key={k}>
                  <span style={{ flex: 0.6, fontSize: '0.8rem', color: '#94a3b8' }}>loopBackTo</span>
                  <select
                    style={{ flex: 1.5 }}
                    value={v}
                    onChange={(e) =>
                      dispatch({ kind: 'SET_VAL', nodeId: node.id, key: 'loopBackTo', value: e.target.value })
                    }
                  >
                    <option value="">— jump back to —</option>
                    {otherNodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.id}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <ConfigRow
                  key={k}
                  nodeId={node.id}
                  configKey={k}
                  value={v}
                  expandable={node.type === 'code' && k === 'code'}
                />
              )
            )}
            {node.type !== 'loop' && (
              <button className="add-btn" onClick={() => dispatch({ kind: 'ADD_KEY', nodeId: node.id })}>
                + Add field
              </button>
            )}
            {HINTS[node.type]}
          </>
        )}
      </div>
    </div>
  );
}

export default Sidebar;
