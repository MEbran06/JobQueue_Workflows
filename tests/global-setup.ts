import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const TEST_DB_DIR = path.join(repoRoot, '.test-data');
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'workflows.db');
const TEST_REDIS_URL = 'redis://localhost:6380';
const TEST_PORT = '3100';
export const TEST_BASE_URL = `http://localhost:${TEST_PORT}`;

// Test-only Docker Compose project name, distinct from the dev stack's
// (which defaults to the directory name, "jobqueue"). Without this, `docker
// compose -f docker-compose.test.yml` shares the dev stack's project
// namespace and treats its running containers as orphans of this project.
const COMPOSE_PROJECT = 'jobqueue-test';

// tsx's own CLI re-execs node with loader flags internally (one process
// becomes two), so even spawning it directly (bypassing npx/shell, which
// would add further wrapper layers) still leaves a subprocess `child.kill()`
// alone won't reach. killProcessTree below handles that.
const TSX_CLI = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

function spawnTsx(scriptPath: string, env: NodeJS.ProcessEnv): ChildProcess {
    return spawn(process.execPath, [TSX_CLI, scriptPath], {
        cwd: repoRoot,
        env,
        stdio: 'inherit',
        detached: process.platform !== 'win32',
    });
}

function killProcessTree(child: ChildProcess): void {
    if (!child.pid) return;
    try {
        if (process.platform === 'win32') {
            execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
        } else {
            process.kill(-child.pid, 'SIGKILL');
        }
    } catch {
        // Already exited - nothing to clean up.
    }
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        function attempt(): void {
            const socket = createConnection({ port, host: '127.0.0.1' });
            socket.once('connect', () => { socket.end(); resolve(); });
            socket.once('error', () => {
                socket.destroy();
                if (Date.now() > deadline) reject(new Error(`Timed out waiting for port ${port}`));
                else setTimeout(attempt, 200);
            });
        }
        attempt();
    });
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            await fetch(url);
            return;
        } catch {
            await new Promise((r) => setTimeout(r, 200));
        }
    }
    throw new Error(`Timed out waiting for ${url}`);
}

export default async function globalSetup(): Promise<() => Promise<void>> {
    execSync(`docker compose -f docker-compose.test.yml -p ${COMPOSE_PROJECT} up -d`, { cwd: repoRoot, stdio: 'inherit' });
    await waitForPort(6380, 15_000);

    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });

    const childEnv = {
        ...process.env,
        REDIS_URL: TEST_REDIS_URL,
        DB_PATH: TEST_DB_PATH,
    };

    const server = spawnTsx('src/server.ts', { ...childEnv, PORT: TEST_PORT });
    const worker = spawnTsx('src/worker.ts', childEnv);

    await waitForHttp(`${TEST_BASE_URL}/definitions`, 10_000);

    process.env.TEST_BASE_URL = TEST_BASE_URL;

    return async () => {
        killProcessTree(server);
        killProcessTree(worker);
        execSync(`docker compose -f docker-compose.test.yml -p ${COMPOSE_PROJECT} down -v`, { cwd: repoRoot, stdio: 'inherit' });
    };
}