'use client';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Bot, Loader2 } from 'lucide-react';
import { MarkdownContent } from './markdown-content';

interface StreamingBubbleProps {
  response: string;
  thinking: string;
}

export function StreamingBubble({ response, thinking }: StreamingBubbleProps) {
  return (
    <div className="flex gap-3">
      <Avatar className="h-8 w-8">
        <AvatarFallback>
          <Bot className="h-4 w-4" />
        </AvatarFallback>
      </Avatar>

      <div className="flex flex-col gap-2 max-w-[80%]">
        {thinking && (
          <Card className="bg-muted/50">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="italic">{thinking}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {response && (
          <Card>
            <CardContent className="p-3">
              <div className="relative">
                <MarkdownContent content={response} />
                <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-0.5" />
              </div>
            </CardContent>
          </Card>
        )}

        {!response && !thinking && (
          <Card>
            <CardContent className="py-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>正在思考...</span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
