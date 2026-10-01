export interface AgentWorkflowRound {
  iteration: number;
  source: 'knowledge_base' | 'web';
  query: string;
  status: 'running' | 'completed';
  verdict?: 'sufficient' | 'partial' | 'irrelevant' | 'empty';
  acceptedCount?: number;
}

export interface AgentWorkflow {
  analysis: 'running' | 'completed';
  rounds: AgentWorkflowRound[];
  generation: 'pending' | 'running' | 'completed';
  statusText: string;
  completed: boolean;
}
