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
});