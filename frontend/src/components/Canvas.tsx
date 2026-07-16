import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { CanvasNode } from '../workflow.ts';
import { useWorkflow } from '../store.tsx';
import type { StepType } from '../constants.ts';
import { NODE_H, NODE_W } from '../constants.ts';
import Node from './Node.tsx';
import Connections from './Connections.tsx';

interface DragState {
  id: string;
  offsetX: number;
  offsetY: number;
}

interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const DEFAULT_VIEW: ViewState = { zoom: 1, panX: 0, panY: 0 };

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

function Canvas() {
  const { state, dispatch } = useWorkflow();
  const wrapRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<DragState | null>(null);
  const connectingRef = useRef<string | null>(null);
  const [connectDragPos, setConnectDragPos] = useState<{ x: number; y: number } | null>(null);
  // Live node position while dragging, kept out of the shared store so only
  // this subtree re-renders during the drag — Sidebar/JsonPreview/Header stay
  // untouched until the position is committed on drop.
  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const [view, setView] = useState<ViewState>(DEFAULT_VIEW);

  // View is transient UI state, not persisted with the workflow - reset it
  // whenever a different workflow is loaded so zoom/pan never leaks across workflows.
  useEffect(() => {
    setView(DEFAULT_VIEW);
  }, [state.workflowId]);

  useEffect(() => {
    function relativePos(e: MouseEvent) {
      const rect = wrapRef.current!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function onMouseMove(e: MouseEvent) {
      if (draggingRef.current && wrapRef.current) {
        const drag = draggingRef.current;
        const rect = wrapRef.current.getBoundingClientRect();
        const x = Math.max(10, e.clientX - rect.left - drag.offsetX);
        const y = Math.max(10, e.clientY - rect.top - drag.offsetY);
        setDragPreview({ id: drag.id, x, y });
      } else if (connectingRef.current && wrapRef.current) {
        setConnectDragPos(relativePos(e));
      }
    }

    function onMouseUp(e: MouseEvent) {
      if (draggingRef.current) {
        const drag = draggingRef.current;
        const rect = wrapRef.current!.getBoundingClientRect();
        const x = Math.max(10, e.clientX - rect.left - drag.offsetX);
        const y = Math.max(10, e.clientY - rect.top - drag.offsetY);
        dispatch({ kind: 'MOVE_NODE', id: drag.id, x, y });
        draggingRef.current = null;
        setDragPreview(null);
      }

      const fromId = connectingRef.current;
      if (fromId) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const targetEl = el?.closest('.node') as HTMLElement | null;
        const toId = targetEl?.id.replace(/^node-/, '');
        if (toId && toId !== fromId) {
          dispatch({ kind: 'CONNECT_NODES', fromId, toId });
        } else {
          dispatch({ kind: 'CANCEL_CONNECT' });
        }
        connectingRef.current = null;
        setConnectDragPos(null);
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && connectingRef.current) {
        connectingRef.current = null;
        setConnectDragPos(null);
        dispatch({ kind: 'CANCEL_CONNECT' });
      }
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [dispatch]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = wrap!.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      setView((v) => {
        const newZoom = clampZoom(v.zoom * Math.exp(-e.deltaY * 0.001));
        const newPanX = mouseX - (mouseX - v.panX) * (newZoom / v.zoom);
        const newPanY = mouseY - (mouseY - v.panY) * (newZoom / v.zoom);
        return { zoom: newZoom, panX: newPanX, panY: newPanY };
      });
    }

    wrap.addEventListener('wheel', onWheel, { passive: false });
    return () => wrap.removeEventListener('wheel', onWheel);
  }, []);

  const startDrag = useCallback((node: CanvasNode, e: ReactMouseEvent) => {
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    draggingRef.current = {
      id: node.id,
      offsetX: e.clientX - rect.left - node.x,
      offsetY: e.clientY - rect.top - node.y,
    };
  }, []);

  const startConnect = useCallback(
    (nodeId: string, e: ReactMouseEvent) => {
      if (!wrapRef.current) return;
      connectingRef.current = nodeId;
      dispatch({ kind: 'START_CONNECT', id: nodeId });
      const rect = wrapRef.current.getBoundingClientRect();
      setConnectDragPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    [dispatch]
  );

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const type = e.dataTransfer.getData('type') as StepType | '';
    if (!type || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    dispatch({
      kind: 'ADD_NODE',
      nodeType: type,
      x: e.clientX - rect.left - NODE_W / 2,
      y: e.clientY - rect.top - NODE_H / 2,
    });
  }

  // Only the node actually being dragged gets a new object reference here —
  // every other node keeps its original reference, so Node's React.memo can
  // skip re-rendering the rest of the canvas during the drag.
  const displayNodes = dragPreview
    ? state.nodes.map((n) => (n.id === dragPreview.id ? { ...n, x: dragPreview.x, y: dragPreview.y } : n))
    : state.nodes;

  const connectSource = state.connectingFrom ? state.nodes.find((n) => n.id === state.connectingFrom) : undefined;

  const layerStyle = {
    transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
    transformOrigin: '0 0',
  };

  return (
    <div
      id="canvas-wrap"
      className={state.connectingFrom ? 'connecting' : undefined}
      ref={wrapRef}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onClick={() => {
        if (state.connectingFrom) dispatch({ kind: 'CANCEL_CONNECT' });
      }}
    >
      <svg id="svg-layer" style={layerStyle}>
        <Connections nodes={displayNodes} />
        {connectSource && connectDragPos && (
          <line
            x1={connectSource.x + NODE_W}
            y1={connectSource.y + NODE_H / 2}
            x2={connectDragPos.x}
            y2={connectDragPos.y}
            stroke="#94a3b8"
            strokeWidth={2}
            strokeDasharray="4,3"
          />
        )}
      </svg>
      <div id="nodes-layer" style={layerStyle}>
        {displayNodes.map((node) => (
          <Node key={node.id} node={node} onStartDrag={startDrag} onStartConnect={startConnect} />
        ))}
      </div>
    </div>
  );
}

export default Canvas;
