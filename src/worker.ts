import 'dotenv/config';
import { Worker } from 'bullmq';
import { workflowQueue } from './queue.js';
import { executeStep, evaluateBranch, interpolate } from './executor.js';
import { getDefinition } from './db.js';
import type { StepJobData, LoopState } from './types.js';

const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };

const worker = new Worker<any, any>('workflow-steps', async (job) => {
    const { definitionId, runId, stepId, context, loopState } = job.data as StepJobData;

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
        const rawItems = interpolate(step.config['items'] ?? '', context);
        const items = rawItems.split('\n').map(s => s.trim()).filter(Boolean);
        output = `loop(${items.length} items)`;

        if (items.length === 0) {
            nextStepId = step.next;
        } else {
            const loopVar = step.config['var'] ?? 'item';
            const bodyStepId = step.config['body'];
            if (!bodyStepId) throw new Error(`loop step "${stepId}" missing "body" config`);

            const newLoopState: LoopState = {
                items, index: 0, loopVar,
                bodyStepId, afterLoopStepId: step.next,
            };
            const bodyJob = await workflowQueue.add('step', {
                definitionId, runId, stepId: bodyStepId,
                context: { ...context, [loopVar]: items[0] },
                loopState: newLoopState,
            });
            return { stepId, output, nextJobId: bodyJob.id };
        }

    } else {
        output = await executeStep(step, context);
        nextStepId = step.next;
    }

    const newContext = { ...context, [stepId]: output };

    if (nextStepId) {
        // Carry loopState through the body chain so the end of the chain can continue the loop
        const nextJob = await workflowQueue.add('step', {
            definitionId, runId, stepId: nextStepId,
            context: newContext, loopState,
        });
        return { stepId, output, nextJobId: nextJob.id };
    }

    // nextStepId is null — check if we're inside a loop body
    if (loopState) {
        const { items, index, loopVar, bodyStepId, afterLoopStepId } = loopState;
        const nextIndex = index + 1;

        if (nextIndex < items.length) {
            const iterJob = await workflowQueue.add('step', {
                definitionId, runId, stepId: bodyStepId,
                context: { ...newContext, [loopVar]: items[nextIndex] },
                loopState: { ...loopState, index: nextIndex },
            });
            return { stepId, output, nextJobId: iterJob.id };
        }

        if (afterLoopStepId) {
            const afterJob = await workflowQueue.add('step', {
                definitionId, runId, stepId: afterLoopStepId, context: newContext,
            });
            return { stepId, output, nextJobId: afterJob.id };
        }
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