import { useState } from 'react';
import Header from './components/Header.tsx';
import Palette from './components/Palette.tsx';
import Canvas from './components/Canvas.tsx';
import Sidebar from './components/Sidebar.tsx';
import BottomPanel from './components/BottomPanel.tsx';
import Resizer from './components/Resizer.tsx';
import type { WorkflowDefinition } from '../../src/types.ts';
import { useWorkflow } from './store.tsx';
import { buildDefinition, validateWorkflow } from './workflow.ts';
import { saveDefinition, startRun } from './api.ts';
import type { InputRow } from './api.ts';
import { clamp } from './utils.ts';

function App() {
  const { state, dispatch } = useWorkflow();
  const [runInputs, setRunInputs] = useState<InputRow[]>([{ key: 'topic', value: '' }]);
  const [runId, setRunId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState('');
  const [paletteWidth, setPaletteWidth] = useState(130);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [bottomHeight, setBottomHeight] = useState(220);

  async function handleSave() {
    const error = validateWorkflow(state);
    if (error) {
      alert(error);
      return;
    }
    const def = buildDefinition(state);
    await saveDefinition(def);
    setSaveStatus('Saved ✓');
    setTimeout(() => setSaveStatus(''), 2000);
  }

  async function handleRun() {
    const error = validateWorkflow(state);
    if (error) {
      alert(error);
      return;
    }
    const def = buildDefinition(state);
    await saveDefinition(def);
    const input = Object.fromEntries(runInputs.filter((r) => r.key).map((r) => [r.key, r.value]));
    const newRunId = await startRun(def.id, input);
    setRunId(newRunId);
  }

  function handleClear() {
    if (state.nodes.length > 0 && !window.confirm('Clear the canvas? This removes all steps and cannot be undone.')) {
      return;
    }
    dispatch({ kind: 'RESET_WORKFLOW' });
    setRunId(null);
    setRunInputs([{ key: 'topic', value: '' }]);
  }

  function handleLoad(def: WorkflowDefinition) {
    if (
      state.nodes.length > 0 &&
      !window.confirm('Load this workflow? Unsaved changes to the current canvas will be lost.')
    ) {
      return;
    }
    dispatch({ kind: 'LOAD_WORKFLOW', definition: def });
    setRunId(null);
    setRunInputs([{ key: 'topic', value: '' }]);
  }

  return (
    <>
      <Header onSave={handleSave} onRun={handleRun} onClear={handleClear} onLoad={handleLoad} saveStatus={saveStatus} />
      <main>
        <Palette width={paletteWidth} />
        <Resizer axis="x" onResize={(d) => setPaletteWidth((w) => clamp(w + d, 90, 400))} />
        <Canvas />
        <Resizer axis="x" onResize={(d) => setSidebarWidth((w) => clamp(w - d, 160, 480))} />
        <Sidebar width={sidebarWidth} />
      </main>
      <Resizer axis="y" onResize={(d) => setBottomHeight((h) => clamp(h - d, 120, 500))} />
      <BottomPanel
        runInputs={runInputs}
        onRunInputsChange={setRunInputs}
        runId={runId}
        onRun={handleRun}
        height={bottomHeight}
      />
    </>
  );
}

export default App;
