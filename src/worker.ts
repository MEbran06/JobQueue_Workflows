import 'dotenv/config';
import { Worker } from 'bullmq';
import { workflowQueue } from './queue.js';
import { executeStep, evaluateBranch, evaluateCondition } from './executor.js';
import { getDefinition } from './db.js';
import type { StepJobData, StepJobResult } from './types.js';

const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };

const worker = new Worker<any, StepJobResult>('workflow-steps', async (job) => {
    const { definitionId, runId, stepId, context } = job.data as StepJobData;

    const redis = await workflowQueue.client;
    if (await redis.get(`stopped:${runId}`)) {
        return { stepId, output: 'Run stopped by user', nextJobId: null, stopped: true };
    }

    const definition = await getDefinition(definitionId);
    if (!definition) throw new Error(`Unknown workflow: ${definitionId}`);

    const step = definition.steps.find(s => s.id === stepId);
    if (!step) throw new Error(`Unknown step: ${stepId}`);

    console.log(`[worker] run ${runId} | step "${stepId}" (${step.type})`);

    let output = '';
    let nextStepId: string | null;

    if (step.type === 'branch') {
        nextStepId = evaluateBranch(step, context);

    } else if (step.type === 'loop') {
        const shouldLoop = evaluateCondition(step.config['condition'] ?? '', context);
        const loopBackTo = step.config['loopBackTo'] || null;
        output = shouldLoop ? `loop -> back to "${loopBackTo}"` : 'loop -> continue';
        nextStepId = shouldLoop ? loopBackTo : step.next;

    } else {
        output = await executeStep(step, context);
        nextStepId = step.next;
    }

    const newContext = { ...context, [stepId]: output };

    if (nextStepId) {
        if (await redis.get(`stopped:${runId}`)) {
            return { stepId, output: 'Run stopped by user', nextJobId: null, stopped: true };
        }
        const nextJob = await workflowQueue.add('step', {
            definitionId, runId, stepId: nextStepId, context: newContext,
        });
        return { stepId, output, nextJobId: nextJob.id ?? null };
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