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
    return stdout.trim().split('\n').filter(line => line.length > 0);
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
});
