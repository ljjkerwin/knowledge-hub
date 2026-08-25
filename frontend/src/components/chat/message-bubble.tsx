'use client';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Message, Citation } from '@/types/api.types';
import { User, Bot, FileText } from 'lucide-react';
import { MarkdownContent } from './markdown-content';
import Link from 'next/link';

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <Avatar className="h-8 w-8">
        <AvatarFallback className={isUser ? 'bg-[#d4daff]' : ''}>
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>

      <div className={`flex flex-col gap-2 max-w-[80%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-xl px-3 py-2 ring-1 ring-foreground/10 ${
            isUser ? 'bg-primary text-primary-foreground' : 'bg-card'
          }`}
        >
          <MarkdownContent content={message.content} />
        </div>

        {message.citations && message.citations.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {message.citations.map((citation, index) => (
              <CitationBadge key={index} citation={citation} index={index + 1} />
            ))}
          </div>
        )}

        {!isUser &&
          (message.citations?.length ?? 0) > 0 &&
          message.confidence !== undefined && (
          <Badge variant="outline" className="text-xs">
            置信度: {Math.round(message.confidence * 100)}%
          </Badge>
        )}
      </div>
    </div>
  );
}

function CitationBadge({ citation, index }: { citation: Citation; index: number }) {
  return (
    <Badge
      variant="secondary"
      className="cursor-pointer p-0 text-xs hover:bg-secondary/70"
      title={`打开阅读页：${citation.documentTitle}`}
    >
      <Link
        href={`/documents/${citation.documentId}?citation=${encodeURIComponent(citation.chunkId)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center px-2 py-1"
      >
        <FileText className="mr-1 h-3 w-3" />
        [{index}] {citation.documentTitle}
      </Link>
    </Badge>
  );
}
