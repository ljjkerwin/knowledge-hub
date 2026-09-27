import { apiClient } from '@/lib/api-client';
import { Permission, RoleWithPermissions } from '@/types/api.types';

export const rbacService = {
  listPermissions: () => apiClient.get<Permission[]>('/rbac/permissions'),
  listRoles: () => apiClient.get<RoleWithPermissions[]>('/rbac/roles'),
  replaceRolePermissions: (roleId: string, permissionIds: string[]) =>
    apiClient.put<{ roleId: string; permissionIds: string[] }>(
      `/rbac/roles/${roleId}/permissions`,
      { permissionIds },
    ),
};
