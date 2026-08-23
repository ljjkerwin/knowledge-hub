'use client';

import { ChatInput } from '@/components/chat/chat-input';
import { MessageList } from '@/components/chat/message-list';
import { ConversationPanel } from '@/components/chat/conversation-panel';

// 临时用户 ID，实际项目中应从认证系统获取
const USER_ID = 'user-001';

export default function ChatPage() {
  return (
    <div className="flex flex-1 h-full">
      {/* 对话历史面板 */}
      <ConversationPanel userId={USER_ID} />

      {/* 主聊天区域 */}
      <div className="flex-1 flex flex-col">
        <header className="p-4 border-b">
          <h1 className="text-xl font-semibold">知识库问答</h1>
          <p className="text-sm text-muted-foreground">
            基于 Agentic RAG 的智能问答系统
          </p>
        </header>
        <MessageList />
        <ChatInput userId={USER_ID} />
      </div>
    </div>
  );
}
