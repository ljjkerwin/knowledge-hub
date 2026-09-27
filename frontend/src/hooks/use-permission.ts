import { useAuthStore } from '@/stores/auth.store';

/** 前端展示层的统一权限判断；接口权限仍由后端负责校验。 */
export function usePermission() {
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.roles.includes('ROLE_ADMIN') ?? false;

  const can = (permission: string) =>
    isAdmin || user?.permissions.includes(permission) === true;
  const canAny = (permissions: string[]) => permissions.some(can);
  const canAll = (permissions: string[]) => permissions.every(can);

  return { can, canAny, canAll, isAdmin };
}
