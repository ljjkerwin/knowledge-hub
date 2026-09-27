import { apiClient } from '@/lib/api-client';
import { Permission, PermissionType, RoleWithPermissions } from '@/types/api.types';

export interface CreateRolePayload {
  roleName: string;
  roleCode: string;
  description?: string;
  permissionIds: string[];
}

export interface PermissionPayload {
  parentId: string;
  permissionName: string;
  permissionCode: string;
  permissionType: PermissionType;
  menuUrl?: string;
  apiUrl?: string;
  method?: string;
  icon?: string;
  sort: number;
  status: number;
}

export const rbacService = {
  listPermissions: () => apiClient.get<Permission[]>('/rbac/permissions'),
  createPermission: (payload: PermissionPayload) =>
    apiClient.post<Permission>('/rbac/permissions', payload),
  updatePermission: (permissionId: string, payload: PermissionPayload) =>
    apiClient.put<Permission>(`/rbac/permissions/${permissionId}`, payload),
  deletePermission: (permissionId: string) =>
    apiClient.delete<{ id: string }>(`/rbac/permissions/${permissionId}`),
  listRoles: () => apiClient.get<RoleWithPermissions[]>('/rbac/roles'),
  createRole: (payload: CreateRolePayload) =>
    apiClient.post<RoleWithPermissions>('/rbac/roles', payload),
  replaceRolePermissions: (roleId: string, permissionIds: string[]) =>
    apiClient.put<{ roleId: string; permissionIds: string[] }>(
      `/rbac/roles/${roleId}/permissions`,
      { permissionIds },
    ),
};
