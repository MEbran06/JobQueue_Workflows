import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { createDefinition, startRun, waitForRunSettled } from '../../tests/helpers/api.js';
import type { RunStatus, RunStepStatus } from '../../tests/helpers/api.js';
import { generateC } from '../compiler/codegen.js';
import type { WorkflowDefinition } from '../../src/types.js';

const EXE_EXT = process.platform === 'win32' ? '.exe' : '';

interface CompiledResult {
    lines: Set<string>;
    exitCode: number;
}

function compiledRun(definition: WorkflowDefinition): CompiledResult {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobqueue-embedded-'));
    const cPath = path.join(tmpDir, 'out.c');
    const exePath = path.join(tmpDir, `out${EXE_EXT}`);
    fs.writeFileSync(cPath, generateC(definition));
    execSync(`gcc -pthread "${cPath}" -o "${exePath}"`, { stdio: 'pipe' });

    let stdout = '';
    let exitCode = 0;
    try {
        stdout = execSync(`"${exePath}"`).toString();
    } catch (err) {
        const e = err as { status: number; stdout: Buffer };
        exitCode = e.status;
        stdout = e.stdout.toString();
    }
    const lines = new Set(
        stdout.trim().split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0)
    );
    return { lines, exitCode };
}

async function referenceRun(definition: WorkflowDefinition): Promise<RunStatus> {
    await createDefinition(definition);
    const runId = await startRun(definition.id);
    return waitForRunSettled(runId);
}

// Only checks steps the reference engine reports as 'completed' - a failed
// merge's own trace line can legitimately differ in content between the
// compiled program's append-only stdout log and the reference engine's
// live-corrected status (see Task 3's design note for why).
function assertCompiledContainsCompletedSteps(lines: Set<string>, steps: RunStepStatus[]): void {
    for (const s of steps) {
        if (s.state !== 'completed') continue;
        expect(lines.has(`${s.step}=${s.output ?? ''}`)).toBe(true);
    }
}

function loadFixture(name: string): WorkflowDefinition {
    const raw = fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8');
    return JSON.parse(raw) as WorkflowDefinition;
}

describe('embedded compiler concurrency', () => {
    it('runs multiple independent concurrent chains to completion, matching the reference engine', async () => {
        const definition = loadFixture('multi-entry-no-merge.json');
        const reference = await referenceRun(definition);
        expect(reference.overallState).toBe('completed');

        const { lines, exitCode } = compiledRun(definition);
        expect(exitCode).toBe(0);
        assertCompiledContainsCompletedSteps(lines, reference.steps);
    });

    it('fires a merge exactly once after both predecessors arrive, matching the reference engine', async () => {
        const definition = loadFixture('multi-start-merge-success.json');
        const reference = await referenceRun(definition);
        expect(reference.overallState).toBe('completed');
        const joinEntries = reference.steps.filter((s) => s.step === 'join');
        expect(joinEntries).toHaveLength(2);

        const { lines, exitCode } = compiledRun(definition);
        expect(exitCode).toBe(0);
        assertCompiledContainsCompletedSteps(lines, reference.steps);
    });

    it('dooms a merge when a predecessor fails, leaving an unrelated chain unaffected', async () => {
        const definition = loadFixture('merge-doomed-by-failure.json');

        const reference = await referenceRun(definition);
        expect(reference.overallState).toBe('failed');
        expect(reference.steps.find((s) => s.step === 'unrelated')?.state).toBe('completed');
        expect(reference.steps.find((s) => s.step === 'var-c')?.state).toBe('completed');
        expect(reference.steps.find((s) => s.step === 'boom')?.state).toBe('failed');

        const { lines, exitCode } = compiledRun(definition);
        expect(exitCode).not.toBe(0);
        expect(lines.has('unrelated=standalone-done')).toBe(true);
        expect(lines.has('var-c=from-c')).toBe(true);
        expect([...lines].some((l) => l.startsWith('boom='))).toBe(false);
        expect([...lines].some((l) => l.startsWith('path-a='))).toBe(false);
    });

    it('dooms a merge when a branch excludes one of its predecessors', async () => {
        const definition = loadFixture('branch-excludes-merge.json');

        const reference = await referenceRun(definition);
        expect(reference.overallState).toBe('failed');
        expect(reference.steps.find((s) => s.step === 'path-a')).toBeUndefined();
        expect(reference.steps.find((s) => s.step === 'final')).toBeUndefined();
        expect(reference.steps.find((s) => s.step === 'unrelated')?.state).toBe('completed');

        const { lines, exitCode } = compiledRun(definition);
        expect(exitCode).not.toBe(0);
        expect(lines.has('unrelated=standalone-done')).toBe(true);
        expect(lines.has('var-c=from-c')).toBe(true);
        expect([...lines].some((l) => l.startsWith('path-a='))).toBe(false);
        expect([...lines].some((l) => l.startsWith('final='))).toBe(false);
    });

    it('dooms both merges in a chain from a single branch resolution', async () => {
        const definition = loadFixture('chained-merge-exclude.json');

        const reference = await referenceRun(definition);
        expect(reference.overallState).toBe('failed');
        const m1Ref = reference.steps.filter((s) => s.step === 'm1');
        const m2Ref = reference.steps.filter((s) => s.step === 'm2');
        expect(m1Ref).toHaveLength(1);
        expect(m2Ref).toHaveLength(1);
        expect(m1Ref[0]?.state).toBe('failed');
        expect(m2Ref[0]?.state).toBe('failed');

        const { lines, exitCode } = compiledRun(definition);
        expect(exitCode).not.toBe(0);
        expect(lines.has('var-c=from-c')).toBe(true);
        expect(lines.has('var-d=from-d')).toBe(true);
        expect([...lines].some((l) => l.startsWith('path-a='))).toBe(false);
        expect([...lines].some((l) => l.startsWith('final='))).toBe(false);
    });

    it('flows a merge winner through a second merge to a final step, matching the reference engine', async () => {
        const definition = loadFixture('chained-merge-success.json');
        const reference = await referenceRun(definition);
        expect(reference.overallState).toBe('completed');
        expect(reference.steps.find((s) => s.step === 'final')?.state).toBe('completed');
        expect(reference.steps.find((s) => s.step === 'final')?.output).toBe('done');

        const { lines, exitCode } = compiledRun(definition);
        expect(exitCode).toBe(0);
        assertCompiledContainsCompletedSteps(lines, reference.steps);
    });
});
