import { useWorkflow } from '../store.tsx';

interface HeaderProps {
  onSave: () => void;
  onRun: () => void;
  onClear: () => void;
  saveStatus: string;
}

function Header({ onSave, onRun, onClear, saveStatus }: HeaderProps) {
  const { state, dispatch } = useWorkflow();

  return (
    <header>
      <h1>Workflow Builder</h1>
      <input
        id="wf-id"
        placeholder="workflow-id"
        value={state.workflowId}
        onChange={(e) => dispatch({ kind: 'SET_WORKFLOW_ID', value: e.target.value })}
      />
      <input
        id="wf-name"
        placeholder="Workflow Name"
        value={state.workflowName}
        onChange={(e) => dispatch({ kind: 'SET_WORKFLOW_NAME', value: e.target.value })}
      />
      <button onClick={onSave}>Save</button>
      <button className="run" onClick={onRun}>
        ▶ Run
      </button>
      <button className="clear" onClick={onClear}>
        Clear
      </button>
      <span id="save-status">{saveStatus}</span>
    </header>
  );
}

export default Header;
