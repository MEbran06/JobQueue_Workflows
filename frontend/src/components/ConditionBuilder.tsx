import type { CanvasNode } from '../workflow.ts';

export type ConditionOperator = 'contains' | 'equals' | 'notEquals' | 'startsWith' | 'lessThan' | 'greaterThan' | 'else';

export interface ConditionParts {
  operator: ConditionOperator;
  variable: string;
  value: string;
}

const OPERATORS: { value: ConditionOperator; label: string }[] = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: 'equals' },
  { value: 'notEquals', label: 'not equals' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'lessThan', label: 'less than' },
  { value: 'greaterThan', label: 'greater than' },
  { value: 'else', label: 'else (always)' },
];

const CONDITION_RE = /^\{\{(\w+)\}\}\s+(contains|equals|notEquals|startsWith|lessThan|greaterThan)\s+(.*)$/;

export function parseCondition(condition: string): ConditionParts {
  if (condition.trim() === 'else') return { operator: 'else', variable: '', value: '' };
  const match = condition.match(CONDITION_RE);
  if (match) {
    const [, variable, operator, value] = match;
    return { operator: operator as ConditionOperator, variable, value };
  }
  return { operator: 'equals', variable: '', value: '' };
}

export function serializeCondition(parts: ConditionParts): string {
  if (parts.operator === 'else') return 'else';
  return `{{${parts.variable}}} ${parts.operator} ${parts.value}`;
}

interface ConditionBuilderProps {
  value: string;
  otherNodes: CanvasNode[];
  onChange: (value: string) => void;
}

function ConditionBuilder({ value, otherNodes, onChange }: ConditionBuilderProps) {
  const parts = parseCondition(value);

  function update(next: Partial<ConditionParts>) {
    onChange(serializeCondition({ ...parts, ...next }));
  }

  return (
    <div className="condition-builder">
      {parts.operator !== 'else' && (
        <select value={parts.variable} onChange={(e) => update({ variable: e.target.value })}>
          <option value="">— step —</option>
          {otherNodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.id}
            </option>
          ))}
        </select>
      )}
      <select value={parts.operator} onChange={(e) => update({ operator: e.target.value as ConditionOperator })}>
        {OPERATORS.map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>
      {parts.operator !== 'else' && (
        <input value={parts.value} placeholder="value" onChange={(e) => update({ value: e.target.value })} />
      )}
    </div>
  );
}

export default ConditionBuilder;
