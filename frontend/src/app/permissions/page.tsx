'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  ChevronRight,
  KeyRound,
  Loader2,
  Menu,
  MousePointerClick,
  Route,
  Save,
  ShieldAlert,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Permission, PermissionType, RoleWithPermissions } from '@/types/api.types';
import { rbacService } from '@/services/rbac.service';
import { useAuthStore } from '@/stores/auth.store';

const typeMeta: Record<PermissionType, { label: string; icon: typeof Menu }> = {
  1: { label: '菜单', icon: Menu },
  2: { label: '按钮', icon: MousePointerClick },
  3: { label: '接口', icon: Route },
};

function permissionRows(items: Permission[]) {
  const children = new Map<string, Permission[]>();
  items.forEach((item) => {
    const key = item.parentId === '0' ? 'root' : item.parentId;
    children.set(key, [...(children.get(key) ?? []), item]);
  });
  const rows: Array<Permission & { depth: number }> = [];
  const visit = (parentId: string, depth: number) => {
    (children.get(parentId) ?? []).forEach((item) => {
      rows.push({ ...item, depth });
      visit(item.id, depth + 1);
    });
  };
  visit('root', 0);
  return rows;
}

export default function PermissionsPage() {
  const router = useRouter();
  const { user, loadFromStorage } = useAuthStore();
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [roles, setRoles] = useState<RoleWithPermissions[]>([]);
  const [activeRoleId, setActiveRoleId] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isAdmin = user?.roles.includes('ROLE_ADMIN');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextPermissions, nextRoles] = await Promise.all([
        rbacService.listPermissions(),
        rbacService.listRoles(),
      ]);
      setPermissions(nextPermissions);
      setRoles(nextRoles);
      const role = nextRoles[0];
      if (role) {
        setActiveRoleId(role.id);
        setSelectedIds(role.permissionIds);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法加载权限数据');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFromStorage().then((authenticated) => {
      if (!authenticated) {
        router.replace('/login?next=/permissions');
        return;
      }
      if (!useAuthStore.getState().user?.roles.includes('ROLE_ADMIN')) {
        router.replace('/chat');
        return;
      }
      void load();
    });
  }, [load, loadFromStorage, router]);

  const visiblePermissions = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return permissionRows(permissions).filter(
      (permission) =>
        !keyword ||
        permission.permissionName.toLowerCase().includes(keyword) ||
        permission.permissionCode.toLowerCase().includes(keyword),
    );
  }, [permissions, query]);

  const activeRole = roles.find((role) => role.id === activeRoleId);
  const selectRole = (role: RoleWithPermissions) => {
    setActiveRoleId(role.id);
    setSelectedIds(role.permissionIds);
  };
  const togglePermission = (permissionId: string) => {
    setSelectedIds((current) =>
      current.includes(permissionId)
        ? current.filter((id) => id !== permissionId)
        : [...current, permissionId],
    );
  };
  const save = async () => {
    if (!activeRole) return;
    setSaving(true);
    setError('');
    try {
      await rbacService.replaceRolePermissions(activeRole.id, selectedIds);
      setRoles((current) =>
        current.map((role) =>
          role.id === activeRole.id ? { ...role, permissionIds: selectedIds } : role,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存角色授权失败');
    } finally {
      setSaving(false);
    }
  };

  if (!user || !isAdmin) return null;

  return (
    <div className="flex h-full flex-col overflow-auto">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b px-6 py-5">
        <div>
          <div className="flex items-center gap-2"><KeyRound className="size-5 text-primary" /><h1 className="text-2xl font-semibold">权限管理</h1></div>
          <p className="mt-1 text-sm text-muted-foreground">为角色分配菜单、按钮和接口的访问权限</p>
        </div>
        <Button disabled={!activeRole || saving} onClick={() => void save()}><Save />{saving ? '保存中…' : '保存授权'}</Button>
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-5 p-6 lg:flex-row">
        <aside className="w-full shrink-0 rounded-xl border bg-card lg:w-64">
          <div className="border-b px-4 py-3"><h2 className="font-medium">角色</h2><p className="mt-0.5 text-xs text-muted-foreground">选择一个角色进行授权</p></div>
          <div className="p-2">
            {roles.map((role) => <button key={role.id} type="button" onClick={() => selectRole(role)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors ${activeRoleId === role.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}><span><span className="block text-sm font-medium">{role.roleName}</span><span className={`block text-xs ${activeRoleId === role.id ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{role.roleCode}</span></span><ChevronRight className="size-4" /></button>)}
          </div>
        </aside>
        <section className="min-w-0 flex-1 rounded-xl border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"><div><h2 className="font-medium">{activeRole?.roleName ?? '角色权限'}</h2><p className="mt-0.5 text-xs text-muted-foreground">已选择 {selectedIds.length} 项权限</p></div><Input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full sm:w-64" placeholder="搜索权限名称或编码" /></div>
          {error && <div className="m-4 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"><ShieldAlert className="size-4" />{error}</div>}
          {loading ? <div className="flex justify-center p-16"><Loader2 className="animate-spin text-muted-foreground" /></div> : <div className="overflow-x-auto"><div className="min-w-[680px]"><div className="grid grid-cols-[minmax(250px,1.3fr)_minmax(180px,1fr)_85px_105px] gap-4 border-b bg-muted/40 px-5 py-3 text-xs font-medium text-muted-foreground"><span>权限</span><span>权限编码</span><span>类型</span><span className="text-right">授权</span></div>{visiblePermissions.map((permission) => { const meta = typeMeta[permission.permissionType]; const Icon = meta.icon; const checked = selectedIds.includes(permission.id); return <div key={permission.id} className="grid grid-cols-[minmax(250px,1.3fr)_minmax(180px,1fr)_85px_105px] items-center gap-4 border-b px-5 py-3 last:border-0"><div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${permission.depth * 20}px` }}><Icon className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0"><p className="truncate font-medium">{permission.permissionName}</p>{permission.apiUrl && <p className="truncate text-xs text-muted-foreground">{permission.method} {permission.apiUrl}</p>}</div></div><code className="truncate text-xs text-muted-foreground">{permission.permissionCode}</code><Badge variant="outline">{meta.label}</Badge><div className="text-right"><Button size="sm" variant={checked ? 'default' : 'outline'} onClick={() => togglePermission(permission.id)}>{checked && <Check />}{checked ? '已授权' : '授权'}</Button></div></div>; })}{visiblePermissions.length === 0 && <div className="p-12 text-center text-sm text-muted-foreground">没有匹配的权限</div>}</div></div>}
        </section>
      </main>
    </div>
  );
}
