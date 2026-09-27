'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  ChevronRight,
  Loader2,
  Plus,
  Save,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { RoleWithPermissions, TeamNode, TeamUser } from '@/types/api.types';
import { TeamPayload, teamService } from '@/services/team.service';
import { rbacService } from '@/services/rbac.service';
import { useAuthStore } from '@/stores/auth.store';

type FlatTeam = TeamNode & { depth: number };
const blankForm: TeamPayload = { teamName: '', parentId: '0', sort: 0, status: 1 };

function flatten(nodes: TeamNode[], depth = 0): FlatTeam[] {
  return nodes.flatMap((node) => [
    { ...node, depth },
    ...flatten(node.children, depth + 1),
  ]);
}

export default function TeamsPage() {
  const router = useRouter();
  const { user, loadFromStorage } = useAuthStore();
  const [teams, setTeams] = useState<TeamNode[]>([]);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<TeamPayload>(blankForm);
  const [newMemberId, setNewMemberId] = useState('');
  const [roles, setRoles] = useState<RoleWithPermissions[]>([]);
  const [teamRoleIds, setTeamRoleIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isAdmin = user?.roles.includes('ROLE_ADMIN');
  const flatTeams = useMemo(() => flatten(teams), [teams]);
  const selected = flatTeams.find((team) => team.id === selectedId);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextTeams, nextUsers, nextRoles] = await Promise.all([teamService.list(), teamService.users(), rbacService.listRoles()]);
      setTeams(nextTeams);
      setUsers(nextUsers);
      setRoles(nextRoles);
      if (selectedId && !flatten(nextTeams).some((team) => team.id === selectedId)) {
        setSelectedId(null);
        setForm(blankForm);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法加载组织架构');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void loadFromStorage().then((authenticated) => {
      if (!authenticated) {
        router.replace('/login?next=/teams');
        return;
      }
      if (!useAuthStore.getState().user?.roles.includes('ROLE_ADMIN')) {
        router.replace('/chat');
        return;
      }
      void load();
    });
  }, [load, loadFromStorage, router]);

  const selectTeam = (team: FlatTeam) => {
    setSelectedId(team.id);
    setForm({ teamName: team.teamName, teamCode: team.teamCode || '', description: team.description || '', leaderId: team.leaderId || '', parentId: team.parentId, sort: team.sort, status: team.status });
    setNewMemberId('');
    void teamService.roles(team.id).then(setTeamRoleIds).catch((cause) => setError(cause instanceof Error ? cause.message : '无法加载团队角色'));
  };
  const createTeam = () => {
    setSelectedId(null);
    setForm({ ...blankForm, parentId: selected?.id || '0' });
    setNewMemberId('');
    setTeamRoleIds([]);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.teamName.trim()) { setError('请填写部门名称'); return; }
    setSaving(true);
    setError('');
    const payload = { ...form, leaderId: form.leaderId || undefined, teamCode: form.teamCode || undefined, description: form.description || undefined };
    try {
      const result = selectedId ? await teamService.update(selectedId, payload) : await teamService.create(payload as TeamPayload);
      setSelectedId(result.id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存部门失败');
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!selectedId || !selected || !window.confirm(`确定删除「${selected.teamName}」吗？`)) return;
    try {
      await teamService.remove(selectedId);
      setSelectedId(null);
      setForm(blankForm);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除部门失败');
    }
  };
  const addMember = async () => {
    if (!selectedId || !newMemberId) return;
    try {
      await teamService.addMember(selectedId, newMemberId);
      setNewMemberId('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '添加成员失败');
    }
  };
  const removeMember = async (userId: string) => {
    if (!selectedId) return;
    try {
      await teamService.removeMember(selectedId, userId);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '移除成员失败');
    }
  };
  const saveTeamRoles = async () => {
    if (!selectedId) return;
    setSaving(true);
    setError('');
    try { const result = await teamService.replaceRoles(selectedId, teamRoleIds); setTeamRoleIds(result.roleIds); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存团队角色失败'); }
    finally { setSaving(false); }
  };

  if (!user || !isAdmin) return null;

  return <div className="flex h-full flex-col overflow-auto"><header className="flex flex-wrap items-start justify-between gap-4 border-b px-6 py-5"><div><div className="flex items-center gap-2"><Building2 className="size-5 text-primary" /><h1 className="text-2xl font-semibold">团队管理</h1></div><p className="mt-1 text-sm text-muted-foreground">维护公司多级部门、负责人和成员归属</p></div><Button onClick={createTeam}><Plus />新建部门</Button></header><main className="grid min-h-0 flex-1 gap-5 p-6 lg:grid-cols-[320px_minmax(0,1fr)]"><aside className="rounded-xl border bg-card"><div className="border-b px-4 py-3"><h2 className="font-medium">组织架构</h2><p className="mt-0.5 text-xs text-muted-foreground">共 {flatTeams.length} 个部门</p></div>{loading ? <div className="flex justify-center p-12"><Loader2 className="animate-spin text-muted-foreground" /></div> : flatTeams.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">尚未创建部门</div> : <div className="p-2">{flatTeams.map((team) => <button key={team.id} type="button" onClick={() => selectTeam(team)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${selectedId === team.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`} style={{ paddingLeft: `${10 + team.depth * 20}px` }}><ChevronRight className={`size-3.5 shrink-0 ${team.children.length ? '' : 'invisible'}`} /><span className="truncate font-medium">{team.teamName}</span>{team.status === 0 && <span className="ml-auto text-xs opacity-70">已停用</span>}</button>)}</div>}</aside><section className="rounded-xl border bg-card"><form onSubmit={(event) => void save(event)} className="p-5"><div className="mb-5 flex items-center justify-between border-b pb-4"><div><h2 className="font-medium">{selected ? '编辑部门' : '新建部门'}</h2><p className="mt-0.5 text-xs text-muted-foreground">负责人会自动成为该部门成员</p></div>{selected && <Button type="button" variant="destructive" size="sm" onClick={() => void remove()}><Trash2 />删除</Button>}</div>{error && <div className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}<div className="grid gap-4 md:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">部门名称<Input value={form.teamName} onChange={(event) => setForm({ ...form, teamName: event.target.value })} maxLength={100} placeholder="例如：产品研发中心" /></label><label className="grid gap-1.5 text-sm font-medium">部门编码<Input value={form.teamCode || ''} onChange={(event) => setForm({ ...form, teamCode: event.target.value })} maxLength={50} placeholder="例如：RD" /></label><label className="grid gap-1.5 text-sm font-medium">上级部门<select className="h-8 rounded-lg border bg-background px-3 text-sm" value={form.parentId || '0'} onChange={(event) => setForm({ ...form, parentId: event.target.value })}><option value="0">公司根部门</option>{flatTeams.filter((team) => team.id !== selectedId).map((team) => <option key={team.id} value={team.id}>{'　'.repeat(team.depth)}{team.teamName}</option>)}</select></label><label className="grid gap-1.5 text-sm font-medium">负责人<select className="h-8 rounded-lg border bg-background px-3 text-sm" value={form.leaderId || ''} onChange={(event) => setForm({ ...form, leaderId: event.target.value })}><option value="">暂不指定</option>{users.map((member) => <option key={member.id} value={member.id}>{member.nickname || member.username}（{member.username}）</option>)}</select></label><label className="grid gap-1.5 text-sm font-medium">排序<Input type="number" value={form.sort ?? 0} onChange={(event) => setForm({ ...form, sort: Number(event.target.value) || 0 })} /></label><label className="grid gap-1.5 text-sm font-medium">状态<select className="h-8 rounded-lg border bg-background px-3 text-sm" value={form.status ?? 1} onChange={(event) => setForm({ ...form, status: Number(event.target.value) })}><option value={1}>启用</option><option value={0}>停用</option></select></label></div><label className="mt-4 grid gap-1.5 text-sm font-medium">部门说明<Textarea value={form.description || ''} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={500} placeholder="简要说明部门职责" /></label><div className="mt-5 flex justify-end"><Button disabled={saving} type="submit"><Save />{saving ? '保存中…' : '保存部门'}</Button></div></form>{selected && <><div className="border-t p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-medium">部门角色</h2><p className="mt-0.5 text-xs text-muted-foreground">成员将继承本部门及上级部门角色；本部门角色也会继承给下级部门成员。</p></div><Button type="button" size="sm" disabled={saving} onClick={() => void saveTeamRoles()}><Save />保存角色</Button></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{roles.length === 0 ? <span className="text-sm text-muted-foreground">暂无可授予角色</span> : roles.map((role) => <label key={role.id} className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" className="mt-0.5 size-4" checked={teamRoleIds.includes(role.id)} onChange={(event) => setTeamRoleIds((current) => event.target.checked ? [...new Set([...current, role.id])] : current.filter((id) => id !== role.id))} /><span><span className="block font-medium">{role.roleName}</span><span className="block text-xs text-muted-foreground">{role.description || role.roleCode}</span></span></label>)}</div></div><div className="border-t p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 font-medium"><Users className="size-4" />部门成员</h2><p className="mt-0.5 text-xs text-muted-foreground">负责人不能直接移除</p></div><div className="flex gap-2"><select className="h-8 max-w-56 rounded-lg border bg-background px-3 text-sm" value={newMemberId} onChange={(event) => setNewMemberId(event.target.value)}><option value="">选择员工</option>{users.filter((member) => !selected.members.some((existing) => existing.userId === member.id)).map((member) => <option key={member.id} value={member.id}>{member.nickname || member.username}</option>)}</select><Button type="button" size="sm" variant="outline" disabled={!newMemberId} onClick={() => void addMember()}><UserPlus />添加</Button></div></div><div className="mt-3 flex flex-wrap gap-2">{selected.members.length === 0 ? <span className="text-sm text-muted-foreground">暂无成员</span> : selected.members.map((member) => <div key={member.userId} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm"><span>{member.nickname || member.username}</span><Badge variant={member.memberRole === 'leader' ? 'default' : 'outline'}>{member.memberRole === 'leader' ? '负责人' : '成员'}</Badge>{member.memberRole !== 'leader' && <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => void removeMember(member.userId)} aria-label={`移除 ${member.username}`}><Trash2 className="size-3.5" /></button>}</div>)}</div></div></>}</section></main></div>;
}
