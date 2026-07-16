import { useWorkflow } from '../store.tsx';
import { buildDefinition } from '../workflow.ts';

function JsonPreview() {
  const { state } = useWorkflow();
  return <pre id="json-preview">{JSON.stringify(buildDefinition(state), null, 2)}</pre>;
}

export default JsonPreview;
