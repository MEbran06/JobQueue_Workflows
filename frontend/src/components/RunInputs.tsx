import type { InputRow } from '../api.ts';

interface RunInputsProps {
  inputs: InputRow[];
  onChange: (inputs: InputRow[]) => void;
  onRun: () => void;
}

function RunInputs({ inputs, onChange, onRun }: RunInputsProps) {
  function updateRow(i: number, field: 'key' | 'value', value: string) {
    onChange(inputs.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));
  }

  function removeRow(i: number) {
    onChange(inputs.filter((_, idx) => idx !== i));
  }

  return (
    <>
      <div id="run-inputs">
        {inputs.map((row, i) => (
          <div className="input-row" key={i}>
            <input placeholder="key" value={row.key} onChange={(e) => updateRow(i, 'key', e.target.value)} />
            <input placeholder="value" value={row.value} onChange={(e) => updateRow(i, 'value', e.target.value)} />
            <button onClick={() => removeRow(i)}>×</button>
          </div>
        ))}
      </div>
      <button className="sm-btn" onClick={() => onChange([...inputs, { key: '', value: '' }])}>
        + Add input
      </button>
      <div id="run-controls">
        <button onClick={onRun}>▶ Run Workflow</button>
      </div>
    </>
  );
}

export default RunInputs;
