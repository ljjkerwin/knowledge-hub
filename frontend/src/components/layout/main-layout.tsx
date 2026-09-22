'use client';

import { Suspense } from 'react';
import { Sidebar } from './sidebar';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
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
