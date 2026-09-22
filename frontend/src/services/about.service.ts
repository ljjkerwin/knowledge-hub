import { apiClient } from '@/lib/api-client';
import { AboutInfo } from '@/types/api.types';

export const aboutService = {
  get(): Promise<AboutInfo> {
    return apiClient.get<AboutInfo>('/about');
  },
};
