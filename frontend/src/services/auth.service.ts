import { apiClient } from '@/lib/api-client';
import { LoginRequest, LoginResponse, User } from '@/types/api.types';

/**
 * 认证服务
 */
export const authService = {
  /**
   * 登录
   */
  async login(request: LoginRequest): Promise<LoginResponse> {
    return apiClient.post<LoginResponse>('/auth/login', request);
  },

  /**
   * 获取当前用户信息
   */
  async getProfile(): Promise<User> {
    return apiClient.get<User>('/auth/profile');
  },
};
