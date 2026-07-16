import type { Branch, Step, WorkflowDefinition } from '../../src/types.ts';
import type { StepType } from './constants.ts';
import { defaultBranches, defaultConfig, slugFor } from './constants.ts';

export interface CanvasNode {
  id: string;
  type: StepType;
  config: Record<string, string>;
  branches: Branch[];
  x: number;
  y: number;
  next: string | null;
}

export interface WorkflowState {
  workflowId: string;
  workflowName: string;
  nodes: CanvasNode[];
  selected: string | null;
  connectingFrom: string | null;
  nodeCounter: number;
}

export const initialState: WorkflowState = {
  workflowId: 'my-workflow',
  workflowName: 'My Workflow',
  nodes: [],
  selected: null,
  connectingFrom: null,
  nodeCounter: 0,
};

export type Action =
  | { kind: 'RESET_WORKFLOW' }
  | { kind: 'LOAD_WORKFLOW'; definition: WorkflowDefinition }
  | { kind: 'SET_WORKFLOW_ID'; value: string }
  | { kind: 'SET_WORKFLOW_NAME'; value: string }
  | { kind: 'ADD_NODE'; nodeType: StepType; x: number; y: number }
  | { kind: 'DELETE_NODE'; id: string }
  | { kind: 'MOVE_NODE'; id: string; x: number; y: number }
  | { kind: 'SELECT_NODE'; id: string | null }
  | { kind: 'CONNECT_NODES'; fromId: string; toId: string }
  | { kind: 'START_CONNECT'; id: string }
  | { kind: 'CANCEL_CONNECT' }
  | { kind: 'CLEAR_NEXT'; nodeId: string }
  | { kind: 'RENAME_NODE'; oldId: string; newId: string }
  | { kind: 'CHANGE_TYPE'; id: string; nodeType: StepType }
  | { kind: 'SET_BRANCH_CONDITION'; nodeId: string; index: number; value: string }
  | { kind: 'SET_BRANCH_NEXT'; nodeId: string; index: number; value: string }
  | { kind: 'ADD_BRANCH'; nodeId: string }
  | { kind: 'REMOVE_BRANCH'; nodeId: string; index: number }
  | { kind: 'RENAME_KEY'; nodeId: string; oldKey: string; newKey: string }
  | { kind: 'SET_VAL'; nodeId: string; key: string; value: string }
  | { kind: 'ADD_KEY'; nodeId: string }
  | { kind: 'REMOVE_KEY'; nodeId: string; key: string };

function clearReferencesTo(nodes: CanvasNode[], id: string): CanvasNode[] {
  return nodes.map((n) => ({
    ...n,
    next: n.next === id ? null : n.next,
    branches: n.branches.map((b) => (b.next === id ? { ...b, next: '' } : b)),
    config: n.type === 'loop' && n.config.loopBackTo === id ? { ...n.config, loopBackTo: '' } : n.config,
  }));
}

function retargetReferences(nodes: CanvasNode[], oldId: string, newId: string): CanvasNode[] {
  return nodes.map((n) => ({
    ...n,
    next: n.next === oldId ? newId : n.next,
    branches: n.branches.map((b) => (b.next === oldId ? { ...b, next: newId } : b)),
    config: n.type === 'loop' && n.config.loopBackTo === oldId ? { ...n.config, loopBackTo: newId } : n.config,
  }));
}

// Note: loopBackTo is deliberately excluded here — it's an intentional
// backward reference (the one sanctioned exception to cycle-prevention), so
// it must not participate in cycle-detection or entry-step detection.
function outgoingTargets(node: CanvasNode): string[] {
  const targets: string[] = [];
  if (node.next) targets.push(node.next);
  node.branches.forEach((b) => { if (b.next) targets.push(b.next); });
  return targets;
}

// True if adding an edge fromId -> toId would close a cycle, i.e. toId can
// already reach fromId through existing next/branch edges.
function wouldCreateCycle(nodes: CanvasNode[], fromId: string, toId: string): boolean {
  if (fromId === toId) return true;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const stack = [toId];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === fromId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const node = byId.get(current);
    if (node) stack.push(...outgoingTargets(node));
  }
  return false;
}

function positionFor(step: Step, index: number): { x: number; y: number } {
  if (typeof step.x === 'number' && typeof step.y === 'number') return { x: step.x, y: step.y };
  // Older saved workflows predate position persistence — fall back to a
  // simple grid rather than stacking everything at the origin.
  const col = index % 4;
  const row = Math.floor(index / 4);
  return { x: 40 + col * 220, y: 40 + row * 140 };
}

function inferNodeCounter(nodes: CanvasNode[]): number {
  let max = 0;
  nodes.forEach((n) => {
    const match = n.id.match(/-(\d+)$/);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  });
  return max;
}

export function fromDefinition(def: WorkflowDefinition): WorkflowState {
  const nodes: CanvasNode[] = def.steps.map((step, i) => {
    const pos = positionFor(step, i);
    return {
      id: step.id,
      type: step.type,
      config: { ...step.config },
      branches: (step.branches ?? []).map((b) => ({ ...b })),
      x: pos.x,
      y: pos.y,
      next: step.next,
    };
  });
  return {
    workflowId: def.id,
    workflowName: def.name,
    nodes,
    selected: null,
    connectingFrom: null,
    nodeCounter: inferNodeCounter(nodes),
  };
}

export function reducer(state: WorkflowState, action: Action): WorkflowState {
  switch (action.kind) {
    case 'RESET_WORKFLOW':
      return initialState;

    case 'LOAD_WORKFLOW':
      return fromDefinition(action.definition);

    case 'SET_WORKFLOW_ID':
      return { ...state, workflowId: action.value };

    case 'SET_WORKFLOW_NAME':
      return { ...state, workflowName: action.value };

    case 'ADD_NODE': {
      const nodeCounter = state.nodeCounter + 1;
      const id = `${slugFor(action.nodeType)}-${nodeCounter}`;
      const node: CanvasNode = {
        id,
        type: action.nodeType,
        config: defaultConfig(action.nodeType),
        branches: action.nodeType === 'branch' ? defaultBranches() : [],
        x: action.x,
        y: action.y,
        next: null,
      };
      return { ...state, nodes: [...state.nodes, node], selected: id, nodeCounter };
    }

    case 'DELETE_NODE': {
      const nodes = clearReferencesTo(state.nodes, action.id).filter((n) => n.id !== action.id);
      return {
        ...state,
        nodes,
        selected: state.selected === action.id ? null : state.selected,
        connectingFrom: state.connectingFrom === action.id ? null : state.connectingFrom,
      };
    }

    case 'MOVE_NODE':
      return {
        ...state,
        nodes: state.nodes.map((n) => (n.id === action.id ? { ...n, x: action.x, y: action.y } : n)),
      };

    case 'SELECT_NODE':
      return { ...state, selected: action.id };

    case 'CONNECT_NODES': {
      if (wouldCreateCycle(state.nodes, action.fromId, action.toId)) return { ...state, connectingFrom: null };
      const nodes = state.nodes.map((n) => (n.id === action.fromId ? { ...n, next: action.toId } : n));
      return { ...state, nodes, connectingFrom: null };
    }

    case 'START_CONNECT':
      return { ...state, connectingFrom: action.id };

    case 'CANCEL_CONNECT':
      return { ...state, connectingFrom: null };

    case 'CLEAR_NEXT': {
      const nodes = state.nodes.map((n) => (n.id === action.nodeId ? { ...n, next: null } : n));
      return { ...state, nodes };
    }

    case 'RENAME_NODE': {
      const newId = action.newId.trim();
      if (!newId || newId === action.oldId || state.nodes.some((n) => n.id === newId)) return state;
      const nodes = retargetReferences(state.nodes, action.oldId, newId).map((n) =>
        n.id === action.oldId ? { ...n, id: newId } : n
      );
      return {
        ...state,
        nodes,
        selected: state.selected === action.oldId ? newId : state.selected,
        connectingFrom: state.connectingFrom === action.oldId ? newId : state.connectingFrom,
      };
    }

    case 'CHANGE_TYPE': {
      const nodes = state.nodes.map((n) => {
        if (n.id !== action.id) return n;
        return {
          ...n,
          type: action.nodeType,
          config: defaultConfig(action.nodeType),
          branches: action.nodeType === 'branch' ? defaultBranches() : [],
          next: action.nodeType === 'branch' ? null : n.next,
        };
      });
      return { ...state, nodes };
    }

    case 'SET_BRANCH_CONDITION': {
      const nodes = state.nodes.map((n) =>
        n.id === action.nodeId
          ? { ...n, branches: n.branches.map((b, i) => (i === action.index ? { ...b, condition: action.value } : b)) }
          : n
      );
      return { ...state, nodes };
    }

    case 'SET_BRANCH_NEXT': {
      if (action.value && wouldCreateCycle(state.nodes, action.nodeId, action.value)) return state;
      const nodes = state.nodes.map((n) =>
        n.id === action.nodeId
          ? { ...n, branches: n.branches.map((b, i) => (i === action.index ? { ...b, next: action.value } : b)) }
          : n
      );
      return { ...state, nodes };
    }

    case 'ADD_BRANCH': {
      const nodes = state.nodes.map((n) =>
        n.id === action.nodeId ? { ...n, branches: [...n.branches, { condition: 'else', next: '' }] } : n
      );
      return { ...state, nodes };
    }

    case 'REMOVE_BRANCH': {
      const nodes = state.nodes.map((n) =>
        n.id === action.nodeId ? { ...n, branches: n.branches.filter((_, i) => i !== action.index) } : n
      );
      return { ...state, nodes };
    }

    case 'RENAME_KEY': {
      const nodes = state.nodes.map((n) => {
        if (n.id !== action.nodeId) return n;
        const config = { ...n.config };
        const val = config[action.oldKey];
        delete config[action.oldKey];
        config[action.newKey] = val ?? '';
        return { ...n, config };
      });
      return { ...state, nodes };
    }

    case 'SET_VAL': {
      const nodes = state.nodes.map((n) =>
        n.id === action.nodeId ? { ...n, config: { ...n.config, [action.key]: action.value } } : n
      );
      return { ...state, nodes };
    }

    case 'ADD_KEY': {
      const nodes = state.nodes.map((n) => {
        if (n.id !== action.nodeId) return n;
        return { ...n, config: { ...n.config, [`key${Object.keys(n.config).length + 1}`]: '' } };
      });
      return { ...state, nodes };
    }

    case 'REMOVE_KEY': {
      const nodes = state.nodes.map((n) => {
        if (n.id !== action.nodeId) return n;
        const config = { ...n.config };
        delete config[action.key];
        return { ...n, config };
      });
      return { ...state, nodes };
    }

    default:
      return state;
  }
}

export function buildDefinition(state: WorkflowState): WorkflowDefinition {
  const id = state.workflowId || 'my-workflow';
  const name = state.workflowName || 'My Workflow';

  // loopBackTo is deliberately excluded — its target is typically the
  // workflow's actual entry step, and marking it "pointed" would break
  // entry-step detection.
  const pointed = new Set<string>();
  state.nodes.forEach((n) => {
    if (n.next) pointed.add(n.next);
    n.branches.forEach((b) => { if (b.next) pointed.add(b.next); });
  });
  const entry = state.nodes.find((n) => !pointed.has(n.id));

  return {
    id,
    name,
    entryStepId: entry?.id ?? '',
    steps: state.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      config: { ...n.config },
      next: n.next,
      x: n.x,
      y: n.y,
      ...(n.type === 'branch' ? { branches: n.branches.map((b) => ({ ...b })) } : {}),
    })),
  };
}
