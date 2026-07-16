import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { Job } from 'bullmq';
import { workflowQueue } from './queue.js';
import { saveDefinition, getDefinition, listDefinitions, deleteDefinition } from './db.js';
import type { WorkflowDefinition, StepJobData, StepJobResult } from './types.js';

const app = express();
app.use(express.json());
app.use(express.static('frontend/dist'));

app.post('/definitions', async (req, res) => {
    const def = req.body as WorkflowDefinition;
    if (!def.id || !def.name || !def.steps || !def.entryStepId) {
        res.status(400).json({ error: 'id, name, entryStepId and steps are required' });
        return;
    }
    await saveDefinition(def);
    res.status(201).json({ id: def.id });
});

app.get('/definitions', async (_req, res) => {
    res.json(await listDefinitions());
});

app.get('/definitions/:id', async (req, res) => {
    const def = await getDefinition(req.params.id);
    if (!def) { res.status(404).json({ error: 'not found' }); return; }
    res.json(def);
});

app.delete('/definitions/:id', async (req, res) => {
    const deleted = await deleteDefinition(req.params.id);
    if (!deleted) { res.status(404).json({ error: 'not found' }); return; }
    res.status(204).end();
});

app.post('/runs', async (req, res) => {
    const { definitionId, input } = req.body as { definitionId: string; input: Record<string, string> };
    const definition = await getDefinition(definitionId);
    if (!definition) { res.status(404).json({ error: 'definition not found' }); return; }

    // Assign the job id up front (rather than patching runId in after add())
    // so the worker never sees a job whose data.runId hasn't been set yet.
    const runId = randomUUID();
    const job = await workflowQueue.add('step', {
        definitionId,
        runId,
        stepId: definition.entryStepId,
        context: input ?? {},
    }, { jobId: runId });

    res.status(202).json({ runId: job.id });
});

app.get('/runs/:id', async (req, res) => {
    const steps = [];
    let jobId: string | undefined = req.params.id;
    let lastResult: StepJobResult | null = null;
    // job.getState() and job.returnvalue are separate, non-atomic reads. On a
    // fast-moving chain (e.g. a tight loop) we can catch a job whose state
    // already says "completed" but whose return value hasn't landed yet —
    // that's mid-flight, not the run actually finishing.
    let caughtMidFlight = false;

    while (jobId) {
        const job: Job | undefined = await Job.fromId(workflowQueue, jobId);
        if (!job) break;

        const state = await job.getState();
        const data = job.data as StepJobData;
        const result: StepJobResult | null = (job.returnvalue as StepJobResult | null) ?? null;
        if (state === 'completed' && result === null) caughtMidFlight = true;
        lastResult = result;
        steps.push({ step: data.stepId, jobId, state, output: result?.output });

        jobId = result?.nextJobId ?? undefined;
    }

    const overallState = lastResult?.stopped
        ? 'stopped'
        : caughtMidFlight
            ? 'active'
            : (steps.at(-1)?.state ?? 'unknown');
    res.json({ runId: req.params.id, overallState, steps });
});

app.post('/runs/:id/stop', async (req, res) => {
    const job = await Job.fromId(workflowQueue, req.params.id);
    if (!job) { res.status(404).json({ error: 'run not found' }); return; }

    const redis = await workflowQueue.client;
    await redis.set(`stopped:${req.params.id}`, '1', { EX: 3600 });
    res.status(200).json({ stopped: true });
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));