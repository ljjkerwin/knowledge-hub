'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useChatStore } from '@/stores/chat.store';
import { Conversation } from '@/types/api.types';
import { MessageSquare, Plus, Trash2, PanelLeftClose, PanelLeft } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

interface ConversationPanelProps {
  userId: string;
}

export function ConversationPanel({ userId }: ConversationPanelProps) {
  const {
    conversations,
    conversationId,
    loadConversations,
    loadHistory,
    deleteConversation,
    clearChat,
  } = useChatStore();

  const [collapsed, setCollapsed] = useState(false);

  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadConversations(userId);
  }, [userId, loadConversations]);

  return (
    <div
      className={`flex flex-col border-r bg-muted/30 transition-all duration-300 ${
        collapsed ? 'w-12' : 'w-64'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-2">
        {!collapsed && (
          <Button onClick={clearChat} className="flex-1 mr-2" variant="outline" size="sm">
            <Plus className="h-4 w-4 mr-1" />
            新对话
          </Button>
        )}
        {/* <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          className="h-8 w-8"
        >
          {collapsed ? (
            <PanelLeft className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </Button> */}
      </div>

      <Separator />

      {/* Conversation List */}
      {!collapsed && (
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {conversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conversationId === conv.id}
                onSelect={() => loadHistory(conv.id)}
                onDelete={() => deleteConversation(conv.id)}
              />
            ))}

            {conversations.length === 0 && (
              <div className="p-4 text-center text-sm text-muted-foreground">
                暂无对话记录
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onDelete,
}: {
  conversation: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-2 p-2 rounded-md cursor-pointer hover:bg-accent ${
        isActive ? 'bg-accent' : ''
      }`}
      onClick={onSelect}
    >
      <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{conversation.title}</div>
        <div className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(conversation.updatedAt), {
            addSuffix: true,
            locale: zhCN,
          })}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 opacity-0 group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}
