import 'dotenv/config';
import express from 'express';
import { Job } from 'bullmq';
import { workflowQueue } from './queue.js';
import { saveDefinition, getDefinition, listDefinitions } from './db.js';
import type { WorkflowDefinition, StepJobData } from './types.js';

const app = express();
app.use(express.json());
app.use(express.static('public'));

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

app.post('/runs', async (req, res) => {
    const { definitionId, input } = req.body as { definitionId: string; input: Record<string, string> };
    const definition = await getDefinition(definitionId);
    if (!definition) { res.status(404).json({ error: 'definition not found' }); return; }

    const job = await workflowQueue.add('step', {
        definitionId,
        runId: '',
        stepId: definition.entryStepId,
        context: input ?? {},
    });

    await workflowQueue.getJob(job.id!).then(async (j) => {
        if (j) await j.updateData({ ...j.data, runId: job.id });
    });

    res.status(202).json({ runId: job.id });
});

app.get('/runs/:id', async (req, res) => {
    const steps = [];
    let jobId: string | undefined = req.params.id;

    while (jobId) {
        const job: Job | undefined = await Job.fromId(workflowQueue, jobId);
        if (!job) break;

        const state = await job.getState();
        const data = job.data as StepJobData;
        steps.push({ step: data.stepId, jobId, state, output: job.returnvalue?.output });

        jobId = (job.returnvalue as { nextJobId?: string } | null)?.nextJobId ?? undefined;
    }

    const overallState = steps.at(-1)?.state ?? 'unknown';
    res.json({ runId: req.params.id, overallState, steps });
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));