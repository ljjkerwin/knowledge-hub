'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  MessageSquare,
  FileText,
  ClipboardCheck,
  Brain,
  LogOut,
  User,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';

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
  },
  {
    title: '审核工作台',
    href: '/documents/reviews',
    icon: ClipboardCheck,
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAuthenticated, logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

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
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span>{item.title}</span>
              </Link>
            );
          })}
        </nav>
      </ScrollArea>

      <Separator />

      {/* User Section */}
      <div className="p-2">
        {isAuthenticated && user ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm hover:bg-accent transition-colors">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs">
                  {(user.nickname || user.username).slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 text-left min-w-0">
                <div className="font-medium truncate">
                  {user.nickname || user.username}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {user.email}
                </div>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem disabled>
                <User className="mr-2 h-4 w-4" />
                个人信息
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Link
            href="/login"
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium hover:bg-accent transition-colors"
          >
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-xs">
                <User className="h-4 w-4" />
              </AvatarFallback>
            </Avatar>
            <span>登录</span>
          </Link>
        )}
      </div>
    </div>
  );
}
