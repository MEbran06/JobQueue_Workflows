import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = path.join(__dirname, 'codeRunner.js');

// Longer than codeRunner.js's own in-vm timeout (5000ms) so that timeout
// gets a chance to fire first and produce a clean error. This one is the
// backstop for cases a synchronous vm timeout can't catch (e.g. code that
// yields to the event loop between spins).
const HARD_TIMEOUT_MS = 7000;

interface RunnerMessage {
    output?: string;
    error?: string;
}

export function runSandboxed(code: string, context: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = fork(RUNNER_PATH, [], {
            env: {},
            execArgv: ['--max-old-space-size=64'],
        });

        let settled = false;

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill('SIGKILL');
            reject(new Error('Code step timed out'));
        }, HARD_TIMEOUT_MS);

        child.once('message', (msg: RunnerMessage) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            child.kill();
            if (msg.error) reject(new Error(msg.error));
            else resolve(msg.output ?? '');
        });

        child.once('error', (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(err);
        });

        child.once('exit', (exitCode) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(new Error(`Code step process exited unexpectedly (code ${exitCode})`));
        });

        child.send({ code, context });
    });
}
