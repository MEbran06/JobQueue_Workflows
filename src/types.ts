export interface Branch {
    condition: string;
    next: string;
}

export interface LoopState {
    items: string[];
    index: number;
    loopVar: string;
    bodyStepId: string;
    afterLoopStepId: string | null;
}

export interface Step {
    id: string;
    type: 'ai_prompt' | 'http_request' | 'branch' | 'set_variable' | 'code' | 'loop';
    config: Record<string, string>;
    next: string | null;
    branches?: Branch[];
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
    loopState?: LoopState;
}