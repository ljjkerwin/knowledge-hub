import { create } from 'zustand';
import { User } from '@/types/api.types';
import { authService } from '@/services/auth.service';
import { clearAccessToken, setAccessToken } from '@/lib/access-token';

// refresh token 启用了单次使用轮换。同一页面可能有多个组件（开发模式下还会
// 重复执行 effect）同时恢复会话，因此必须合并并发刷新，避免后一个请求重放旧 token。
let restoreSessionPromise: Promise<boolean> | null = null;

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loadFromStorage: () => Promise<boolean>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,

  login: async (username: string, password: string) => {
    set({ isLoading: true });
    try {
      const { user, accessToken } = await authService.login({ username, password });
      setAccessToken(accessToken);
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  logout: async () => {
    try {
      await authService.logout();
    } finally {
      clearAccessToken();
      set({ user: null, isAuthenticated: false });
    }
  },

  loadFromStorage: () => {
    if (restoreSessionPromise) return restoreSessionPromise;

    restoreSessionPromise = (async () => {
      try {
        const { user, accessToken } = await authService.refresh();
        setAccessToken(accessToken);
        set({ user, isAuthenticated: true });
        return true;
      } catch {
        clearAccessToken();
        set({ user: null, isAuthenticated: false });
        return false;
      } finally {
        restoreSessionPromise = null;
      }
    })();

    return restoreSessionPromise;
  },
}));
