import { useState } from 'react';
import type { InputRow } from '../api.ts';
import { clamp } from '../utils.ts';
import JsonPreview from './JsonPreview.tsx';
import RunInputs from './RunInputs.tsx';
import RunResults from './RunResults.tsx';
import Resizer from './Resizer.tsx';

interface BottomPanelProps {
  runInputs: InputRow[];
  onRunInputsChange: (inputs: InputRow[]) => void;
  runId: string | null;
  onRun: () => void;
  height: number;
}

function BottomPanel({ runInputs, onRunInputsChange, runId, onRun, height }: BottomPanelProps) {
  const [jsonWidth, setJsonWidth] = useState(480);
  const [inputsWidth, setInputsWidth] = useState(280);

  return (
    <div id="bottom" style={{ height }}>
      <div className="bottom-panel" style={{ flex: 'none', width: jsonWidth }}>
        <h2>JSON Preview</h2>
        <div className="panel-body">
          <JsonPreview />
        </div>
      </div>

      <Resizer axis="x" onResize={(d) => setJsonWidth((w) => clamp(w + d, 220, 900))} />

      <div className="bottom-panel" style={{ flex: 'none', width: inputsWidth }}>
        <h2>Run Inputs</h2>
        <div className="panel-body">
          <RunInputs inputs={runInputs} onChange={onRunInputsChange} onRun={onRun} />
        </div>
      </div>

      <Resizer axis="x" onResize={(d) => setInputsWidth((w) => clamp(w + d, 180, 700))} />

      <div className="bottom-panel" style={{ flex: 1 }}>
        <h2>Run Output</h2>
        <div className="panel-body">
          <div id="results">
            <RunResults runId={runId} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default BottomPanel;
