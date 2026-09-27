import { ApiResponse } from '@/types/api.types';
import { clearAccessToken, getAccessToken } from '@/lib/access-token';

const backendUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5002')
  .replace(/\/$/, '')
  .replace(/\/api$/, '');

// 兼容 NEXT_PUBLIC_API_URL 配置为服务根地址或已带 /api 的地址。
export const API_BASE_URL = `${backendUrl}/api`;

type ApiRequestOptions = RequestInit & {
  skipUnauthorizedRedirect?: boolean;
};

/**
 * API 客户端错误
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * 清除认证状态并跳转登录
 */
function handleUnauthorized() {
  if (typeof window === 'undefined') return;
  clearAccessToken();
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.href = `/login?next=${encodeURIComponent(next)}`;
}

/**
 * 通用 API 客户端
 */
export const apiClient = {
  async request<T>(
    endpoint: string,
    options: ApiRequestOptions = {},
  ): Promise<T> {
    const { skipUnauthorizedRedirect, ...fetchOptions } = options;
    const url = `${API_BASE_URL}${endpoint}`;
    const token = getAccessToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((fetchOptions.headers as Record<string, string>) || {}),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      ...fetchOptions,
      headers,
      credentials: 'include',
    });

    if (response.status === 401 && !skipUnauthorizedRedirect) {
      handleUnauthorized();
      throw new ApiError(401, '未授权，请重新登录');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new ApiError(response.status, error.message || 'Request failed');
    }

    const json = await response.json();
    // 兼容 { code, message, data } 包装格式和直接返回格式
    return (json.data !== undefined ? json.data : json) as T;
  },

  async get<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = params
      ? `${endpoint}?${new URLSearchParams(params)}`
      : endpoint;

    return this.request<T>(url, { method: 'GET' });
  },

  async post<T>(
    endpoint: string,
    body?: unknown,
    options?: ApiRequestOptions,
  ): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  async put<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  async patch<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  },
};
