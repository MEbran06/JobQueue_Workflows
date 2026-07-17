import type { Branch, Step } from '../../src/types.ts';

export const NODE_W = 185;
export const NODE_H = 66;

export type StepType = Step['type'];

export interface TypeMeta {
  label: string;
  icon: string;
  color: string;
  bg: string;
}

export const TYPE_META: Record<StepType, TypeMeta> = {
  start:        { label: 'Start',        icon: '🚩', color: '#2dd4bf', bg: '#0f766e20' },
  ai_prompt:    { label: 'AI Prompt',    icon: '🤖', color: '#3b82f6', bg: '#1e3a5f20' },
  http_request: { label: 'HTTP Request', icon: '🌐', color: '#10b981', bg: '#06403020' },
  branch:       { label: 'Branch',       icon: '⟐',  color: '#f59e0b', bg: '#78350f20' },
  set_variable: { label: 'Set Variable', icon: '=',  color: '#a78bfa', bg: '#2e106520' },
  code:         { label: 'Code',         icon: '{}', color: '#f472b6', bg: '#50072420' },
  loop:         { label: 'Loop',         icon: '↻',  color: '#4ade80', bg: '#14532d20' },
  merge:        { label: 'Merge',        icon: '⋈',  color: '#818cf8', bg: '#3730a320' },
};

const SLUG: Record<StepType, string> = {
  start: 'start',
  ai_prompt: 'ai',
  http_request: 'http',
  branch: 'branch',
  set_variable: 'var',
  code: 'code',
  loop: 'loop',
  merge: 'merge',
};

export function slugFor(type: StepType): string {
  return SLUG[type];
}

export function defaultConfig(type: StepType): Record<string, string> {
  if (type === 'ai_prompt') return { prompt: '' };
  if (type === 'http_request') return { url: '', method: 'GET' };
  if (type === 'set_variable') return { value: '' };
  if (type === 'code') return { code: 'return context["step-id"];' };
  if (type === 'loop') return { condition: '', loopBackTo: '' };
  return {};
}

export function defaultBranches(): Branch[] {
  return [
    { condition: '', next: '' },
    { condition: 'else', next: '' },
  ];
}
