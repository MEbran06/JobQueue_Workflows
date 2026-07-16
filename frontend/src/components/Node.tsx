import { memo } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { CanvasNode } from '../workflow.ts';
import { useWorkflow } from '../store.tsx';
import { TYPE_META } from '../constants.ts';

interface NodeProps {
  node: CanvasNode;
  onStartDrag: (node: CanvasNode, e: ReactMouseEvent) => void;
  onStartConnect: (nodeId: string, e: ReactMouseEvent) => void;
}

function Node({ node, onStartDrag, onStartConnect }: NodeProps) {
  const { state, dispatch } = useWorkflow();
  const meta = TYPE_META[node.type];
  const isSelected = state.selected === node.id;
  const isConnectable = state.connectingFrom !== null && state.connectingFrom !== node.id;

  return (
    <div
      id={`node-${node.id}`}
      className={`node${isSelected ? ' selected' : ''}${isConnectable ? ' connectable' : ''}`}
      style={{ left: node.x, top: node.y, borderColor: meta.color }}
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('del') || target.classList.contains('port-out')) return;
        dispatch({ kind: 'SELECT_NODE', id: node.id });
        onStartDrag(node, e);
      }}
    >
      <div className="node-top" style={{ background: meta.bg }}>
        <span style={{ color: meta.color }}>
          {meta.icon} {node.id}
        </span>
        <button
          className="del"
          onClick={(e) => {
            e.stopPropagation();
            dispatch({ kind: 'DELETE_NODE', id: node.id });
          }}
        >
          ×
        </button>
      </div>
      <div className="node-label">{meta.label}</div>
      <div className="port-in"></div>
      <div
        className="port-out"
        onMouseDown={(e) => {
          e.stopPropagation();
          onStartConnect(node.id, e);
        }}
      ></div>
    </div>
  );
}

export default memo(Node);
