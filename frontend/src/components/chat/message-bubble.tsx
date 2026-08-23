'use client';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Message, Citation } from '@/types/api.types';
import { User, Bot, FileText } from 'lucide-react';

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <Avatar className="h-8 w-8">
        <AvatarFallback>
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>

      <div className={`flex flex-col gap-2 max-w-[80%] ${isUser ? 'items-end' : 'items-start'}`}>
        <Card className={isUser ? 'bg-primary text-primary-foreground' : ''}>
          <CardContent className="p-3">
            <div className="whitespace-pre-wrap text-sm">{message.content}</div>
          </CardContent>
        </Card>

        {message.citations && message.citations.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {message.citations.map((citation, index) => (
              <CitationBadge key={index} citation={citation} index={index + 1} />
            ))}
          </div>
        )}

        {message.confidence !== undefined && (
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
    <Badge variant="secondary" className="text-xs cursor-help" title={citation.content}>
      <FileText className="h-3 w-3 mr-1" />
      [{index}] {citation.documentTitle}
    </Badge>
  );
}
