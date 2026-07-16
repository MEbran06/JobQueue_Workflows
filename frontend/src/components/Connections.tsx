import type { ReactElement } from 'react';
import type { CanvasNode } from '../workflow.ts';
import { useWorkflow } from '../store.tsx';
import { NODE_H, NODE_W } from '../constants.ts';

// Stop the line/arrowhead short of the target's port circle (radius ~7px) so
// the tip isn't painted over by the opaque port, which otherwise swallows it.
const PORT_GAP = 8;

// All our curves enter a target either horizontally (left port) or vertically
// (top port, loop body), so the arrowhead direction is always one of these two
// fixed shapes — no need to compute a rotation from the path tangent.
function arrowHead(x: number, y: number, direction: 'right' | 'down', color: string): ReactElement {
  const points =
    direction === 'right'
      ? `${x},${y} ${x - 10},${y - 5} ${x - 10},${y + 5}`
      : `${x},${y} ${x - 5},${y - 10} ${x + 5},${y - 10}`;
  return <polygon className="conn-arrow" points={points} fill={color} />;
}

interface ConnectionProps {
  d: string;
  color: string;
  tipX: number;
  tipY: number;
  direction: 'right' | 'down';
  dashed?: boolean;
  onRemove: () => void;
}

function Connection({ d, color, tipX, tipY, direction, dashed, onRemove }: ConnectionProps) {
  return (
    <g
      className="connection"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
    >
      <path d={d} stroke="transparent" strokeWidth={14} fill="none" style={{ pointerEvents: 'stroke' }} />
      <path className="conn-line" d={d} stroke={color} strokeWidth={2} fill="none" strokeDasharray={dashed ? '5,3' : undefined} />
      {arrowHead(tipX, tipY, direction, color)}
    </g>
  );
}

interface ConnectionsProps {
  nodes: CanvasNode[];
}

function Connections({ nodes }: ConnectionsProps) {
  const { dispatch } = useWorkflow();
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const elements: ReactElement[] = [];
  let key = 0;

  nodes.forEach((node) => {
    if (node.type === 'branch') {
      node.branches.forEach((branch, i) => {
        if (!branch.next) return;
        const target = nodeById.get(branch.next);
        if (!target) return;
        const offset = (i - (node.branches.length - 1) / 2) * 16;
        const x1 = node.x + NODE_W, y1 = node.y + NODE_H / 2 + offset;
        const x2 = target.x - PORT_GAP, y2 = target.y + NODE_H / 2;
        const cp = Math.max(60, Math.abs(x2 - x1) / 2);
        const label = branch.condition === 'else' ? 'else' : `branch ${i + 1}`;
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        elements.push(
          <Connection
            key={key++}
            d={`M${x1},${y1} C${x1 + cp},${y1} ${x2 - cp},${y2} ${x2},${y2}`}
            color="#f59e0b"
            tipX={x2}
            tipY={y2}
            direction="right"
            onRemove={() => dispatch({ kind: 'SET_BRANCH_NEXT', nodeId: node.id, index: i, value: '' })}
          />
        );
        elements.push(
          <text key={key++} x={mx} y={my - 6} fill="#f59e0b" fontSize={10} textAnchor="middle">
            {label}
          </text>
        );
      });
    } else {
      // Loop-back: a deliberate, controlled exception to the no-cycles rule.
      // Routed as a box/elbow path above both nodes rather than a curve, so
      // it visually reads as "looping back" instead of crossing over flow.
      if (node.type === 'loop' && node.config.loopBackTo) {
        const target = nodeById.get(node.config.loopBackTo);
        if (target) {
          const x1 = node.x + NODE_W / 2, y1 = node.y;
          const x2 = target.x + NODE_W / 2, y2 = target.y - PORT_GAP;
          const topY = Math.min(node.y, target.y) - 40;
          elements.push(
            <Connection
              key={key++}
              d={`M${x1},${y1} L${x1},${topY} L${x2},${topY} L${x2},${y2}`}
              color="#4ade80"
              tipX={x2}
              tipY={y2}
              direction="down"
              dashed
              onRemove={() => dispatch({ kind: 'SET_VAL', nodeId: node.id, key: 'loopBackTo', value: '' })}
            />
          );
          elements.push(
            <text key={key++} x={x1 + 6} y={topY - 6} fill="#4ade80" fontSize={10} textAnchor="start">
              loop back
            </text>
          );
        }
      }

      if (node.next) {
        const target = nodeById.get(node.next);
        if (target) {
          const x1 = node.x + NODE_W, y1 = node.y + NODE_H / 2;
          const x2 = target.x - PORT_GAP, y2 = target.y + NODE_H / 2;
          const cp = Math.max(60, Math.abs(x2 - x1) / 2);
          elements.push(
            <Connection
              key={key++}
              d={`M${x1},${y1} C${x1 + cp},${y1} ${x2 - cp},${y2} ${x2},${y2}`}
              color="#3b82f6"
              tipX={x2}
              tipY={y2}
              direction="right"
              onRemove={() => dispatch({ kind: 'CLEAR_NEXT', nodeId: node.id })}
            />
          );
        }
      }
    }
  });

  return <>{elements}</>;
}

export default Connections;
