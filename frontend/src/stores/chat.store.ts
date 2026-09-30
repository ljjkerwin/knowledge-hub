import { create } from 'zustand';
import { Message, Conversation } from '@/types/api.types';
import { conversationService } from '@/services/conversation.service';

interface ChatState {
  // 当前对话
  conversationId: string | null;
  messages: Message[];
  conversations: Conversation[];
  conversationPage: number;
  hasMoreConversations: boolean;
  isLoadingConversations: boolean;

  // Actions
  setConversationId: (id: string | null) => void;
  addConversation: (conversation: Conversation) => void;
  loadConversations: (userId: string, options?: { loadMore?: boolean }) => Promise<void>;
  loadHistory: (conversationId: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  clearChat: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversationId: null,
  messages: [],
  conversations: [],
  conversationPage: 0,
  hasMoreConversations: true,
  isLoadingConversations: false,
  setConversationId: (id) => set({ conversationId: id }),

  addConversation: (conversation) =>
    set((state) => ({
      conversations: state.conversations.some((item) => item.id === conversation.id)
        ? state.conversations
        : [conversation, ...state.conversations],
    })),

  loadConversations: async (userId: string, options = {}) => {
    const { loadMore = false } = options;
    const state = get();
    if (state.isLoadingConversations || (loadMore && !state.hasMoreConversations)) return;

    const page = loadMore ? state.conversationPage + 1 : 1;
    set({ isLoadingConversations: true });
    try {
      const result = await conversationService.listConversations(page);
      set((current) => ({
        conversations: loadMore
          ? [...current.conversations, ...result.items.filter((item) => !current.conversations.some((existing) => existing.id === item.id))]
          : result.items,
        conversationPage: result.page,
        hasMoreConversations: result.page * result.pageSize < result.total,
        isLoadingConversations: false,
      }));
    } catch (error) {
      console.error('Load conversations failed:', error);
      // 首屏未填满容器时，面板会自动继续加载下一页。请求失败后必须
      // 终止分页，否则状态恢复为非加载中会立即触发下一次请求，形成循环。
      set({ isLoadingConversations: false, hasMoreConversations: false });
    }
  },

  loadHistory: async (conversationId: string) => {
    try {
      const messages = await conversationService.getHistory(conversationId);
      set({ messages, conversationId });
    } catch (error) {
      console.error('Load history failed:', error);
    }
  },

  deleteConversation: async (conversationId: string) => {
    try {
      await conversationService.deleteConversation(conversationId);
      set((state) => ({
        conversations: state.conversations.filter((c) => c.id !== conversationId),
        ...(state.conversationId === conversationId
          ? { conversationId: null, messages: [] }
          : {}),
      }));
    } catch (error) {
      console.error('Delete conversation failed:', error);
    }
  },

  clearChat: () =>
    set({
      conversationId: null,
      messages: [],
    }),
}));
