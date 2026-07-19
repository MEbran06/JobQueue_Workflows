import type { WorkflowDefinition, Step } from '../../src/types.js';
import { sanitizeStepIds } from './identifiers.js';

const SUPPORTED_TYPES = new Set(['start', 'set_variable', 'branch', 'merge']);
const REFERENCE_RE = /\{\{([\w-]+)\}\}/g;
const CONDITION_RE = /^\{\{([\w-]+)\}\}\s+(contains|equals|notEquals|startsWith|lessThan|greaterThan)\s+(.+)$/;

function validateScope(definition: WorkflowDefinition): void {
    if (definition.entryStepIds.length < 1) {
        throw new Error(`Expected at least 1 entry step, got ${definition.entryStepIds.length}`);
    }
    for (const step of definition.steps) {
        if (!SUPPORTED_TYPES.has(step.type)) {
            throw new Error(`Step "${step.id}" has unsupported type "${step.type}" (only start/set_variable/branch are supported so far)`);
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
    const queue = [...definition.entryStepIds];

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

function computeMergeIndices(order: Step[]): Map<string, number> {
    const mergeIndex = new Map<string, number>();
    for (const step of order) {
        if (step.type === 'merge') mergeIndex.set(step.id, mergeIndex.size);
    }
    return mergeIndex;
}

// Matches src/worker.ts's exact rule: `definition.steps.filter(s => s.next === stepId).length`.
// Only `.next` counts, never `.branches[].next` - the reference engine never counts branch
// edges toward a merge's expected arrivals, and no existing workflow relies on it either.
function computeExpectedCounts(order: Step[], mergeIndex: Map<string, number>): number[] {
    const counts = new Array<number>(mergeIndex.size).fill(0);
    for (const step of order) {
        if (step.next && mergeIndex.has(step.next)) {
            counts[mergeIndex.get(step.next)!]++;
        }
    }
    return counts;
}

// For every step (by its dense step index), the complete, already-transitively-
// closed set of merge indices that become doomed if that step never runs. Computed
// once per compile via memoized DFS (the graph is acyclic - no loop steps exist),
// so runtime doom-propagation never needs to walk the graph itself.
function computeDownstreamMerges(order: Step[], byId: Map<string, Step>, mergeIndex: Map<string, number>): number[][] {
    const memo = new Map<string, Set<number>>();
    function compute(stepId: string): Set<number> {
        if (memo.has(stepId)) return memo.get(stepId)!;
        const result = new Set<number>();
        memo.set(stepId, result);
        const step = byId.get(stepId)!;
        const successors = [step.next, ...(step.branches ?? []).map(b => b.next)].filter((s): s is string => !!s);
        for (const succ of successors) {
            const succStep = byId.get(succ)!;
            if (succStep.type === 'merge') result.add(mergeIndex.get(succ)!);
            for (const m of compute(succ)) result.add(m);
        }
        return result;
    }
    return order.map(step => [...compute(step.id)].sort((a, b) => a - b));
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
    let format = '';
    let lastIndex = 0;
    for (const match of template.matchAll(REFERENCE_RE)) {
        const literal = template.slice(lastIndex, match.index);
        format += literal.replace(/%/g, '%%');
        const key = match[1];
        const idx = index.get(key);
        if (idx === undefined) {
            throw new Error(`Template references "${key}", which does not exist in this definition`);
        }
        refIndexes.push(idx);
        format += '%s';
        lastIndex = match.index! + match[0].length;
    }
    format += template.slice(lastIndex).replace(/%/g, '%%');
    return { format, refIndexes };
}

interface CompiledCondition {
    expr: string;
    refIndex: number;
}

// Same operator semantics as evaluateCondition in src/executor.ts:
// case-insensitive string comparison, numeric comparison via parsed floats.
// Uses hand-rolled ci_equals/ci_starts_with/ci_contains (see the generated
// preamble below) instead of strcasecmp/strcasestr, which aren't guaranteed
// available on every C toolchain.
function compileCondition(condition: string, index: Map<string, number>): CompiledCondition {
    const match = condition.match(CONDITION_RE);
    if (!match) {
        throw new Error(`Condition "${condition}" is not recognized (expected "{{step}} operator value" or "else")`);
    }
    const [, variable, operator, rawValue] = match;
    const refIndex = index.get(variable);
    if (refIndex === undefined) {
        throw new Error(`Condition references "${variable}", which does not exist in this definition`);
    }
    const literal = JSON.stringify(rawValue.trim());
    const ref = `ctx->outputs[${refIndex}]`;

    switch (operator) {
        case 'equals':      return { expr: `ci_equals(${ref}, ${literal})`, refIndex };
        case 'notEquals':   return { expr: `!ci_equals(${ref}, ${literal})`, refIndex };
        case 'contains':    return { expr: `ci_contains(${ref}, ${literal})`, refIndex };
        case 'startsWith':  return { expr: `ci_starts_with(${ref}, ${literal})`, refIndex };
        case 'lessThan':    return { expr: `numeric_lt(${ref}, ${literal})`, refIndex };
        case 'greaterThan': return { expr: `numeric_gt(${ref}, ${literal})`, refIndex };
        default:            throw new Error(`Unknown operator "${operator}"`);
    }
}

function resolveNext(fromStepId: string, next: string | null, index: Map<string, number>): number {
    if (next === null) return -1;
    const idx = index.get(next);
    if (idx === undefined) {
        throw new Error(`Step "${fromStepId}" points to "${next}", which is not reachable from the entry step`);
    }
    return idx;
}

function generateStepFunction(step: Step, index: Map<string, number>, names: Map<string, string>, mergeIndex: Map<string, number>, downstreamMerges: number[][]): string {
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
        const guards = refIndexes.map(i => `    if (!check_set(ctx, ${i})) { doom_downstream(${myIndex}); atomic_store(&run_failed, 1); return -1; }\n`).join('');
        const argsStr = refIndexes.map(i => `, ctx->outputs[${i}]`).join('');
        return `static char ${bufName}[MAX_OUTPUT_LEN];

int ${fnName}(Context *ctx) {
${guards}    snprintf(${bufName}, MAX_OUTPUT_LEN, ${JSON.stringify(format)}${argsStr});
    ctx->outputs[${myIndex}] = ${bufName};
    printf("%s=%s\\n", STEP_NAMES[${myIndex}], ctx->outputs[${myIndex}]);
    return ${resolveNext(step.id, step.next, index)};
}`;
    }

    if (step.type === 'branch') {
        const branches = step.branches ?? [];
        const allTargets = branches.map(b => resolveNext(step.id, b.next, index));
        const setAndReturn = (chosenTarget: number) => {
            const excludedTargets = allTargets.filter(t => t !== chosenTarget);
            const doomCalls = excludedTargets
                .map(t => `    doom_downstream(${t});\n`)
                .join('');
            const hasExcludedDownstream = excludedTargets.some(t => downstreamMerges[t].length > 0);
            const setRunFailed = hasExcludedDownstream ? `    atomic_store(&run_failed, 1);\n` : '';
            return `${doomCalls}${setRunFailed}    ctx->outputs[${myIndex}] = "";\n    printf("%s=%s\\n", STEP_NAMES[${myIndex}], ctx->outputs[${myIndex}]);\n    return ${chosenTarget};`;
        };
        const lines: string[] = [];
        let hasElse = false;
        for (const b of branches) {
            const targetIndex = resolveNext(step.id, b.next, index);
            if (b.condition.trim() === 'else') {
                hasElse = true;
                lines.push(setAndReturn(targetIndex));
                break;
            }
            const compiled = compileCondition(b.condition, index);
            lines.push(`    if (!check_set(ctx, ${compiled.refIndex})) { doom_downstream(${myIndex}); atomic_store(&run_failed, 1); return -1; }\n    if (${compiled.expr}) {\n${setAndReturn(targetIndex)}\n    }`);
        }
        if (!hasElse) {
            lines.push(`    no_matching_branch(STEP_NAMES[${myIndex}]);\n    doom_downstream(${myIndex});\n    atomic_store(&run_failed, 1);\n    return -1;`);
        }
        return `int ${fnName}(Context *ctx) {
${lines.join('\n')}
}`;
    }

    if (step.type === 'merge') {
        const m = mergeIndex.get(step.id)!;
        const bufName = `buf_${names.get(step.id)}`;
        return `static char ${bufName}[MAX_OUTPUT_LEN];

int ${fnName}(Context *ctx) {
    pthread_mutex_lock(&merge_mutex[${m}]);
    if (merge_doomed[${m}]) {
        pthread_mutex_unlock(&merge_mutex[${m}]);
        return -1;
    }
    int arrivalCount = ++merge_arrivals[${m}];
    int isLast = (arrivalCount == MERGE_EXPECTED[${m}]);
    pthread_mutex_unlock(&merge_mutex[${m}]);

    if (!isLast) {
        printf("%s=merge: waiting (%d/%d arrived)\\n", STEP_NAMES[${myIndex}], arrivalCount, MERGE_EXPECTED[${m}]);
        return -1;
    }
    snprintf(${bufName}, MAX_OUTPUT_LEN, "merge: combined %d arrivals", MERGE_EXPECTED[${m}]);
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

    const byId = new Map(definition.steps.map(s => [s.id, s]));
    const mergeIndex = computeMergeIndices(order);
    const expectedCounts = computeExpectedCounts(order, mergeIndex);
    const numMerges = mergeIndex.size;
    const downstreamMerges = computeDownstreamMerges(order, byId, mergeIndex);
    const downstreamArrays = downstreamMerges
        .map((merges, i) => (merges.length ? `static const int DOWNSTREAM_MERGES_${i}[] = { ${merges.join(', ')} };` : ''))
        .filter(Boolean)
        .join('\n');
    const downstreamTableLiteral = downstreamMerges.map((merges, i) => (merges.length ? `DOWNSTREAM_MERGES_${i}` : 'NULL')).join(', ');
    const downstreamCountsLiteral = downstreamMerges.map(merges => merges.length).join(', ');

    const stepNamesLiteral = order.map(step => JSON.stringify(step.id)).join(', ');
    const stepFns = order.map(step => generateStepFunction(step, index, names, mergeIndex, downstreamMerges));
    const tableEntries = order.map(step => `step_${names.get(step.id)}`).join(', ');
    const entryIndices = definition.entryStepIds.map(id => index.get(id)!);
    const entryIndicesLiteral = entryIndices.join(', ');
    const expectedCountsLiteral = expectedCounts.join(', ');

    return `#include <stdio.h>
#include <stdlib.h>
#include <ctype.h>
#include <pthread.h>
#include <stdatomic.h>

#define MAX_OUTPUT_LEN 256
#define NUM_ENTRIES ${entryIndices.length}
#define NUM_MERGES ${numMerges}

typedef struct { char *outputs[${order.length}]; } Context;

static Context ctx;
static const char *STEP_NAMES[] = { ${stepNamesLiteral} };
static const int MERGE_EXPECTED[] = { ${numMerges > 0 ? expectedCountsLiteral : '0'} };
static pthread_mutex_t merge_mutex[NUM_MERGES > 0 ? NUM_MERGES : 1] = { PTHREAD_MUTEX_INITIALIZER };
static int merge_arrivals[NUM_MERGES > 0 ? NUM_MERGES : 1];
static int merge_doomed[NUM_MERGES > 0 ? NUM_MERGES : 1];
static atomic_int run_failed = 0;

${downstreamArrays}
static const int *DOWNSTREAM_MERGES[] = { ${downstreamTableLiteral} };
static const int DOWNSTREAM_MERGES_COUNT[] = { ${downstreamCountsLiteral} };

static void doom_downstream(int stepIndex) {
    for (int i = 0; i < DOWNSTREAM_MERGES_COUNT[stepIndex]; i++) {
        int m = DOWNSTREAM_MERGES[stepIndex][i];
        pthread_mutex_lock(&merge_mutex[m]);
        merge_doomed[m] = 1;
        pthread_mutex_unlock(&merge_mutex[m]);
    }
}

static int check_set(Context *ctx, int idx) {
    if (ctx->outputs[idx] == NULL) {
        fprintf(stderr, "step \\"%s\\" has no output yet\\n", STEP_NAMES[idx]);
        return 0;
    }
    return 1;
}

static int ci_equals(const char *a, const char *b) {
    while (*a && *b) {
        if (tolower((unsigned char)*a) != tolower((unsigned char)*b)) return 0;
        a++; b++;
    }
    return *a == *b;
}

static int ci_starts_with(const char *s, const char *prefix) {
    while (*prefix) {
        if (*s == '\\0' || tolower((unsigned char)*s) != tolower((unsigned char)*prefix)) return 0;
        s++; prefix++;
    }
    return 1;
}

static int ci_contains(const char *haystack, const char *needle) {
    if (*needle == '\\0') return 1;
    for (const char *h = haystack; *h; h++) {
        if (ci_starts_with(h, needle)) return 1;
    }
    return 0;
}

static void no_matching_branch(const char *stepName) {
    fprintf(stderr, "No matching branch condition in step \\"%s\\"\\n", stepName);
}

static int strict_parse_double(const char *s, double *out) {
    while (isspace((unsigned char)*s)) s++;
    if (*s == '\\0') { *out = 0.0; return 1; }
    char *endptr;
    double value = strtod(s, &endptr);
    if (endptr == s) return 0;
    while (isspace((unsigned char)*endptr)) endptr++;
    if (*endptr != '\\0') return 0;
    *out = value;
    return 1;
}

static int numeric_lt(const char *a, const char *b) {
    double x, y;
    if (!strict_parse_double(a, &x) || !strict_parse_double(b, &y)) return 0;
    return x < y;
}

static int numeric_gt(const char *a, const char *b) {
    double x, y;
    if (!strict_parse_double(a, &x) || !strict_parse_double(b, &y)) return 0;
    return x > y;
}

${stepFns.join('\n\n')}

typedef int (*StepFn)(Context*);
static const StepFn STEP_TABLE[] = { ${tableEntries} };

static int entry_indices[NUM_ENTRIES] = { ${entryIndicesLiteral} };

void *chain_thread(void *arg) {
    int current = *(int *)arg;
    while (current >= 0) {
        current = STEP_TABLE[current](&ctx);
    }
    return NULL;
}

int main(void) {
    pthread_t threads[NUM_ENTRIES];
    for (int i = 0; i < NUM_ENTRIES; i++) {
        pthread_create(&threads[i], NULL, chain_thread, &entry_indices[i]);
    }
    for (int i = 0; i < NUM_ENTRIES; i++) {
        pthread_join(threads[i], NULL);
    }
    return atomic_load(&run_failed) ? 1 : 0;
}
`;
}
