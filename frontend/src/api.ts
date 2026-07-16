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

export interface DefinitionSummary {
  id: string;
  name: string;
}

export async function saveDefinition(def: WorkflowDefinition): Promise<void> {
  await fetch('/definitions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(def),
  });
}

export async function listDefinitions(): Promise<DefinitionSummary[]> {
  const res = await fetch('/definitions');
  return (await res.json()) as DefinitionSummary[];
}

export async function fetchDefinition(id: string): Promise<WorkflowDefinition> {
  const res = await fetch(`/definitions/${id}`);
  return (await res.json()) as WorkflowDefinition;
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

export async function deleteDefinition(id: string): Promise<void> {
  await fetch(`/definitions/${id}`, { method: 'DELETE' });
}
