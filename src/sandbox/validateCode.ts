import { parse } from 'acorn';

// Risk mitigation, not a guarantee: a purely name-based check can't catch
// dynamically-constructed property access (e.g. foo['con'+'structor']).
// This is layer 1 of 3 — see runSandboxed.ts / codeRunner.js for the
// process-isolation and restricted-context layers that bound the damage
// even if this layer is bypassed.
const BLOCKED_IDENTIFIERS = new Set([
    'process', 'require', 'global', 'globalThis',
    'Function', 'eval', 'module', '__dirname', '__filename',
]);

type AstNode = { type: string; [key: string]: unknown };

export function validateCode(code: string): void {
    // The code is a function body (bare `return` statements, per the
    // convention in frontend/src/constants.ts's defaultConfig), not a
    // standalone script — wrap it the same way codeRunner.js does before
    // executing, so parsing here matches what actually runs.
    const wrapped = `(function () {\n${code}\n})`;
    let ast: AstNode;
    try {
        ast = parse(wrapped, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as AstNode;
    } catch (err) {
        throw new Error(`Code step has a syntax error: ${err instanceof Error ? err.message : String(err)}`);
    }
    walk(ast);
}

function walk(node: unknown): void {
    if (!node || typeof node !== 'object' || typeof (node as AstNode).type !== 'string') return;
    const n = node as AstNode;

    if (n.type === 'Identifier' && BLOCKED_IDENTIFIERS.has(n.name as string)) {
        throw new Error(`Code step may not reference "${n.name as string}"`);
    }

    if (n.type === 'MemberExpression') {
        const property = n.property as AstNode;
        const accessesConstructor =
            (!n.computed && property.type === 'Identifier' && property.name === 'constructor') ||
            (Boolean(n.computed) && property.type === 'Literal' && property.value === 'constructor');
        if (accessesConstructor) {
            throw new Error('Code step may not access ".constructor"');
        }
    }

    if (n.type === 'ImportExpression') {
        throw new Error('Code step may not use dynamic import()');
    }

    for (const key of Object.keys(n)) {
        if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
        const value = n[key];
        if (Array.isArray(value)) {
            value.forEach(walk);
        } else if (value && typeof value === 'object') {
            walk(value);
        }
    }
}
