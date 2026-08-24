'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Eye, Loader2, Save, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DocumentStatusBadge } from './document-status';
import { documentService } from '@/services/document.service';
import { KnowledgeDocument } from '@/types/api.types';

export function DocumentEditor({ initialDocument }: { initialDocument?: KnowledgeDocument }) {
  const router = useRouter();
  const [title, setTitle] = useState(initialDocument?.title ?? '');
  const [content, setContent] = useState(initialDocument?.content ?? '');
  const [summary, setSummary] = useState(initialDocument?.summary ?? '');
  const [tags, setTags] = useState(initialDocument?.tags ?? '');
  const [isPublic, setIsPublic] = useState(initialDocument?.isPublic ?? false);
  const [document, setDocument] = useState(initialDocument);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!document?.id || document.status === 3) return;
    const timer = window.setTimeout(() => {
      if (title.trim() && (title !== document.title || content !== document.content)) void save(true);
    }, 3000);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content]);

  const payload = () => ({ title: title.trim(), content, summary: summary.trim() || undefined, tags: tags.trim() || undefined, isPublic });
  async function save(silent = false) {
    if (!title.trim()) { setMessage('请先填写文档标题'); return; }
    setSaving(true);
    try {
      const result = document
        ? await documentService.update(document.id, payload())
        : await documentService.create({ ...payload(), status: 0 });
      setDocument(result);
      setMessage(silent ? '已自动保存' : '草稿已保存');
      if (!initialDocument) router.replace(`/documents/${result.id}/edit`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setSaving(false); }
  }
  async function publish() {
    if (!document) { await save(); return; }
    setSaving(true);
    try { const result = await documentService.publish(document.id); setDocument(result); setMessage(result.status === 3 ? '已提交审核' : '文档已发布'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '发布失败'); }
    finally { setSaving(false); }
  }
  const submit = (event: FormEvent) => { event.preventDefault(); void save(); };

  return <div className="flex h-full flex-col">
    <header className="flex shrink-0 items-center justify-between border-b px-6 py-4">
      <div className="flex items-center gap-3"><Button variant="ghost" size="icon" onClick={() => router.push('/documents')}><ArrowLeft /></Button><div><h1 className="text-xl font-semibold">{document ? '编辑文档' : '新建文档'}</h1><p className="text-sm text-muted-foreground">{document ? <><DocumentStatusBadge status={document.status} /> <span className="ml-2">{message || '支持 Markdown，3 秒后自动保存'}</span></> : '创建你的第一篇知识文档'}</p></div></div>
      <div className="flex gap-2"><Button variant="outline" onClick={() => document && router.push(`/documents/${document.id}`)} disabled={!document}><Eye />预览</Button><Button variant="outline" onClick={() => void save()} disabled={saving}><Save />保存</Button><Button onClick={() => void publish()} disabled={saving || document?.status === 3}>{saving ? <Loader2 className="animate-spin" /> : <Send />}{document ? '发布 / 提审' : '保存后发布'}</Button></div>
    </header>
    <form onSubmit={submit} className="grid flex-1 grid-cols-1 gap-6 overflow-auto p-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="flex min-h-0 flex-col gap-4"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="请输入文档标题" className="h-12 text-xl font-semibold" disabled={document?.status === 3} /><Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="# 开始撰写\n\n支持 Markdown 格式…" className="min-h-[480px] flex-1 resize-none font-mono leading-7" disabled={document?.status === 3} /></div>
      <aside className="space-y-5 rounded-xl border bg-card p-4"><div><label className="text-sm font-medium">摘要</label><Textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="简短描述文档内容" className="mt-2 min-h-24" /></div><div><label className="text-sm font-medium">标签</label><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="例如：产品,教程" className="mt-2" /><p className="mt-1 text-xs text-muted-foreground">使用逗号分隔多个标签</p></div><label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />公开给所有人查看</label>{message && <p className="flex items-center gap-1 text-xs text-muted-foreground"><Check className="size-3" />{message}</p>}</aside>
    </form>
  </div>;
}
