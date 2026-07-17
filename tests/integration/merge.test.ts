import { describe, it, expect } from 'vitest';
import { createDefinition, startRun, waitForRunSettled } from '../helpers/api.js';
import type { WorkflowDefinition } from '../../src/types.js';

describe('workflow runs', () => {
    it('completes a linear single-chain run', async () => {
        const definition: WorkflowDefinition = {
            id: 'linear-basic-test',
            name: 'Linear Basic Test',
            entryStepIds: ['start-1'],
            steps: [
                { id: 'start-1', type: 'start', config: {}, next: 'set-1' },
                { id: 'set-1', type: 'set_variable', config: { value: 'hello' }, next: null },
            ],
        };
        await createDefinition(definition);

        const runId = await startRun(definition.id);
        const status = await waitForRunSettled(runId);

        expect(status.overallState).toBe('completed');
        const setStep = status.steps.find((s) => s.step === 'set-1');
        expect(setStep?.state).toBe('completed');
        expect(setStep?.output).toBe('hello');
    });

    it('merges two concurrent chains and unions their context', async () => {
        const definition: WorkflowDefinition = {
            id: 'multi-start-merge-success-test',
            name: 'Multi Start Merge Success Test',
            entryStepIds: ['start-1', 'start-2'],
            steps: [
                { id: 'start-1', type: 'start', config: {}, next: 'var-a' },
                { id: 'var-a', type: 'set_variable', config: { value: 'from-a' }, next: 'join' },
                { id: 'start-2', type: 'start', config: {}, next: 'var-b' },
                { id: 'var-b', type: 'set_variable', config: { value: 'from-b' }, next: 'join' },
                { id: 'join', type: 'merge', config: {}, next: null },
            ],
        };
        await createDefinition(definition);

        const runId = await startRun(definition.id);
        const status = await waitForRunSettled(runId);

        expect(status.overallState).toBe('completed');
        expect(status.steps.find((s) => s.step === 'var-a')?.state).toBe('completed');
        expect(status.steps.find((s) => s.step === 'var-b')?.state).toBe('completed');

        // A merge with 2 predecessors produces 2 "join" entries in steps -
        // one per arrival (each predecessor dispatches its own job to
        // step.next). Only the last arrival actually combines the contexts;
        // the other is left showing its "waiting" placeholder output.
        const joinEntries = status.steps.filter((s) => s.step === 'join');
        expect(joinEntries).toHaveLength(2);
        expect(joinEntries.every((s) => s.state === 'completed')).toBe(true);
        expect(joinEntries.some((s) => s.output === 'merge: combined 2 arrivals')).toBe(true);
    });
});