import type { WorkflowDefinition } from '../../src/types.ts';

export interface InputRow {
  key: string;
  value: string;
}

export interface RunStep {
  step: string;
  jobId: string;
  state: string;
  output?: string;
}

export interface RunStatus {
  runId: string;
  overallState: string;
  steps: RunStep[];
}

export async function saveDefinition(def: WorkflowDefinition): Promise<void> {
  await fetch('/definitions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(def),
  });
}

export async function startRun(definitionId: string, input: Record<string, string>): Promise<string> {
  const res = await fetch('/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ definitionId, input }),
  });
  const { runId } = (await res.json()) as { runId: string };
  return runId;
}

export async function fetchRun(runId: string): Promise<RunStatus> {
  const res = await fetch(`/runs/${runId}`);
  return (await res.json()) as RunStatus;
}

export async function stopRun(runId: string): Promise<void> {
  await fetch(`/runs/${runId}/stop`, { method: 'POST' });
}
