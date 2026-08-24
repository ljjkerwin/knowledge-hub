import { apiClient } from '@/lib/api-client';
import {
  ChatRequest,
  Conversation,
  Message,
  PaginatedResponse,
} from '@/types/api.types';

/**
 * 对话服务
 */
export const conversationService = {
  /**
   * 流式聊天 (SSE)
   */
  async *chatStream(
    request: ChatRequest,
  ): AsyncGenerator<unknown, void, unknown> {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/rag/chat/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(typeof window !== 'undefined' && localStorage.getItem('kh_token')
            ? { Authorization: `Bearer ${localStorage.getItem('kh_token')}` }
            : {}),
        },
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

  /**
   * 获取对话列表
   */
  async listConversations(): Promise<Conversation[]> {
    const res = await apiClient.get<PaginatedResponse<Conversation>>('/rag/conversations');
    return res.items ?? [];
  },

  /**
   * 获取对话历史
   */
  async getHistory(conversationId: string): Promise<Message[]> {
    const res = await apiClient.get<{ conversation: Conversation; messages: Message[] }>(
      `/rag/conversations/${conversationId}/history`,
    );
    return res.messages ?? [];
  },

  /**
   * 删除对话
   */
  async deleteConversation(conversationId: string): Promise<void> {
    return apiClient.delete<void>(`/rag/conversations/${conversationId}`);
  },
};
