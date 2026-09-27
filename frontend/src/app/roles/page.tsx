'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, ChevronRight, CircleMinus, Loader2, Plus, Save, Shield, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Permission, RoleWithPermissions } from '@/types/api.types';
import { rbacService } from '@/services/rbac.service';
import { useAuthStore } from '@/stores/auth.store';

type PermissionTreeNode = Permission & { children: PermissionTreeNode[]; leafIds: string[] };

function buildPermissionTree(items: Permission[]): PermissionTreeNode[] {
  const byParent = new Map<string, Permission[]>();
  items.forEach((item) => byParent.set(item.parentId, [...(byParent.get(item.parentId) ?? []), item]));
  const visited = new Set<string>();
  const visit = (parentId: string): PermissionTreeNode[] => (byParent.get(parentId) ?? []).flatMap((item) => {
    if (visited.has(item.id)) return [];
    visited.add(item.id);
    const children = visit(item.id);
    return [{ ...item, children, leafIds: children.length ? children.flatMap((child) => child.leafIds) : [item.id] }];
  });
  const roots = visit('0');
  // 孤儿节点也展示出来，避免迁移中的权限无法授权。
  items.filter((item) => !visited.has(item.id)).forEach((item) => {
    visited.add(item.id);
    const children = visit(item.id);
    roots.push({ ...item, children, leafIds: children.length ? children.flatMap((child) => child.leafIds) : [item.id] });
  });
  return roots;
}

export default function RolesPage() {
  const router = useRouter();
  const { user, loadFromStorage } = useAuthStore();
  const [roles, setRoles] = useState<RoleWithPermissions[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [activeId, setActiveId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newRole, setNewRole] = useState({ roleName: '', roleCode: '', description: '' });
  const selectRole = (role: RoleWithPermissions) => { setActiveId(role.id); setSelected(role.permissionIds); };
  const load = useCallback(async () => { setLoading(true); setError(''); try { const [nextRoles, nextPermissions] = await Promise.all([rbacService.listRoles(), rbacService.listPermissions()]); setRoles(nextRoles); setPermissions(nextPermissions); if (nextRoles[0]) selectRole(nextRoles[0]); } catch (cause) { setError(cause instanceof Error ? cause.message : '无法加载角色数据'); } finally { setLoading(false); } }, []);
  useEffect(() => { void loadFromStorage().then((ok) => { if (!ok) return router.replace('/login?next=/roles'); if (!useAuthStore.getState().user?.roles.includes('ROLE_ADMIN')) return router.replace('/chat'); void load(); }); }, [load, loadFromStorage, router]);
  const permissionTree = useMemo(() => buildPermissionTree(permissions), [permissions]);
  const active = roles.find((role) => role.id === activeId);
  const authorizationState = (node: PermissionTreeNode) => { const amount = node.leafIds.filter((id) => selected.includes(id)).length; return { checked: amount === node.leafIds.length, partial: amount > 0 && amount < node.leafIds.length }; };
  const toggleAuthorization = (node: PermissionTreeNode) => setSelected((current) => node.leafIds.every((id) => current.includes(id)) ? current.filter((id) => !node.leafIds.includes(id)) : [...new Set([...current, ...node.leafIds])]);
  const toggleExpanded = (id: string) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const save = async () => { if (!active) return; setSaving(true); setError(''); try { const result = await rbacService.replaceRolePermissions(active.id, selected); setSelected(result.permissionIds); setRoles((current) => current.map((role) => role.id === active.id ? { ...role, permissionIds: result.permissionIds } : role)); } catch (cause) { setError(cause instanceof Error ? cause.message : '保存角色授权失败'); } finally { setSaving(false); } };
  const create = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setCreating(true); setError(''); try { const role = await rbacService.createRole({ ...newRole, permissionIds: [] }); setRoles((current) => [...current, role]); selectRole(role); setNewRole({ roleName: '', roleCode: '', description: '' }); setCreateOpen(false); } catch (cause) { setError(cause instanceof Error ? cause.message : '创建角色失败'); } finally { setCreating(false); } };
  if (!user?.roles.includes('ROLE_ADMIN')) return null;
  const renderNode = (node: PermissionTreeNode, depth = 0): React.ReactNode => { const hasChildren = node.children.length > 0; const isExpanded = expanded.has(node.id); const current = authorizationState(node); return <li key={node.id} className="list-none"><div className="flex min-h-11 items-center gap-2 rounded-md pr-2 hover:bg-muted/60" style={{ paddingLeft: `${12 + depth * 24}px` }}>{hasChildren ? <button type="button" className="grid size-6 shrink-0 place-items-center rounded hover:bg-muted" onClick={() => toggleExpanded(node.id)} aria-label={isExpanded ? `收起 ${node.permissionName}` : `展开 ${node.permissionName}`}><ChevronDown className={`size-4 transition-transform ${isExpanded ? '' : '-rotate-90'}`} /></button> : <span className="size-6 shrink-0" />}<div className="min-w-0 flex-1 py-2"><p className="truncate text-sm font-medium">{node.permissionName}</p><p className="truncate text-xs text-muted-foreground">{node.permissionCode}</p></div><Button size="sm" variant={current.checked ? 'default' : 'outline'} onClick={() => toggleAuthorization(node)}>{current.checked ? <Check /> : current.partial ? <CircleMinus /> : null}{current.checked ? '已授权' : current.partial ? '部分' : '授权'}</Button></div>{hasChildren && isExpanded && <ul className="relative before:absolute before:bottom-2 before:left-[23px] before:top-0 before:border-l before:border-border">{node.children.map((child) => renderNode(child, depth + 1))}</ul>}</li>; };
  return <div className="flex h-full flex-col overflow-auto"><header className="flex flex-wrap items-start justify-between gap-4 border-b px-6 py-5"><div><div className="flex items-center gap-2"><Shield className="size-5 text-primary" /><h1 className="text-2xl font-semibold">角色管理</h1></div><p className="mt-1 text-sm text-muted-foreground">将已定义的权限组合成角色，并向用户分配角色</p></div><div className="flex gap-2"><Button variant="outline" onClick={() => setCreateOpen(true)}><Plus />新增角色</Button><Button disabled={!active || saving} onClick={() => void save()}><Save />{saving ? '保存中…' : '保存授权'}</Button></div></header><main className="flex min-h-0 flex-1 flex-col gap-5 p-6 lg:flex-row"><aside className="w-full shrink-0 rounded-xl border bg-card lg:w-64"><div className="border-b px-4 py-3"><h2 className="font-medium">角色</h2><p className="mt-0.5 text-xs text-muted-foreground">选择角色配置权限</p></div><div className="p-2">{roles.map((role) => <button key={role.id} type="button" onClick={() => selectRole(role)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors ${activeId === role.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}><span><span className="block text-sm font-medium">{role.roleName}</span><span className={`block text-xs ${activeId === role.id ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{role.roleCode}</span></span><ChevronRight className="size-4" /></button>)}</div></aside><section className="min-w-0 flex-1 rounded-xl border bg-card"><div className="border-b px-5 py-4"><h2 className="font-medium">{active?.roleName ?? '角色权限'}</h2><p className="mt-0.5 text-xs text-muted-foreground">已授权 {selected.length} 项叶子权限；新增子权限不会自动扩权</p></div>{error && <div className="m-4 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"><ShieldAlert className="size-4" />{error}</div>}{loading ? <div className="flex justify-center p-16"><Loader2 className="animate-spin text-muted-foreground" /></div> : <div className="p-3"><ul className="space-y-1">{permissionTree.map((node) => renderNode(node))}</ul>{permissionTree.length === 0 && <div className="p-12 text-center text-sm text-muted-foreground">请先在权限管理中创建权限</div>}</div>}</section></main><Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="sm:max-w-md"><form onSubmit={(event) => void create(event)}><DialogHeader><DialogTitle>新增角色</DialogTitle><DialogDescription>创建后可在当前页面单独配置该角色的权限。</DialogDescription></DialogHeader><div className="grid gap-4 py-4"><label className="grid gap-1.5 text-sm font-medium">角色名称<Input required maxLength={50} value={newRole.roleName} onChange={(event) => setNewRole({ ...newRole, roleName: event.target.value })} /></label><label className="grid gap-1.5 text-sm font-medium">角色编码<Input required maxLength={50} value={newRole.roleCode} onChange={(event) => setNewRole({ ...newRole, roleCode: event.target.value.toUpperCase() })} placeholder="ROLE_OPERATOR" pattern="ROLE_[A-Z0-9_]+" /></label><label className="grid gap-1.5 text-sm font-medium">角色说明<Textarea maxLength={200} value={newRole.description} onChange={(event) => setNewRole({ ...newRole, description: event.target.value })} /></label></div><DialogFooter><Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>取消</Button><Button disabled={creating} type="submit"><Plus />{creating ? '创建中…' : '创建角色'}</Button></DialogFooter></form></DialogContent></Dialog></div>;
}
