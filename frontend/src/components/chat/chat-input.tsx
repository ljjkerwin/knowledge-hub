'use client';

import { useRef, KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useChatStore } from '@/stores/chat.store';
import { Loader2, Send } from 'lucide-react';

interface ChatInputProps {
  userId: string;
}

export function ChatInput({ userId }: ChatInputProps) {
  const { input, setInput, sendMessage, isLoading } = useChatStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (input.trim() && !isLoading) {
      sendMessage(userId);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 拼音等 IME 选词时，Enter 用于确认候选词，不能触发消息发送。
    const isComposing = e.nativeEvent.isComposing || e.keyCode === 229;
    if (isComposing) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex items-end gap-2 p-4 border-t bg-background">
      <Textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入消息... (Enter 发送)"
        className="min-h-[38px] max-h-[200px] resize-none"
      />
      <Button
        onClick={handleSend}
        disabled={!input.trim() || isLoading}
        size="icon"
        className="h-[38px] w-[50px]"
      >
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-label="发送中" />
        ) : (
          <Send className="h-5 w-5" />
        )}
      </Button>
    </div>
  );
}
