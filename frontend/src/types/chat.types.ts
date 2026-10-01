import type { UIMessage } from 'ai';
import type { Citation, Message } from './api.types';
import type { AgentWorkflow } from './workflow.types';

export type { AgentWorkflow, AgentWorkflowRound } from './workflow.types';

export interface ChatMessageMetadata {
  conversationId?: string;
  queryId?: string;
  totalIterations?: number;
  createdAt?: string;
}

export type ChatDataParts = {
  conversation: {
    conversationId: string;
    title: string;
  };
  status: {
    text: string;
  };
  workflow: AgentWorkflow;
  citations: Citation[];
};

export type KnowledgeUIMessage = UIMessage<
  ChatMessageMetadata,
  ChatDataParts
>;

export function toUIMessage(message: Message): KnowledgeUIMessage {
  return {
    id: message.id,
    role: message.role,
    metadata: {
      conversationId: message.conversationId,
      queryId: message.queryId,
      createdAt: message.createdAt,
    },
    parts: [
      { type: 'text', text: message.content },
      ...(message.citations?.length
        ? ([
            {
              type: 'data-citations',
              id: `citations-${message.id}`,
              data: message.citations,
            },
          ] satisfies KnowledgeUIMessage['parts'])
        : []),
      ...(message.workflow
        ? ([
            {
              type: 'data-workflow',
              id: `workflow-${message.id}`,
              data: message.workflow,
            },
          ] satisfies KnowledgeUIMessage['parts'])
        : []),
    ],
  };
}

export function getMessageText(message: KnowledgeUIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

export function getMessageCitations(
  message: KnowledgeUIMessage,
): Citation[] {
  return (
    message.parts.find((part) => part.type === 'data-citations')?.data ?? []
  );
}

export function getMessageStatus(message: KnowledgeUIMessage): string {
  return message.parts.find((part) => part.type === 'data-status')?.data.text ?? '';
}

export function getMessageWorkflow(
  message: KnowledgeUIMessage,
): AgentWorkflow | undefined {
  return message.parts.find((part) => part.type === 'data-workflow')?.data;
}
