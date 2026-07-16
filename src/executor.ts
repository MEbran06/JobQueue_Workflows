import Anthropic from '@anthropic-ai/sdk';
import type { Step } from './types.js';

export function evaluateCondition(condition: string, context: Record<string, string>): boolean {
    if (condition.trim() === 'else') return true;
    const match = condition.match(/\{\{(\w+)\}\}\s+(contains|equals|notEquals|startsWith|lessThan|greaterThan)\s+(.+)/);
    if (!match) return false;
    const [, variable, operator, value] = match;
    const contextValue = (context[variable] ?? '').toLowerCase();
    const compareValue = value.trim().toLowerCase();
    switch (operator) {
        case 'contains':     return contextValue.includes(compareValue);
        case 'equals':       return contextValue === compareValue;
        case 'notEquals':    return contextValue !== compareValue;
        case 'startsWith':   return contextValue.startsWith(compareValue);
        case 'lessThan':     return Number(contextValue) < Number(compareValue);
        case 'greaterThan':  return Number(contextValue) > Number(compareValue);
        default:             return false;
    }
}

export function evaluateBranch(step: Step, context: Record<string, string>): string {
    const branches = step.branches ?? [];
    for (const branch of branches) {
        if (evaluateCondition(branch.condition, context)) return branch.next;
    }
    throw new Error(`No matching branch condition in step "${step.id}"`);
}

const anthropic = new Anthropic();

export function interpolate(template: string, context: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => context[key] ?? `{{${key}}}`);
}

function interpolateConfig(config: Record<string, string>, context: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(config).map(([k, v]) => [k, interpolate(v, context)])
    );
}

export async function executeStep(step: Step, context: Record<string, string>): Promise<string> {
    const config = interpolateConfig(step.config, context);

    switch (step.type) {
        case 'ai_prompt': {
            const message = await anthropic.messages.create({
                model: 'claude-opus-4-8',
                max_tokens: 1024,
                messages: [{ role: 'user', content: config['prompt'] ?? '' }],
            });
            return message.content[0]?.type === 'text' ? message.content[0].text : '';
        }

        case 'http_request': {
            const response = await fetch(config['url'] ?? '', {
                method: config['method'] ?? 'GET',
                body: config['body'],
            });
            return response.text();
        }

        case 'set_variable':
            return config['value'] ?? '';

        case 'code': {
            // new Function is intentional: user-defined code step, local use only
            const fn = new Function('context', config['code'] ?? 'return ""') as (ctx: Record<string, string>) => unknown;
            return String(fn(context) ?? '');
        }

        case 'branch':
        case 'loop':
            throw new Error(`"${step.type}" steps are handled by the worker, not executeStep`);

        default: {
            const exhaustive: never = step.type;
            throw new Error(`Unknown step type: ${exhaustive}`);
        }
    }
}