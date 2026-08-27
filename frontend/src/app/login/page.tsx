'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useAuthStore } from '@/stores/auth.store';
import { Brain, Loader2 } from 'lucide-react';

function getReturnPath() {
  if (typeof window === 'undefined') return '/chat';
  const next = new URLSearchParams(window.location.search).get('next');

  // 只允许站内绝对路径，避免 next 参数被用作开放重定向。
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/chat';
}

export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated, isLoading, loadFromStorage } = useAuthStore();

  const [username, setUsername] = useState('dev');
  const [password, setPassword] = useState('liangzaijun');
  const [error, setError] = useState('');

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    if (isAuthenticated) router.replace(getReturnPath());
  }, [isAuthenticated, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password.trim()) {
      setError('请输入用户名和密码');
      return;
    }

    try {
      await login(username, password);
      router.replace(getReturnPath());
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请重试');
    }
  };

  if (isAuthenticated) {
    return null;
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
