import { apiClient } from '@/lib/api-client';
import {
  RagQueryRequest,
  RagQueryResponse,
  AgentQueryRequest,
  AgentQueryResponse,
} from '@/types/api.types';

/**
 * RAG 服务
 */
export const ragService = {
  /**
   * 基础 RAG 查询
   */
  async query(request: RagQueryRequest): Promise<RagQueryResponse> {
    return apiClient.post<RagQueryResponse>('/rag/query', request);
  },

  /**
   * Agent 查询
   */
  async agentQuery(request: AgentQueryRequest): Promise<AgentQueryResponse> {
    return apiClient.post<AgentQueryResponse>('/rag/agent', request);
  },

  /**
   * 流式 Agent 查询 (SSE)
   */
  async *agentQueryStream(
    request: AgentQueryRequest,
  ): AsyncGenerator<unknown, void, unknown> {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/rag/agent/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      },
    );

    if (!response.ok) {
      throw new Error(`Stream request failed: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No reader available');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') return;
            try {
              yield JSON.parse(data);
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },
};
