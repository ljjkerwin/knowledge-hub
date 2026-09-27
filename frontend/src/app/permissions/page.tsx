'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronRight, CircleMinus, KeyRound, Loader2, Menu, MousePointerClick, Pencil, Plus, Route, Save, ShieldAlert, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Permission, PermissionType, RoleWithPermissions } from '@/types/api.types';
import { PermissionPayload, rbacService } from '@/services/rbac.service';
import { useAuthStore } from '@/stores/auth.store';

const typeMeta: Record<PermissionType, { label: string; icon: typeof Menu }> = { 1: { label: '菜单', icon: Menu }, 2: { label: '按钮', icon: MousePointerClick }, 3: { label: '接口', icon: Route } };
type TreeRow = Permission & { depth: number; leafIds: string[] };
type PermissionForm = PermissionPayload;
const emptyPermission = (parentId = '0'): PermissionForm => ({ parentId, permissionName: '', permissionCode: '', permissionType: 3, menuUrl: '', apiUrl: '', method: '', icon: '', sort: 0, status: 1 });

function buildTreeRows(items: Permission[]): TreeRow[] {
  const children = new Map<string, Permission[]>();
  items.forEach((item) => children.set(item.parentId, [...(children.get(item.parentId) ?? []), item]));
  const rows: TreeRow[] = [];
  const visit = (parentId: string, depth: number): string[] => {
    const leaves: string[] = [];
    (children.get(parentId) ?? []).forEach((item) => {
      const childLeaves = visit(item.id, depth + 1);
      const leafIds = childLeaves.length ? childLeaves : [item.id];
      rows.push({ ...item, depth, leafIds });
      leaves.push(...leafIds);
    });
    return leaves;
  };
  visit('0', 0);
  return rows.sort((a, b) => a.depth - b.depth || a.sort - b.sort || a.id.localeCompare(b.id));
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
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newRole, setNewRole] = useState({ roleName: '', roleCode: '', description: '' });
  const [editingPermission, setEditingPermission] = useState<Permission | null | undefined>(undefined);
  const [permissionForm, setPermissionForm] = useState<PermissionForm>(emptyPermission());
  const [savingPermission, setSavingPermission] = useState(false);
  const [error, setError] = useState('');
  const isAdmin = user?.roles.includes('ROLE_ADMIN');

  const selectRole = (role: RoleWithPermissions) => { setActiveRoleId(role.id); setSelectedIds(role.permissionIds); };
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [nextPermissions, nextRoles] = await Promise.all([rbacService.listPermissions(), rbacService.listRoles()]);
      setPermissions(nextPermissions); setRoles(nextRoles);
      if (nextRoles[0]) selectRole(nextRoles[0]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法加载权限数据'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadFromStorage().then((authenticated) => { if (!authenticated) return router.replace('/login?next=/permissions'); if (!useAuthStore.getState().user?.roles.includes('ROLE_ADMIN')) return router.replace('/chat'); void load(); }); }, [load, loadFromStorage, router]);

  const treeRows = useMemo(() => buildTreeRows(permissions), [permissions]);
  const visibleRows = useMemo(() => { const keyword = query.trim().toLowerCase(); return treeRows.filter((item) => !keyword || item.permissionName.toLowerCase().includes(keyword) || item.permissionCode.toLowerCase().includes(keyword)); }, [query, treeRows]);
  const activeRole = roles.find((role) => role.id === activeRoleId);
  const togglePermission = (permission: TreeRow) => setSelectedIds((current) => permission.leafIds.every((id) => current.includes(id)) ? current.filter((id) => !permission.leafIds.includes(id)) : [...new Set([...current, ...permission.leafIds])]);
  const selectionState = (permission: TreeRow) => { const count = permission.leafIds.filter((id) => selectedIds.includes(id)).length; return { checked: count === permission.leafIds.length, partial: count > 0 && count < permission.leafIds.length }; };
  const save = async () => {
    if (!activeRole) return;
    setSaving(true); setError('');
    try { const result = await rbacService.replaceRolePermissions(activeRole.id, selectedIds); setSelectedIds(result.permissionIds); setRoles((current) => current.map((role) => role.id === activeRole.id ? { ...role, permissionIds: result.permissionIds } : role)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存角色授权失败'); }
    finally { setSaving(false); }
  };
  const createRole = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setCreating(true); setError('');
    try { const role = await rbacService.createRole({ ...newRole, permissionIds: selectedIds }); setRoles((current) => [...current, role]); selectRole(role); setNewRole({ roleName: '', roleCode: '', description: '' }); setCreateOpen(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '创建角色失败'); }
    finally { setCreating(false); }
  };
  const openPermission = (permission?: Permission, parentId = '0') => {
    setEditingPermission(permission ?? null);
    setPermissionForm(permission ? { parentId: permission.parentId, permissionName: permission.permissionName, permissionCode: permission.permissionCode, permissionType: permission.permissionType, menuUrl: permission.menuUrl ?? '', apiUrl: permission.apiUrl ?? '', method: permission.method ?? '', icon: permission.icon ?? '', sort: permission.sort, status: permission.status } : emptyPermission(parentId));
  };
  const savePermission = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSavingPermission(true); setError('');
    try { const permission = editingPermission ? await rbacService.updatePermission(editingPermission.id, permissionForm) : await rbacService.createPermission(permissionForm); setPermissions((current) => editingPermission ? current.map((item) => item.id === permission.id ? permission : item) : [...current, permission]); setEditingPermission(undefined); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存权限失败'); }
    finally { setSavingPermission(false); }
  };
  const removePermission = async (permission: Permission) => {
    if (!window.confirm(`确认删除权限“${permission.permissionName}”？`)) return;
    setError('');
    try { await rbacService.deletePermission(permission.id); setPermissions((current) => current.filter((item) => item.id !== permission.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '删除权限失败'); }
  };

  if (!user || !isAdmin) return null;
  const permissionDialogOpen = editingPermission !== undefined;
  return <div className="flex h-full flex-col overflow-auto">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b px-6 py-5"><div><div className="flex items-center gap-2"><KeyRound className="size-5 text-primary" /><h1 className="text-2xl font-semibold">权限管理</h1></div><p className="mt-1 text-sm text-muted-foreground">树形维护权限；角色仅保存叶子权限，避免新增子项时自动扩权</p></div><div className="flex gap-2"><Button variant="outline" onClick={() => openPermission()}><Plus />新增权限</Button><Button variant="outline" onClick={() => setCreateOpen(true)}><Plus />新增角色</Button><Button disabled={!activeRole || saving} onClick={() => void save()}><Save />{saving ? '保存中…' : '保存授权'}</Button></div></header>
    <main className="flex min-h-0 flex-1 flex-col gap-5 p-6 lg:flex-row"><aside className="w-full shrink-0 rounded-xl border bg-card lg:w-64"><div className="border-b px-4 py-3"><h2 className="font-medium">角色</h2><p className="mt-0.5 text-xs text-muted-foreground">选择角色并分配叶子权限</p></div><div className="p-2">{roles.map((role) => <button key={role.id} type="button" onClick={() => selectRole(role)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors ${activeRoleId === role.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}><span><span className="block text-sm font-medium">{role.roleName}</span><span className={`block text-xs ${activeRoleId === role.id ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{role.roleCode}</span></span><ChevronRight className="size-4" /></button>)}</div></aside>
      <section className="min-w-0 flex-1 rounded-xl border bg-card"><div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"><div><h2 className="font-medium">{activeRole?.roleName ?? '角色权限'}</h2><p className="mt-0.5 text-xs text-muted-foreground">已授权 {selectedIds.length} 项叶子权限</p></div><Input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full sm:w-64" placeholder="搜索权限名称或编码" /></div>{error && <div className="m-4 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"><ShieldAlert className="size-4" />{error}</div>}{loading ? <div className="flex justify-center p-16"><Loader2 className="animate-spin text-muted-foreground" /></div> : <div className="overflow-x-auto"><div className="min-w-[780px]"><div className="grid grid-cols-[minmax(260px,1.3fr)_minmax(180px,1fr)_80px_195px] gap-4 border-b bg-muted/40 px-5 py-3 text-xs font-medium text-muted-foreground"><span>权限树</span><span>权限编码</span><span>类型</span><span className="text-right">授权与维护</span></div>{visibleRows.map((permission) => { const meta = typeMeta[permission.permissionType]; const Icon = meta.icon; const state = selectionState(permission); return <div key={permission.id} className="grid grid-cols-[minmax(260px,1.3fr)_minmax(180px,1fr)_80px_195px] items-center gap-4 border-b px-5 py-2.5 last:border-0"><div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${permission.depth * 22}px` }}><Icon className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0"><p className="truncate font-medium">{permission.permissionName}</p>{permission.apiUrl && <p className="truncate text-xs text-muted-foreground">{permission.method} {permission.apiUrl}</p>}</div></div><code className="truncate text-xs text-muted-foreground">{permission.permissionCode}</code><Badge variant="outline">{meta.label}</Badge><div className="flex justify-end gap-1"><Button size="sm" variant={state.checked ? 'default' : 'outline'} onClick={() => togglePermission(permission)}>{state.checked ? <Check /> : state.partial ? <CircleMinus /> : null}{state.checked ? '已授权' : state.partial ? '部分' : '授权'}</Button><Button size="icon-sm" variant="ghost" title="新增子权限" onClick={() => openPermission(undefined, permission.id)}><Plus /></Button><Button size="icon-sm" variant="ghost" title="编辑权限" onClick={() => openPermission(permission)}><Pencil /></Button><Button size="icon-sm" variant="ghost" title="删除权限" onClick={() => void removePermission(permission)}><Trash2 className="text-destructive" /></Button></div></div>; })}{visibleRows.length === 0 && <div className="p-12 text-center text-sm text-muted-foreground">没有匹配的权限</div>}</div></div>}</section></main>
    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="sm:max-w-md"><form onSubmit={(event) => void createRole(event)}><DialogHeader><DialogTitle>新增角色</DialogTitle><DialogDescription>新角色会获得当前勾选并展开后的叶子权限。</DialogDescription></DialogHeader><div className="grid gap-4 py-4"><label className="grid gap-1.5 text-sm font-medium">角色名称<Input required maxLength={50} value={newRole.roleName} onChange={(event) => setNewRole({ ...newRole, roleName: event.target.value })} /></label><label className="grid gap-1.5 text-sm font-medium">角色编码<Input required maxLength={50} value={newRole.roleCode} onChange={(event) => setNewRole({ ...newRole, roleCode: event.target.value.toUpperCase() })} placeholder="ROLE_OPERATOR" pattern="ROLE_[A-Z0-9_]+" /></label><label className="grid gap-1.5 text-sm font-medium">角色说明<Textarea maxLength={200} value={newRole.description} onChange={(event) => setNewRole({ ...newRole, description: event.target.value })} /></label></div><DialogFooter><Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>取消</Button><Button disabled={creating} type="submit"><Plus />{creating ? '创建中…' : '创建角色'}</Button></DialogFooter></form></DialogContent></Dialog>
    <Dialog open={permissionDialogOpen} onOpenChange={(open) => { if (!open) setEditingPermission(undefined); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl"><form onSubmit={(event) => void savePermission(event)}><DialogHeader><DialogTitle>{editingPermission ? '编辑权限' : '新增权限'}</DialogTitle><DialogDescription>菜单、按钮和接口均可组成权限树；权限编码用于实际鉴权。</DialogDescription></DialogHeader><div className="grid gap-4 py-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium sm:col-span-2">上级权限<select className="h-8 rounded-lg border bg-background px-3 text-sm" value={permissionForm.parentId} onChange={(event) => setPermissionForm({ ...permissionForm, parentId: event.target.value })}><option value="0">根权限</option>{treeRows.filter((item) => item.id !== editingPermission?.id).map((item) => <option key={item.id} value={item.id}>{'　'.repeat(item.depth)}{item.permissionName}</option>)}</select></label><label className="grid gap-1.5 text-sm font-medium">权限名称<Input required maxLength={50} value={permissionForm.permissionName} onChange={(event) => setPermissionForm({ ...permissionForm, permissionName: event.target.value })} /></label><label className="grid gap-1.5 text-sm font-medium">权限编码<Input required maxLength={100} value={permissionForm.permissionCode} onChange={(event) => setPermissionForm({ ...permissionForm, permissionCode: event.target.value })} placeholder="document:export" /></label><label className="grid gap-1.5 text-sm font-medium">权限类型<select className="h-8 rounded-lg border bg-background px-3 text-sm" value={permissionForm.permissionType} onChange={(event) => setPermissionForm({ ...permissionForm, permissionType: Number(event.target.value) as PermissionType })}>{([1, 2, 3] as PermissionType[]).map((type) => <option key={type} value={type}>{typeMeta[type].label}</option>)}</select></label><label className="grid gap-1.5 text-sm font-medium">状态<select className="h-8 rounded-lg border bg-background px-3 text-sm" value={permissionForm.status} onChange={(event) => setPermissionForm({ ...permissionForm, status: Number(event.target.value) })}><option value={1}>启用</option><option value={0}>停用</option></select></label><label className="grid gap-1.5 text-sm font-medium">菜单路径<Input maxLength={200} value={permissionForm.menuUrl} onChange={(event) => setPermissionForm({ ...permissionForm, menuUrl: event.target.value })} placeholder="/documents" /></label><label className="grid gap-1.5 text-sm font-medium">接口路径<Input maxLength={500} value={permissionForm.apiUrl} onChange={(event) => setPermissionForm({ ...permissionForm, apiUrl: event.target.value })} placeholder="/documents/:id" /></label><label className="grid gap-1.5 text-sm font-medium">请求方法<Input maxLength={10} value={permissionForm.method} onChange={(event) => setPermissionForm({ ...permissionForm, method: event.target.value.toUpperCase() })} placeholder="GET / POST" /></label><label className="grid gap-1.5 text-sm font-medium">排序<Input type="number" value={permissionForm.sort} onChange={(event) => setPermissionForm({ ...permissionForm, sort: Number(event.target.value) || 0 })} /></label></div><DialogFooter><Button type="button" variant="outline" onClick={() => setEditingPermission(undefined)}>取消</Button><Button disabled={savingPermission} type="submit"><Save />{savingPermission ? '保存中…' : '保存权限'}</Button></DialogFooter></form></DialogContent></Dialog>
  </div>;
}
