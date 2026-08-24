'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChatInput } from '@/components/chat/chat-input';
import { MessageList } from '@/components/chat/message-list';
import { ConversationPanel } from '@/components/chat/conversation-panel';
import { useAuthStore } from '@/stores/auth.store';
import { useChatStore } from '@/stores/chat.store';

export default function ChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loadFromStorage } = useAuthStore();
  const { conversationId, setConversationId, loadHistory, clearChat } =
    useChatStore();

  const initializedRef = useRef(false);
  const [isInitializingConversation, setIsInitializingConversation] =
    useState(() => Boolean(searchParams.get('conversationId')));

  // 初始化：从 localStorage 恢复登录状态，未登录则跳转
  useEffect(() => {
    loadFromStorage();
    const { isAuthenticated: authed } = useAuthStore.getState();
    if (!authed) {
      router.replace('/login');
    }
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
        <MessageList />
        <ChatInput userId={user.id} />
      </div>
    </div>
  );
}
