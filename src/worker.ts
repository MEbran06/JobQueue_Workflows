import 'dotenv/config';
import { Worker } from 'bullmq';
import { workflowQueue } from './queue.js';
import { executeStep } from './executor.js';
import { getDefinition } from './db.js';
import type { StepJobData } from './types.js';

const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };

const worker = new Worker<any, any>('workflow-steps', async (job) => {
    const { definitionId, runId, stepId, context } = job.data as StepJobData;

    const definition = await getDefinition(definitionId);
    if (!definition) throw new Error(`Unknown workflow: ${definitionId}`);

    const step = definition.steps.find(s => s.id === stepId);
    if (!step) throw new Error(`Unknown step: ${stepId}`);

    console.log(`[worker] run ${runId} | step "${stepId}" (${step.type})`);

    const output = await executeStep(step, context);
    const newContext = { ...context, [stepId]: output };

    if (step.next) {
        const nextJob = await workflowQueue.add('step', {
            definitionId,
            runId,
            stepId: step.next,
            context: newContext,
        });
        return { stepId, output, nextJobId: nextJob.id };
    }

    return { stepId, output, nextJobId: null };
}, { connection, concurrency: 5 });

worker.on('completed', (job) => {
    const { runId, stepId } = job.data as StepJobData;
    console.log(`[worker] run ${runId} | step "${stepId}" done`);
});

worker.on('failed', (job, err) => {
    console.error(`[worker] job ${job?.id} failed:`, err.message);
});

console.log('[worker] waiting for jobs...');