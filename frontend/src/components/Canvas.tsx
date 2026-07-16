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

interface PanState {
  startClientX: number;
  startClientY: number;
  startPanX: number;
  startPanY: number;
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
  const panningRef = useRef<PanState | null>(null);
  const justPannedRef = useRef(false);
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

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = wrapRef.current!.getBoundingClientRect();
      return {
        x: (clientX - rect.left - view.panX) / view.zoom,
        y: (clientY - rect.top - view.panY) / view.zoom,
      };
    },
    [view.panX, view.panY, view.zoom]
  );

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (draggingRef.current) {
        const drag = draggingRef.current;
        const { x: wx, y: wy } = toWorld(e.clientX, e.clientY);
        const x = Math.max(10, wx - drag.offsetX);
        const y = Math.max(10, wy - drag.offsetY);
        setDragPreview({ id: drag.id, x, y });
      } else if (connectingRef.current) {
        setConnectDragPos(toWorld(e.clientX, e.clientY));
      } else if (panningRef.current) {
        const pan = panningRef.current;
        const dx = e.clientX - pan.startClientX;
        const dy = e.clientY - pan.startClientY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) justPannedRef.current = true;
        setView((v) => ({ ...v, panX: pan.startPanX + dx, panY: pan.startPanY + dy }));
      }
    }

    function onMouseUp(e: MouseEvent) {
      if (draggingRef.current) {
        const drag = draggingRef.current;
        const { x: wx, y: wy } = toWorld(e.clientX, e.clientY);
        const x = Math.max(10, wx - drag.offsetX);
        const y = Math.max(10, wy - drag.offsetY);
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

      panningRef.current = null;
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
  }, [dispatch, toWorld]);

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

  const startDrag = useCallback(
    (node: CanvasNode, e: ReactMouseEvent) => {
      if (!wrapRef.current) return;
      const { x: wx, y: wy } = toWorld(e.clientX, e.clientY);
      draggingRef.current = { id: node.id, offsetX: wx - node.x, offsetY: wy - node.y };
    },
    [toWorld]
  );

  const startConnect = useCallback(
    (nodeId: string, e: ReactMouseEvent) => {
      if (!wrapRef.current) return;
      connectingRef.current = nodeId;
      dispatch({ kind: 'START_CONNECT', id: nodeId });
      setConnectDragPos(toWorld(e.clientX, e.clientY));
    },
    [dispatch, toWorld]
  );

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const type = e.dataTransfer.getData('type') as StepType | '';
    if (!type || !wrapRef.current) return;
    const { x: wx, y: wy } = toWorld(e.clientX, e.clientY);
    dispatch({
      kind: 'ADD_NODE',
      nodeType: type,
      x: wx - NODE_W / 2,
      y: wy - NODE_H / 2,
    });
  }

  function onCanvasMouseDown(e: ReactMouseEvent) {
    // A pan that ends with mouseup off-canvas never reaches onCanvasClick to
    // reset this flag, so also clear it here - any future click-to-cancel-
    // connect requires its own preceding mousedown on the canvas first.
    justPannedRef.current = false;
    if (e.target !== wrapRef.current) return;
    panningRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPanX: view.panX,
      startPanY: view.panY,
    };
  }

  function onCanvasClick() {
    // A completed pan still ends with a native click on the same element the
    // pan started on - swallow that one click so panning never also cancels
    // an in-progress connection the way a real click on empty canvas should.
    if (justPannedRef.current) {
      justPannedRef.current = false;
      return;
    }
    if (state.connectingFrom) dispatch({ kind: 'CANCEL_CONNECT' });
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
      onMouseDown={onCanvasMouseDown}
      onClick={onCanvasClick}
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
