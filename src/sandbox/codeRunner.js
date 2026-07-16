// Runs as its own OS process (forked by runSandboxed.ts), one execution per
// process. Deliberately plain JS, not TypeScript — this lets it be forked
// directly with plain `node`, no tsx/build step involved.
//
// vm.createContext() gives a fresh global object with none of Node's
// ambient globals (process, require, fetch, Buffer, console, setTimeout are
// all simply undefined here) — `context` is the only thing placed in scope.
import vm from 'node:vm';

process.on('message', (msg) => {
    try {
        const sandbox = { context: msg.context };
        vm.createContext(sandbox);
        const wrapped = `(function () {\n${msg.code}\n})()`;
        const script = new vm.Script(wrapped);
        const result = script.runInContext(sandbox, { timeout: 5000 });
        process.send({ output: String(result ?? '') });
    } catch (err) {
        process.send({ error: err instanceof Error ? err.message : String(err) });
    } finally {
        process.exit(0);
    }
});
