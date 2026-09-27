import { type ReactNode } from 'react';
import { usePermission } from '@/hooks/use-permission';

type PermissionGateProps = {
  permission: string | string[];
  mode?: 'any' | 'all';
  fallback?: ReactNode;
  children: ReactNode;
};

/** 仅在用户具备指定权限时渲染子元素；管理员由 usePermission 统一放行。 */
export function PermissionGate({
  permission,
  mode = 'any',
  fallback = null,
  children,
}: PermissionGateProps) {
  const { can, canAny, canAll } = usePermission();
  const allowed = Array.isArray(permission)
    ? mode === 'all'
      ? canAll(permission)
      : canAny(permission)
    : can(permission);

  return allowed ? <>{children}</> : <>{fallback}</>;
}
