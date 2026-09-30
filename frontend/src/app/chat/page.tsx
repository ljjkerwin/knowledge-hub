'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { ChatInput } from '@/components/chat/chat-input';
import { MessageList } from '@/components/chat/message-list';
import { ConversationPanel } from '@/components/chat/conversation-panel';
import { useAuthStore } from '@/stores/auth.store';
import { useChatStore } from '@/stores/chat.store';
import { getAccessToken } from '@/lib/access-token';
import { API_BASE_URL } from '@/lib/api-client';
import {
  toUIMessage,
  type KnowledgeUIMessage,
} from '@/types/chat.types';

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatPageContent />
    </Suspense>
  );
}

function ChatPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loadFromStorage } = useAuthStore();
  const {
    conversationId,
    messages: historyMessages,
    setConversationId,
    addConversation,
    loadHistory,
    clearChat,
  } =
    useChatStore();

  const transport = useMemo(
    () =>
      new DefaultChatTransport<KnowledgeUIMessage>({
        api: `${API_BASE_URL}/rag/chat/stream`,
        credentials: 'include',
        headers: (): Record<string, string> => {
          const token = getAccessToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
        prepareSendMessagesRequest: ({ messages, body, headers, credentials }) => {
          const lastUserMessage = [...messages]
            .reverse()
            .find((message) => message.role === 'user');
          const message = lastUserMessage?.parts
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('') ?? '';

          return {
            headers,
            credentials,
            body: {
              message,
              conversationId: body?.conversationId,
            },
          };
        },
      }),
    [],
  );

  const { messages, setMessages, sendMessage, status, error } =
    useChat<KnowledgeUIMessage>({
      transport,
      onData: (part) => {
        if (part.type !== 'data-conversation' || !user) return;

        const now = new Date().toISOString();
        setConversationId(part.data.conversationId);
        addConversation({
          id: part.data.conversationId,
          userId: user.id,
          title: part.data.title,
          createdAt: now,
          updatedAt: now,
        });
      },
    });

  const initializedRef = useRef(false);
  const [isInitializingConversation, setIsInitializingConversation] =
    useState(() => Boolean(searchParams.get('conversationId')));

  useEffect(() => {
    setMessages(historyMessages.map(toUIMessage));
  }, [historyMessages, setMessages]);

  // 刷新 HttpOnly refresh token 以恢复仅存在内存中的 access token。
  useEffect(() => {
    void loadFromStorage().then((authed) => {
      if (!authed) {
        const next = `${window.location.pathname}${window.location.search}`;
        router.replace(`/login?next=${encodeURIComponent(next)}`);
      }
    });
  }, [loadFromStorage, router]);

  // 首次加载：URL 是当前会话的初始唯一来源。先同步 ID，再加载历史，
  // 避免 URL 同步 effect 在异步加载完成前将 conversationId 参数删除。
  useEffect(() => {
    if (!user || initializedRef.current) return;
    initializedRef.current = true;

    const urlConvId = searchParams.get('conversationId');
    if (urlConvId) {
      setConversationId(urlConvId);
      void loadHistory(urlConvId).finally(() => {
        setIsInitializingConversation(false);
      });
      return;
    }

    clearChat();
  }, [user, searchParams, setConversationId, loadHistory, clearChat]);

  // conversationId 变化时同步到 URL
  useEffect(() => {
    if (!user || isInitializingConversation) return;

    const currentConvId = searchParams.get('conversationId');
    if (currentConvId === (conversationId ?? null)) return;

    const params = new URLSearchParams(searchParams.toString());
    if (conversationId) {
      params.set('conversationId', conversationId);
    } else {
      params.delete('conversationId');
    }
    const newUrl = params.toString() ? `/chat?${params}` : '/chat';
    router.replace(newUrl, { scroll: false });
  }, [conversationId, user, router, searchParams, isInitializingConversation]);

  if (!user) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      {/* 对话历史面板 */}
      <ConversationPanel userId={user.id} />

      {/* 主聊天区域 */}
      <div className="flex min-w-0 min-h-0 flex-1 flex-col">
        <MessageList messages={messages} status={status} error={error} />
        <ChatInput
          isLoading={status === 'submitted' || status === 'streaming'}
          onSend={(text) => {
            void sendMessage(
              { text },
              { body: { conversationId: conversationId ?? undefined } },
            );
          }}
        />
      </div>
    </div>
  );
}
