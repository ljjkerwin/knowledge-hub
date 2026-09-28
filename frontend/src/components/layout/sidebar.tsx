"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MessageSquare,
  FileText,
  ClipboardCheck,
  Network,
  Brain,
  KeyRound,
  Shield,
  Building2,
  Users,
  LogOut,
  User,
  Loader2,
  ChevronDown,
  Settings,
  Search,
  LibraryBig,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuthStore } from "@/stores/auth.store";

interface MenuItem {
  title: string;
  href: string;
  icon: LucideIcon;
  roles?: string[];
  permissions?: string[];
}

const menuItems: MenuItem[] = [
  {
    title: "智能问答",
    href: "/chat",
    icon: MessageSquare,
  },
];

const knowledgeMenuItems: MenuItem[] = [
  { title: "知识管理", href: "/documents", icon: FileText },
  {
    title: "全文搜索",
    href: "/search",
    icon: Search,
  },
  {
    title: "知识图谱",
    href: "/knowledge-graph",
    icon: Network,
  },
  {
    title: "审核工作台",
    href: "/documents/reviews",
    icon: ClipboardCheck,
    permissions: ["audit:page"],
  },
];

const systemMenuItems: MenuItem[] = [
  {
    title: "权限管理",
    href: "/permissions",
    icon: KeyRound,
    roles: ["ROLE_ADMIN"],
  },
  { title: "角色管理", href: "/roles", icon: Shield, roles: ["ROLE_ADMIN"] },
  { title: "用户管理", href: "/users", icon: Users, roles: ["ROLE_ADMIN"] },
  { title: "团队管理", href: "/teams", icon: Building2, roles: ["ROLE_ADMIN"] },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAuthenticated, isLoading, logout } = useAuthStore();
  const isAdmin = user?.roles.includes("ROLE_ADMIN");
  const [knowledgeMenuOpen, setKnowledgeMenuOpen] = useState(true);
  const [systemMenuOpen, setSystemMenuOpen] = useState(true);

  const canViewMenuItem = (item: MenuItem) =>
    isAdmin ||
    ((!item.roles || item.roles.some((role) => user?.roles.includes(role))) &&
      (!item.permissions ||
        item.permissions.some((permission) =>
          user?.permissions.includes(permission),
        )));
  const visibleMenuItems = menuItems.filter(canViewMenuItem);
  const visibleKnowledgeMenuItems = knowledgeMenuItems.filter(canViewMenuItem);
  const visibleSystemMenuItems = systemMenuItems.filter(canViewMenuItem);
  const isKnowledgeMenuActive = visibleKnowledgeMenuItems.some(
    (item) => pathname === item.href,
  );
  const isSystemMenuActive = visibleSystemMenuItems.some(
    (item) => pathname === item.href,
  );

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  return (
    <div className="flex flex-col h-screen w-48 border-r bg-muted/30">
      {/* Header */}
      <div className="flex items-center gap-2 p-4">
        <Brain className="h-6 w-6 text-primary" />
        <span className="font-semibold text-lg">Agentic RAG</span>
      </div>

      <Separator />

      {/* Menu */}
      <ScrollArea className="flex-1 py-4">
        <nav className="space-y-1 px-2">
          {visibleMenuItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span>{item.title}</span>
              </Link>
            );
          })}
          {visibleKnowledgeMenuItems.length > 0 && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setKnowledgeMenuOpen((open) => !open)}
                aria-expanded={knowledgeMenuOpen || isKnowledgeMenuActive}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isKnowledgeMenuActive
                    ? "text-primary"
                    : "hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                <LibraryBig className="h-5 w-5 shrink-0" />
                <span className="flex-1 text-left">知识库</span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${
                    knowledgeMenuOpen || isKnowledgeMenuActive
                      ? "rotate-180"
                      : ""
                  }`}
                />
              </button>
              {(knowledgeMenuOpen || isKnowledgeMenuActive) && (
                <div className="mt-1 ml-5 space-y-1 border-l border-border/70 pl-2">
                  {visibleKnowledgeMenuItems.map((item) => {
                    const isActive = pathname === item.href;
                    const Icon = item.icon;

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-accent hover:text-accent-foreground"
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span>{item.title}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {visibleSystemMenuItems.length > 0 && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setSystemMenuOpen((open) => !open)}
                aria-expanded={systemMenuOpen || isSystemMenuActive}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isSystemMenuActive
                    ? "text-primary"
                    : "hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                <Settings className="h-5 w-5 shrink-0" />
                <span className="flex-1 text-left">系统管理</span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${
                    systemMenuOpen || isSystemMenuActive ? "rotate-180" : ""
                  }`}
                />
              </button>
              {(systemMenuOpen || isSystemMenuActive) && (
                <div className="mt-1 space-y-1 border-l border-border/70 ml-5 pl-2">
                  {visibleSystemMenuItems.map((item) => {
                    const isActive = pathname === item.href;
                    const Icon = item.icon;

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-accent hover:text-accent-foreground"
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span>{item.title}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}
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
        ) : isLoading ? (
          <div className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>恢复登录状态…</span>
          </div>
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
