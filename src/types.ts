export interface Branch {
    condition: string;
    next: string;
}

export interface Step {
    id: string;
    type: 'start' | 'ai_prompt' | 'http_request' | 'branch' | 'set_variable' | 'code' | 'loop' | 'merge';
    config: Record<string, string>;
    next: string | null;
    branches?: Branch[];
    // Canvas position — UI metadata only, never read during execution.
    x?: number;
    y?: number;
}

export interface WorkflowDefinition {
    id: string;
    name: string;
    entryStepIds: string[];
    steps: Step[];
}

export interface StepJobData {
    definitionId: string;
    runId: string;
    stepId: string;
    context: Record<string, string>;
}

export interface DeadTokenJobData {
    definitionId: string;
    runId: string;
    stepId: string;
}

export interface StepJobResult {
    stepId: string;
    output: string;
    nextJobId: string | null;
    stopped?: boolean;
}