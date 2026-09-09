import { create } from 'zustand';
import { User } from '@/types/api.types';
import { authService } from '@/services/auth.service';

const TOKEN_KEY = 'kh_token';
const USER_KEY = 'kh_user';

function setCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Lax`;
}

function removeCookie(name: string) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

function getCookie(name: string): string | null {
  const prefix = `${name}=`;
  const cookie = document.cookie
    .split('; ')
    .find((item) => item.startsWith(prefix));

  return cookie ? cookie.slice(prefix.length) : null;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  loadFromStorage: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,

  login: async (username: string, password: string) => {
    set({ isLoading: true });
    try {
      const { user, token } = await authService.login({ username, password });
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      setCookie(TOKEN_KEY, token, 7);
      set({ user, token, isAuthenticated: true, isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    removeCookie(TOKEN_KEY);
    set({ user: null, token: null, isAuthenticated: false });
  },

  loadFromStorage: () => {
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const userStr = localStorage.getItem(USER_KEY);
      // 页面路由由 Cookie 保护；仅凭 localStorage 不能视为已登录，
      // 否则 Cookie 失效时会在登录页和受保护页之间循环跳转。
      if (token && userStr && getCookie(TOKEN_KEY) === token) {
        const user = JSON.parse(userStr) as User;
        set({ user, token, isAuthenticated: true });
      } else {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        set({ user: null, token: null, isAuthenticated: false });
      }
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      removeCookie(TOKEN_KEY);
    }
  },
}));
