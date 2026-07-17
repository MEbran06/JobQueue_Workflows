import 'dotenv/config';
import { Worker } from 'bullmq';
import { workflowQueue } from './queue.js';
import { executeStep, evaluateBranch, evaluateCondition, findDownstreamMergeSteps } from './executor.js';
import type { ExtraRedisCommands } from './queue.js';
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

    if (step.type === 'merge') {
        const doomed = await redis.get(`run:${runId}:merge:${stepId}:doomed`);
        if (doomed) {
            throw new Error(`Merge step "${stepId}" cannot complete: predecessor "${doomed}" failed`);
        }

        const extraRedis = redis as unknown as ExtraRedisCommands;
        await extraRedis.rpush(`run:${runId}:merge:${stepId}:contexts`, JSON.stringify(context));
        const arrivalCount = await extraRedis.incr(`run:${runId}:merge:${stepId}:count`);
        const expectedCount = definition.steps.filter(s => s.next === stepId).length;

        if (arrivalCount < expectedCount) {
            return { stepId, output: `merge: waiting (${arrivalCount}/${expectedCount} arrived)`, nextJobId: null };
        }

        const rawContexts = await redis.lrange(`run:${runId}:merge:${stepId}:contexts`, 0, -1);
        const combinedContext: Record<string, string> = Object.assign({}, ...rawContexts.map(c => JSON.parse(c)));
        const mergedOutput = `merge: combined ${expectedCount} arrivals`;
        const mergedNewContext = { ...combinedContext, [stepId]: mergedOutput };

        if (!step.next) {
            return { stepId, output: mergedOutput, nextJobId: null };
        }
        if (await redis.get(`stopped:${runId}`)) {
            return { stepId, output: 'Run stopped by user', nextJobId: null, stopped: true };
        }
        const mergeNextJob = await workflowQueue.add('step', {
            definitionId, runId, stepId: step.next, context: mergedNewContext,
        });
        await extraRedis.rpush(`run:${runId}:jobs`, mergeNextJob.id!);
        return { stepId, output: mergedOutput, nextJobId: mergeNextJob.id ?? null };
    }

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
        await (redis as unknown as ExtraRedisCommands).rpush(`run:${runId}:jobs`, nextJob.id!);
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
    if (!job) return;

    const { runId, stepId, definitionId } = job.data as StepJobData;
    void (async () => {
        try {
            const definition = await getDefinition(definitionId);
            if (!definition) return;
            const redis = await workflowQueue.client;
            const doomedMerges = findDownstreamMergeSteps(definition.steps, stepId);
            for (const mergeId of doomedMerges) {
                await redis.set(`run:${runId}:merge:${mergeId}:doomed`, stepId);
            }
        } catch (doomErr) {
            console.error(`[worker] failed to mark downstream merges doomed for run ${runId} step ${stepId}:`, doomErr);
        }
    })();
});

console.log('[worker] waiting for jobs...');