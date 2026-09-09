'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useAuthStore } from '@/stores/auth.store';
import { Brain, Loader2 } from 'lucide-react';

function isSafeInternalPath(path: string | null): path is string {
  return Boolean(path?.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\'));
}

function getReturnPath(next: string | null) {
  // 只允许站内绝对路径，避免 next 参数被用作开放重定向。
  return isSafeInternalPath(next) ? next : '/chat';
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, isAuthenticated, isLoading, loadFromStorage } = useAuthStore();
  const next = searchParams.get('next');
  const returnPath = getReturnPath(next);
  const hasNext = isSafeInternalPath(next);
  const redirectStartedRef = useRef(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    if (isAuthenticated && hasNext && !redirectStartedRef.current) {
      redirectStartedRef.current = true;
      router.replace(returnPath);
    }
  }, [hasNext, isAuthenticated, returnPath, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password.trim()) {
      setError('请输入用户名和密码');
      return;
    }

    try {
      await login(username, password);
      if (hasNext) {
        // 提交成功后立即跳转，不能只依赖状态 effect，否则在状态恢复的
        // 时序下可能停留在登录页。
        redirectStartedRef.current = true;
        router.replace(returnPath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请重试');
    }
  };

  if (isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-full bg-muted/30">
        <Card className="w-full max-w-sm p-8 text-center">
          <Brain className="mx-auto mb-3 h-10 w-10 text-primary" />
          <h1 className="text-xl font-semibold">已登录</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {hasNext ? '正在跳转到指定页面...' : '你当前已经处于登录状态。'}
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-full bg-muted/30">
      <Card className="w-full max-w-sm p-8">
        <div className="flex flex-col items-center mb-6">
          <Brain className="h-10 w-10 text-primary mb-2" />
          <h1 className="text-2xl font-semibold">Agentic RAG</h1>
          <p className="text-sm text-muted-foreground mt-1">知识库智能问答系统</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="username" className="text-sm font-medium">
              用户名
            </label>
            <Input
              id="username"
              type="text"
              placeholder="请输入用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isLoading}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              密码
            </label>
            <Input
              id="password"
              type="password"
              placeholder="请输入密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                登录中...
              </>
            ) : (
              '登录'
            )}
          </Button>
        </form>
      </Card>
    </div>
  );
}
