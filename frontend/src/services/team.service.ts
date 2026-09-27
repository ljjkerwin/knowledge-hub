import { apiClient } from '@/lib/api-client';
import { TeamNode, TeamUser } from '@/types/api.types';

export type TeamPayload = {
  teamName: string;
  teamCode?: string;
  description?: string;
  leaderId?: string;
  parentId?: string;
  sort?: number;
  status?: number;
};

export const teamService = {
  list: () => apiClient.get<TeamNode[]>('/teams'),
  users: () => apiClient.get<TeamUser[]>('/teams/users'),
  create: (payload: TeamPayload) => apiClient.post<TeamNode>('/teams', payload),
  update: (id: string, payload: Partial<TeamPayload>) =>
    apiClient.patch<TeamNode>(`/teams/${id}`, payload),
  remove: (id: string) => apiClient.delete(`/teams/${id}`),
  addMember: (teamId: string, userId: string, memberRole: 'leader' | 'member' = 'member') =>
    apiClient.post(`/teams/${teamId}/members`, { userId, memberRole }),
  removeMember: (teamId: string, userId: string) =>
    apiClient.delete(`/teams/${teamId}/members/${userId}`),
};
