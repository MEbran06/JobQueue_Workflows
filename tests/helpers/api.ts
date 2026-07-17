import type { WorkflowDefinition } from '../../src/types.js';

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3100';

export async function createDefinition(def: WorkflowDefinition): Promise<void> {
    const res = await fetch(`${BASE_URL}/definitions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(def),
    });
    if (!res.ok) throw new Error(`createDefinition failed: ${res.status} ${await res.text()}`);
}

export async function startRun(definitionId: string, input?: Record<string, string>): Promise<string> {
    const res = await fetch(`${BASE_URL}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definitionId, input }),
    });
    if (!res.ok) throw new Error(`startRun failed: ${res.status} ${await res.text()}`);
    const { runId } = await res.json() as { runId: string };
    return runId;
}

export interface RunStepStatus {
    step: string;
    jobId: string;
    state: string;
    output?: string;
}

export interface RunStatus {
    runId: string;
    overallState: 'active' | 'completed' | 'failed' | 'stopped' | 'unknown';
    steps: RunStepStatus[];
}

export async function waitForRunSettled(runId: string, opts?: { timeoutMs?: number }): Promise<RunStatus> {
    const timeoutMs = opts?.timeoutMs ?? 10_000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const res = await fetch(`${BASE_URL}/runs/${runId}`);
        const status = await res.json() as RunStatus;
        if (status.overallState !== 'active') return status;
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`Run ${runId} did not settle within ${timeoutMs}ms`);
}