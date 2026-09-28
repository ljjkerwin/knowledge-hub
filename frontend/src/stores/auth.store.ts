import { create } from 'zustand';
import { User } from '@/types/api.types';
import { authService } from '@/services/auth.service';
import { clearAccessToken, getAccessToken, setAccessToken } from '@/lib/access-token';

// refresh token 启用了单次使用轮换。同一页面可能有多个组件（开发模式下还会
// 重复执行 effect）同时恢复会话，因此必须合并并发刷新，避免后一个请求重放旧 token。
let restoreSessionPromise: Promise<boolean> | null = null;

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login: (username: string, password: string, rememberMe: boolean) => Promise<void>;
  logout: () => Promise<void>;
  loadFromStorage: () => Promise<boolean>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  // 主布局挂载后会立刻恢复 HttpOnly refresh Cookie，会话结果返回前不显示登录入口。
  isLoading: true,

  login: async (username: string, password: string, rememberMe: boolean) => {
    set({ isLoading: true });
    try {
      const { user, accessToken, rememberMe: persistent } = await authService.login({
        username,
        password,
        rememberMe,
      });
      setAccessToken(accessToken, persistent);
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
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  loadFromStorage: () => {
    if (restoreSessionPromise) return restoreSessionPromise;

    set({ isLoading: true });
    restoreSessionPromise = (async () => {
      // 刷新页面时优先使用本地保存且未过期的 access token，避免每次都轮换 refresh token。
      if (getAccessToken()) {
        try {
          const user = await authService.getProfile();
          set({ user, isAuthenticated: true });
          return true;
        } catch {
          // JWT 可能已被服务端提前吊销；清除后回退到 refresh token。
          clearAccessToken();
        }
      }

      try {
        const { user, accessToken, rememberMe } = await authService.refresh();
        setAccessToken(accessToken, rememberMe);
        set({ user, isAuthenticated: true });
        return true;
      } catch {
        clearAccessToken();
        set({ user: null, isAuthenticated: false });
        return false;
      } finally {
        set({ isLoading: false });
        restoreSessionPromise = null;
      }
    })();

    return restoreSessionPromise;
  },
}));
