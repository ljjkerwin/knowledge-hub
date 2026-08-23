import { ApiResponse } from '@/types/api.types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

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
 * 通用 API 客户端
 */
export const apiClient = {
  async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new ApiError(response.status, error.message || 'Request failed');
    }

    const data: ApiResponse<T> = await response.json();
    return data.data;
  },

  async get<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = params
      ? `${endpoint}?${new URLSearchParams(params)}`
      : endpoint;

    return this.request<T>(url, { method: 'GET' });
  },

  async post<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
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

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  },
};
