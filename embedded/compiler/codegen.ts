import type { WorkflowDefinition, Step } from '../../src/types.js';
import { sanitizeStepIds } from './identifiers.js';

const SUPPORTED_TYPES = new Set(['start', 'set_variable']);
const REFERENCE_RE = /\{\{([\w-]+)\}\}/g;

function validateScope(definition: WorkflowDefinition): void {
    if (definition.entryStepIds.length !== 1) {
        throw new Error(`Expected exactly 1 entry step, got ${definition.entryStepIds.length}`);
    }
    for (const step of definition.steps) {
        if (!SUPPORTED_TYPES.has(step.type)) {
            throw new Error(`Step "${step.id}" has unsupported type "${step.type}" (only start/set_variable are supported so far)`);
        }
    }
}

interface WalkResult {
    order: Step[];
    index: Map<string, number>;
}

// Same visited-set graph walk src/executor.ts's findDownstreamMergeSteps
// already uses, adapted to assign each step a dense integer the first time
// it's visited (BFS order) instead of just collecting matches.
function walkGraph(definition: WorkflowDefinition): WalkResult {
    const byId = new Map(definition.steps.map(s => [s.id, s]));
    const index = new Map<string, number>();
    const order: Step[] = [];
    const queue = [definition.entryStepIds[0]];

    while (queue.length) {
        const stepId = queue.shift()!;
        if (index.has(stepId)) continue;
        const step = byId.get(stepId);
        if (!step) throw new Error(`Referenced step "${stepId}" does not exist in this definition`);
        index.set(stepId, order.length);
        order.push(step);
        if (step.next) queue.push(step.next);
        for (const b of step.branches ?? []) if (b.next) queue.push(b.next);
    }

    return { order, index };
}

function extractReferences(template: string): string[] {
    const refs: string[] = [];
    for (const match of template.matchAll(REFERENCE_RE)) {
        refs.push(match[1]);
    }
    return refs;
}

// Weaker than the Node engine's runtime interpolate()/evaluateCondition()
// checks on purpose: this only confirms the referenced id exists somewhere
// in the definition, not that it's guaranteed to have run first (e.g. it
// could be a mutually-exclusive branch sibling). That stronger guarantee is
// deferred to codegen's per-read check_set() runtime guard - see Task 2/3.
function validateReferences(order: Step[], index: Map<string, number>): void {
    for (const step of order) {
        const templates: string[] = [];
        if (step.type === 'set_variable') templates.push(step.config['value'] ?? '');
        for (const b of step.branches ?? []) templates.push(b.condition);

        for (const template of templates) {
            for (const ref of extractReferences(template)) {
                if (!index.has(ref)) {
                    throw new Error(`Step "${step.id}" references "${ref}", which does not exist in this definition`);
                }
            }
        }
    }
}

interface CompiledTemplate {
    format: string;
    refIndexes: number[];
}

// Compiles a `{{step-id}}` template into a printf-style format string plus
// the ctx->outputs[] indexes to pass as %s arguments, in order. Used
// uniformly for every set_variable value, whether or not it actually
// contains a reference - one code path, no special-casing plain literals.
function compileTemplate(template: string, index: Map<string, number>): CompiledTemplate {
    const refIndexes: number[] = [];
    const format = template.replace(REFERENCE_RE, (_match, key: string) => {
        const idx = index.get(key);
        if (idx === undefined) {
            throw new Error(`Template references "${key}", which does not exist in this definition`);
        }
        refIndexes.push(idx);
        return '%s';
    });
    return { format, refIndexes };
}

function resolveNext(fromStepId: string, next: string | null, index: Map<string, number>): number {
    if (next === null) return -1;
    const idx = index.get(next);
    if (idx === undefined) {
        throw new Error(`Step "${fromStepId}" points to "${next}", which is not reachable from the entry step`);
    }
    return idx;
}

function generateStepFunction(step: Step, index: Map<string, number>, names: Map<string, string>): string {
    const myIndex = index.get(step.id)!;
    const fnName = `step_${names.get(step.id)}`;

    if (step.type === 'start') {
        return `int ${fnName}(Context *ctx) {
    ctx->outputs[${myIndex}] = "";
    printf("%s=%s\\n", STEP_NAMES[${myIndex}], ctx->outputs[${myIndex}]);
    return ${resolveNext(step.id, step.next, index)};
}`;
    }

    if (step.type === 'set_variable') {
        const value = step.config['value'] ?? '';
        const { format, refIndexes } = compileTemplate(value, index);
        const bufName = `buf_${names.get(step.id)}`;
        const guards = refIndexes.map(i => `    check_set(ctx, ${i});\n`).join('');
        const argsStr = refIndexes.map(i => `, ctx->outputs[${i}]`).join('');
        return `static char ${bufName}[MAX_OUTPUT_LEN];

int ${fnName}(Context *ctx) {
${guards}    snprintf(${bufName}, MAX_OUTPUT_LEN, ${JSON.stringify(format)}${argsStr});
    ctx->outputs[${myIndex}] = ${bufName};
    printf("%s=%s\\n", STEP_NAMES[${myIndex}], ctx->outputs[${myIndex}]);
    return ${resolveNext(step.id, step.next, index)};
}`;
    }

    throw new Error(`Unsupported step type "${step.type}" reached codegen (should have been caught by validateScope)`);
}

export function generateC(definition: WorkflowDefinition): string {
    validateScope(definition);
    const { order, index } = walkGraph(definition);
    validateReferences(order, index);
    const names = sanitizeStepIds(order);

    const stepNamesLiteral = order.map(step => JSON.stringify(step.id)).join(', ');
    const stepFns = order.map(step => generateStepFunction(step, index, names));
    const tableEntries = order.map(step => `step_${names.get(step.id)}`).join(', ');

    return `#include <stdio.h>
#include <stdlib.h>

#define MAX_OUTPUT_LEN 256

typedef struct { char *outputs[${order.length}]; } Context;

static const char *STEP_NAMES[] = { ${stepNamesLiteral} };

static void check_set(Context *ctx, int idx) {
    if (ctx->outputs[idx] == NULL) {
        fprintf(stderr, "step \\"%s\\" has no output yet\\n", STEP_NAMES[idx]);
        exit(1);
    }
}

${stepFns.join('\n\n')}

typedef int (*StepFn)(Context*);
static const StepFn STEP_TABLE[] = { ${tableEntries} };

int main(void) {
    Context ctx = {0};
    int current = 0;
    while (current >= 0) {
        current = STEP_TABLE[current](&ctx);
    }
    return 0;
}
`;
}
