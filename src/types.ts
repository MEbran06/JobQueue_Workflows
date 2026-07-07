export interface Step {
    id: string;
    type: 'ai_prompt' | 'http_request';
    config: Record<string, string>;
    next: string | null;
}

export interface WorkflowDefinition {
    id: string;
    name: string;
    entryStepId: string;
    steps: Step[];
}

export interface StepJobData {
    definitionId: string;
    runId: string;
    stepId: string;
    context: Record<string, string>;
}