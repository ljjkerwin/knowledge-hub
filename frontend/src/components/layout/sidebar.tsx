'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  MessageSquare,
  FileText,
  Settings,
  Brain,
} from 'lucide-react';

const menuItems = [
  {
    title: '智能问答',
    href: '/chat',
    icon: MessageSquare,
  },
  {
    title: '知识管理',
    href: '/documents',
    icon: FileText,
    disabled: true,
  },
  {
    title: '系统设置',
    href: '/settings',
    icon: Settings,
    disabled: true,
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="flex flex-col h-screen w-64 border-r bg-muted/30">
      {/* Header */}
      <div className="flex items-center gap-2 p-4">
        <Brain className="h-6 w-6 text-primary" />
        <span className="font-semibold text-lg">Agentic RAG</span>
      </div>

      <Separator />

      {/* Menu */}
      <ScrollArea className="flex-1 py-4">
        <nav className="space-y-1 px-2">
          {menuItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.disabled ? '#' : item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : item.disabled
                    ? 'text-muted-foreground cursor-not-allowed'
                    : 'hover:bg-accent hover:text-accent-foreground'
                }`}
                onClick={(e) => item.disabled && e.preventDefault()}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span>{item.title}</span>
                {item.disabled && (
                  <span className="ml-auto text-xs bg-muted px-2 py-0.5 rounded">
                    即将推出
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </ScrollArea>
    </div>
  );
}
