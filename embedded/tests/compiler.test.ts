import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { createDefinition, startRun, waitForRunSettled } from '../../tests/helpers/api.js';
import { generateC } from '../compiler/codegen.js';
import type { WorkflowDefinition } from '../../src/types.js';

const EXE_EXT = process.platform === 'win32' ? '.exe' : '';

async function referenceTrace(definition: WorkflowDefinition): Promise<string[]> {
    await createDefinition(definition);
    const runId = await startRun(definition.id);
    const status = await waitForRunSettled(runId);
    return status.steps.map(s => `${s.step}=${s.output ?? ''}`);
}

function compiledTrace(definition: WorkflowDefinition): string[] {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobqueue-embedded-'));
    const cPath = path.join(tmpDir, 'out.c');
    const exePath = path.join(tmpDir, `out${EXE_EXT}`);
    fs.writeFileSync(cPath, generateC(definition));
    execSync(`gcc "${cPath}" -o "${exePath}"`, { stdio: 'pipe' });
    const stdout = execSync(`"${exePath}"`).toString();
    return stdout.trim().split('\n').map(line => line.replace(/\r$/, '')).filter(line => line.length > 0);
}

function loadFixture(name: string): WorkflowDefinition {
    const raw = fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8');
    return JSON.parse(raw) as WorkflowDefinition;
}

describe('embedded compiler', () => {
    it('compiles and runs a linear chain matching the reference engine', async () => {
        const definition = loadFixture('linear-basic.json');
        const expected = await referenceTrace(definition);
        const actual = compiledTrace(definition);
        expect(actual).toEqual(expected);
    });

    it('compiles and runs a branch matching the reference engine, taking the else path', async () => {
        const definition = loadFixture('branch-basic.json');
        const expected = await referenceTrace(definition);
        const actual = compiledTrace(definition);
        expect(actual).toEqual(expected);
        expect(actual).not.toContain('path-a=from-a'); // the untaken branch never ran
    });

    it('compiles numeric comparisons matching Number()-style strict parsing, not atof()-style lenient parsing', async () => {
        const definition = loadFixture('branch-numeric.json');
        const expected = await referenceTrace(definition);
        const actual = compiledTrace(definition);
        expect(actual).toEqual(expected);
        expect(actual).toContain('path-b=else-taken');
        expect(actual).not.toContain('path-a=less-than-taken');
    });

    it('errors, on both sides, when a taken branch references an unset sibling output', async () => {
        const definition = loadFixture('unset-reference.json');

        await createDefinition(definition);
        const runId = await startRun(definition.id);
        const status = await waitForRunSettled(runId);
        expect(status.overallState).toBe('failed');
        expect(status.steps.find(s => s.step === 'start-1')?.state).toBe('completed');
        expect(status.steps.find(s => s.step === 'the-branch')?.state).toBe('completed');
        expect(status.steps.find(s => s.step === 'path-b')?.state).toBe('failed');

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobqueue-embedded-'));
        const cPath = path.join(tmpDir, 'out.c');
        const exePath = path.join(tmpDir, `out${EXE_EXT}`);
        fs.writeFileSync(cPath, generateC(definition));
        execSync(`gcc "${cPath}" -o "${exePath}"`, { stdio: 'pipe' });

        let stdout = '';
        let exitCode = 0;
        try {
            stdout = execSync(`"${exePath}"`).toString();
        } catch (err) {
            const e = err as { status: number; stdout: Buffer };
            exitCode = e.status;
            stdout = e.stdout.toString();
        }
        expect(exitCode).not.toBe(0);
        expect(stdout.trim().split('\n').map(line => line.replace(/\r$/, '')).filter(line => line.length > 0)).toEqual(['start-1=', 'the-branch=']);
    });

    it('preserves a literal percent sign in a set_variable value without corrupting output', async () => {
        const definition = loadFixture('literal-percent.json');
        const expected = await referenceTrace(definition);
        const actual = compiledTrace(definition);
        expect(actual).toEqual(expected);
        expect(actual).toContain('set-1=100% complete');
    });

    it('does not print a branch trace line before its own condition guard fires', async () => {
        const definition = loadFixture('branch-unset-condition.json');

        await createDefinition(definition);
        const runId = await startRun(definition.id);
        const status = await waitForRunSettled(runId);
        expect(status.overallState).toBe('failed');
        expect(status.steps.find((s) => s.step === 'start-1')?.state).toBe('completed');
        expect(status.steps.find((s) => s.step === 'branch-1')?.state).toBe('completed');
        expect(status.steps.find((s) => s.step === 'branch-2')?.state).toBe('failed');

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobqueue-embedded-'));
        const cPath = path.join(tmpDir, 'out.c');
        const exePath = path.join(tmpDir, `out${EXE_EXT}`);
        fs.writeFileSync(cPath, generateC(definition));
        execSync(`gcc "${cPath}" -o "${exePath}"`, { stdio: 'pipe' });

        let stdout = '';
        let exitCode = 0;
        try {
            stdout = execSync(`"${exePath}"`).toString();
        } catch (err) {
            const e = err as { status: number; stdout: Buffer };
            exitCode = e.status;
            stdout = e.stdout.toString();
        }
        expect(exitCode).not.toBe(0);
        const lines = stdout.trim().split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0);
        expect(lines).toEqual(['start-1=', 'branch-1=']);
    });
});
