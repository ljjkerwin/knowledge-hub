import { apiClient } from '@/lib/api-client';
import {
  Conversation,
  Message,
  PaginatedResponse,
} from '@/types/api.types';

/**
 * 对话服务
 */
export const conversationService = {
  /**
   * 获取对话列表
   */
  async listConversations(page = 1, pageSize = 20): Promise<PaginatedResponse<Conversation>> {
    return apiClient.get<PaginatedResponse<Conversation>>('/rag/conversations', {
      page: String(page),
      pageSize: String(pageSize),
    });
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
