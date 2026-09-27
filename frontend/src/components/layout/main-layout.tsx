'use client';

import { Suspense, useEffect } from 'react';
import { Sidebar } from './sidebar';
import { useAuthStore } from '@/stores/auth.store';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const loadFromStorage = useAuthStore((state) => state.loadFromStorage);

  // 在所有页面统一恢复 refresh Cookie，避免只有打开登录页才恢复会话。
  useEffect(() => {
    void loadFromStorage();
  }, [loadFromStorage]);

  return (
    <div className="flex h-screen bg-background">
      <Suspense fallback={<aside className="h-screen w-48 shrink-0 border-r bg-muted/30" />}>
        <Sidebar />
      </Suspense>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
