import { create } from 'zustand';
import { Message, Conversation, Citation } from '@/types/api.types';
import { AguiEvent, AguiEventType } from '@/types/agui.types';
import { conversationService } from '@/services/conversation.service';

interface ChatState {
  // 当前对话
  conversationId: string | null;
  messages: Message[];
  conversations: Conversation[];

  // 输入状态
  input: string;
  isLoading: boolean;
  isStreaming: boolean;

  // 当前流式响应
  currentResponse: string;
  currentCitations: Citation[];
  currentThinking: string;

  // Actions
  setInput: (input: string) => void;
  setConversationId: (id: string | null) => void;
  sendMessage: (userId: string) => Promise<void>;
  loadConversations: (userId: string) => Promise<void>;
  loadHistory: (conversationId: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  clearChat: () => void;
  handleStreamEvent: (event: AguiEvent) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversationId: null,
  messages: [],
  conversations: [],
  input: '',
  isLoading: false,
  isStreaming: false,
  currentResponse: '',
  currentCitations: [],
  currentThinking: '',

  setInput: (input) => set({ input }),

  setConversationId: (id) => set({ conversationId: id }),

  sendMessage: async (userId: string) => {
    const { input, conversationId, messages } = get();
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      conversationId: conversationId || '',
      role: 'user',
      content: input,
      createdAt: new Date().toISOString(),
    };

    set({
      messages: [...messages, userMessage],
      input: '',
      isLoading: true,
      isStreaming: true,
      currentResponse: '',
      currentCitations: [],
      currentThinking: '',
    });

    try {
      const stream = conversationService.chatStream({
        message: input,
        conversationId: conversationId || undefined,
        userId,
        streamResponse: true,
      });

      for await (const event of stream) {
        get().handleStreamEvent(event as AguiEvent);
      }

      // 流结束，添加助手消息
      const { currentResponse, currentCitations, conversationId: currentConvId } = get();

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        conversationId: currentConvId || '',
        role: 'assistant',
        content: currentResponse,
        citations: currentCitations,
        createdAt: new Date().toISOString(),
      };

      set((state) => ({
        messages: [...state.messages, assistantMessage],
        isLoading: false,
        isStreaming: false,
        currentResponse: '',
        currentCitations: [],
        currentThinking: '',
      }));
    } catch (error) {
      console.error('Send message failed:', error);
      set({ isLoading: false, isStreaming: false });
    }
  },

  loadConversations: async (userId: string) => {
    try {
      const conversations = await conversationService.listConversations(userId);
      set({ conversations });
    } catch (error) {
      console.error('Load conversations failed:', error);
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
      currentResponse: '',
      currentCitations: [],
      currentThinking: '',
    }),

  handleStreamEvent: (event: AguiEvent) => {
    switch (event.type) {
      case AguiEventType.METADATA:
        set({ conversationId: event.conversationId });
        break;

      case AguiEventType.THINKING:
        set({ currentThinking: event.content });
        break;

      case AguiEventType.TEXT:
        set((state) => ({
          currentResponse: state.currentResponse + event.content,
        }));
        break;

      case AguiEventType.RETRIEVAL_RESULT:
        set({ currentCitations: event.chunks as unknown as Citation[] });
        break;

      case AguiEventType.ERROR:
        console.error('Stream error:', event.message);
        break;

      case AguiEventType.DONE:
        // 流结束
        break;
    }
  },
}));
