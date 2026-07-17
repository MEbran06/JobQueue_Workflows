import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { Job } from 'bullmq';
import { workflowQueue } from './queue.js';
import { saveDefinition, getDefinition, listDefinitions, deleteDefinition } from './db.js';
import type { ExtraRedisCommands } from './queue.js';
import type { WorkflowDefinition, StepJobData, StepJobResult } from './types.js';

const app = express();
app.use(express.json());
app.use(express.static('frontend/dist'));

app.post('/definitions', async (req, res) => {
    const def = req.body as WorkflowDefinition;
    if (!def.id || !def.name || !def.steps || !def.entryStepIds || def.entryStepIds.length === 0) {
        res.status(400).json({ error: 'id, name, entryStepIds and steps are required' });
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

    const runId = randomUUID();
    const redis = await workflowQueue.client;
    for (const entryStepId of definition.entryStepIds) {
        const job = await workflowQueue.add('step', {
            definitionId,
            runId,
            stepId: entryStepId,
            context: input ?? {},
        });
        await (redis as unknown as ExtraRedisCommands).rpush(`run:${runId}:jobs`, job.id!);
    }

    res.status(202).json({ runId });
});

app.get('/runs/:id', async (req, res) => {
    const runId = req.params.id;
    const redis = await workflowQueue.client;
    const jobIds = await redis.lrange(`run:${runId}:jobs`, 0, -1);

    const steps: { step: string; jobId: string; state: string; output?: string }[] = [];
    let anyStopped = false;
    let anyFailed = false;
    let anyUnfinished = false;

    for (const jobId of jobIds) {
        const job: Job | undefined = await Job.fromId(workflowQueue, jobId);
        if (!job) continue;

        const state = await job.getState();
        const data = job.data as StepJobData;
        const result: StepJobResult | null = (job.returnvalue as StepJobResult | null) ?? null;

        // A merge arrival that wasn't the last one completes with no nextJobId -
        // normally indistinguishable from a genuinely finished leaf step. If a
        // sibling feeding the same merge fails AFTER this arrival already
        // returned, the doomed flag lands too late for this job to have seen it
        // itself. Re-check live on every poll so the reported state
        // self-corrects once the flag lands, instead of staying stuck at
        // "waiting" forever - this does not mutate the underlying BullMQ job.
        let effectiveState = state;
        if (state === 'completed' && result?.nextJobId === null && result.output?.startsWith('merge: waiting')) {
            const doomed = await redis.get(`run:${runId}:merge:${data.stepId}:doomed`);
            if (doomed) effectiveState = 'failed';
        }

        if (result?.stopped) anyStopped = true;
        if (effectiveState === 'failed') anyFailed = true;
        // job.getState() and job.returnvalue are separate, non-atomic reads. A job
        // can report "completed" before its return value is visible yet - that's
        // mid-flight, not finished. Applied per-job now instead of just the last
        // one walked, since there's no single chain anymore.
        if (state !== 'completed' && state !== 'failed') anyUnfinished = true;
        if (state === 'completed' && result === null) anyUnfinished = true;

        steps.push({ step: data.stepId, jobId, state: effectiveState, output: result?.output });
    }

    const overallState = anyStopped
        ? 'stopped'
        : anyFailed
            ? 'failed'
            : anyUnfinished
                ? 'active'
                : (jobIds.length > 0 ? 'completed' : 'unknown');

    res.json({ runId, overallState, steps });
});

app.post('/runs/:id/stop', async (req, res) => {
    const redis = await workflowQueue.client;
    const exists = await (redis as unknown as ExtraRedisCommands).exists(`run:${req.params.id}:jobs`);
    if (!exists) { res.status(404).json({ error: 'run not found' }); return; }

    await redis.set(`stopped:${req.params.id}`, '1', { EX: 3600 });
    res.status(200).json({ stopped: true });
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));