import type { Step } from '../../src/types.js';

// Maps every step id to a valid C identifier for use in generated function
// names. Purely cosmetic - runtime dispatch never depends on these strings,
// only on compile-time-assigned integer indices (see codegen.ts) - but two
// step ids sanitizing to the same identifier would still produce a C file
// with a duplicate function name, so collisions are caught here with a clear
// message instead of surfacing as a confusing gcc error later.
export function sanitizeStepIds(steps: Step[]): Map<string, string> {
    const result = new Map<string, string>();
    const seen = new Map<string, string>(); // sanitized -> original, for collision messages
    for (const step of steps) {
        const sanitized = step.id.replace(/[^a-zA-Z0-9_]/g, '_');
        const existing = seen.get(sanitized);
        if (existing && existing !== step.id) {
            throw new Error(`Step ids "${existing}" and "${step.id}" both sanitize to "${sanitized}" - rename one`);
        }
        seen.set(sanitized, step.id);
        result.set(step.id, sanitized);
    }
    return result;
}
