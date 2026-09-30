'use client';

import { useEffect, useRef } from 'react';
import type { ChatStatus } from 'ai';
import type { KnowledgeUIMessage } from '@/types/chat.types';
import { MessageBubble } from './message-bubble';

interface MessageListProps {
  messages: KnowledgeUIMessage[];
  status: ChatStatus;
  error?: Error;
}

export function MessageList({ messages, status, error }: MessageListProps) {
  const isLoading = status === 'submitted' || status === 'streaming';
  const scrollRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div
      ref={scrollRef}
      className="chat-message-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"
    >
      <div className="mx-auto max-w-4xl space-y-4">
        {messages.length === 0 && !isLoading && (
          <div className="flex items-center justify-center h-[400px] text-muted-foreground">
            <div className="text-center">
              <h3 className="text-lg font-semibold mb-2">开始对话</h3>
              <p className="text-sm">输入你的问题，AI 将从知识库中检索并回答</p>
            </div>
          </div>
        )}

        {messages.map((message, index) => (
          <MessageBubble
            key={message.id}
            message={message}
            isStreaming={isLoading && index === messages.length - 1}
          />
        ))}

        {status === 'submitted' && (
          <div className="text-sm text-muted-foreground">正在思考...</div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error.message || '消息发送失败，请稍后重试'}
          </div>
        )}
      </div>
    </div>
  );
}
