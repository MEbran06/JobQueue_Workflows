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
        if (status.overallState === 'failed' || status.overallState === 'stopped') return status;
        if (status.overallState === 'completed') {
            // A run can briefly report "completed" before an async dead-token
            // chain finishes marking a merge doomed (self-corrects on the next
            // poll - see src/server.ts's live doomed re-check). Give that a
            // short grace window before treating "completed" as final.
            await new Promise(r => setTimeout(r, 500));
            const recheck = await fetch(`${BASE_URL}/runs/${runId}`);
            return (await recheck.json()) as RunStatus;
        }
        await new Promise(r => setTimeout(r, 250));
    }
    throw new Error(`Run ${runId} did not settle within ${timeoutMs}ms`);
}