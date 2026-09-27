import { ManagedUser } from '@/types/api.types';
import { apiClient } from '@/lib/api-client';

export interface UserPayload {
  username: string;
  email: string;
  password?: string;
  nickname?: string;
  phone?: string;
  status: 0 | 1;
  roleIds: string[];
}

export type UpdateUserPayload = Omit<UserPayload, 'password'>;

export const userService = {
  list: () => apiClient.get<ManagedUser[]>('/users'),
  create: (payload: UserPayload) => apiClient.post<ManagedUser>('/users', payload),
  update: (id: string, payload: UpdateUserPayload) => apiClient.put<ManagedUser>(`/users/${id}`, payload),
  remove: (id: string) => apiClient.delete<{ id: string }>(`/users/${id}`),
};
