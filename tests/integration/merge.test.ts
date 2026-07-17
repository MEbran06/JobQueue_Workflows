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

    it('dooms a merge when a predecessor fails, leaving an unrelated chain unaffected', async () => {
        const definition: WorkflowDefinition = {
            id: 'merge-doomed-by-failure-test',
            name: 'Merge Doomed By Failure Test',
            entryStepIds: ['start-1', 'start-2', 'start-3'],
            steps: [
                { id: 'start-1', type: 'start', config: {}, next: 'boom' },
                { id: 'boom', type: 'code', config: { code: 'throw new Error("deliberate test failure");' }, next: 'join' },
                { id: 'start-2', type: 'start', config: {}, next: 'var-c' },
                { id: 'var-c', type: 'set_variable', config: { value: 'from-c' }, next: 'join' },
                { id: 'join', type: 'merge', config: {}, next: null },
                { id: 'start-3', type: 'start', config: {}, next: 'unrelated' },
                { id: 'unrelated', type: 'set_variable', config: { value: 'standalone-done' }, next: null },
            ],
        };
        await createDefinition(definition);

        const runId = await startRun(definition.id);
        const status = await waitForRunSettled(runId);

        expect(status.overallState).toBe('failed');
        const unrelated = status.steps.find((s) => s.step === 'unrelated');
        expect(unrelated?.state).toBe('completed');
        expect(unrelated?.output).toBe('standalone-done');
        const join = status.steps.find((s) => s.step === 'join');
        expect(join?.state).toBe('failed');
    });

    it('dooms a merge when a branch excludes one of its predecessors', async () => {
        const definition: WorkflowDefinition = {
            id: 'branch-merge-exclude-test',
            name: 'Branch Merge Exclude Test',
            entryStepIds: ['start-1', 'start-2', 'start-3'],
            steps: [
                { id: 'start-1', type: 'start', config: {}, next: 'the-branch' },
                {
                    id: 'the-branch', type: 'branch', config: {}, next: null,
                    branches: [
                        { condition: '{{start-1}} equals never-matches', next: 'path-a' },
                        { condition: 'else', next: 'path-b' },
                    ],
                },
                { id: 'path-a', type: 'set_variable', config: { value: 'from-a' }, next: 'join' },
                { id: 'path-b', type: 'set_variable', config: { value: 'from-b' }, next: null },
                { id: 'start-2', type: 'start', config: {}, next: 'var-c' },
                { id: 'var-c', type: 'set_variable', config: { value: 'from-c' }, next: 'join' },
                { id: 'join', type: 'merge', config: {}, next: 'final' },
                { id: 'final', type: 'set_variable', config: { value: 'done' }, next: null },
                { id: 'start-3', type: 'start', config: {}, next: 'unrelated' },
                { id: 'unrelated', type: 'set_variable', config: { value: 'standalone-done' }, next: null },
            ],
        };
        await createDefinition(definition);

        const runId = await startRun(definition.id);
        const status = await waitForRunSettled(runId);

        expect(status.overallState).toBe('failed');
        expect(status.steps.find((s) => s.step === 'path-a')).toBeUndefined();
        expect(status.steps.find((s) => s.step === 'final')).toBeUndefined();
        const join = status.steps.find((s) => s.step === 'join');
        expect(join?.state).toBe('failed');
        const unrelated = status.steps.find((s) => s.step === 'unrelated');
        expect(unrelated?.state).toBe('completed');
        expect(unrelated?.output).toBe('standalone-done');
    });

});