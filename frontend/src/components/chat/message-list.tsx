'use client';

import { useEffect, useRef } from 'react';
import { useChatStore } from '@/stores/chat.store';
import { MessageBubble } from './message-bubble';
import { StreamingBubble } from './streaming-bubble';

export function MessageList() {
  const { messages, isStreaming, currentResponse, currentThinking } = useChatStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, currentResponse]);

  return (
    <div
      ref={scrollRef}
      className="chat-message-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"
    >
      <div className="mx-auto max-w-4xl space-y-4">
        {messages.length === 0 && !isStreaming && (
          <div className="flex items-center justify-center h-[400px] text-muted-foreground">
            <div className="text-center">
              <h3 className="text-lg font-semibold mb-2">开始对话</h3>
              <p className="text-sm">输入你的问题，AI 将从知识库中检索并回答</p>
            </div>
          </div>
        )}

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {isStreaming && (
          <StreamingBubble
            response={currentResponse}
            thinking={currentThinking}
          />
        )}
      </div>
    </div>
  );
}
