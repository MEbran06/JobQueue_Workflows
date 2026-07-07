import Anthropic from '@anthropic-ai/sdk';
import type { Step } from './types.js';

const anthropic = new Anthropic();

function interpolate(template: string, context: Record<string, string>): string {
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

        default: {
            const exhaustive: never = step.type;
            throw new Error(`Unknown step type: ${exhaustive}`);
        }
    }
}