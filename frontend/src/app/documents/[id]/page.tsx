'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Archive, ArrowLeft, Edit, Eye, Loader2, Send, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { documentService } from '@/services/document.service';
import { KnowledgeDocument, ReviewTask } from '@/types/api.types';
import { DocumentStatusBadge, statusLabel } from '@/components/documents/document-status';
import { useAuthStore } from '@/stores/auth.store';

export default function DocumentDetailPage() {
  return (
    <Suspense fallback={null}>
      <DocumentDetailPageContent />
    </Suspense>
  );
}

function DocumentDetailPageContent() {
  const { id } = useParams<{ id: string }>(); const router = useRouter(); const searchParams = useSearchParams();
  const { user, loadFromStorage } = useAuthStore();
  const [doc, setDoc] = useState<KnowledgeDocument>(); const [history, setHistory] = useState<ReviewTask[]>([]); const [error, setError] = useState(''); const [running, setRunning] = useState(false);
  const canManage = (document: KnowledgeDocument) => Boolean(user && (user.role === 1 || document.authorId === user.id || document.createBy === user.id));
  const citationChunkId = searchParams.get('citation');
  const load = async () => { try { const document = await documentService.get(id); setDoc(document); if (canManage(document)) setHistory(await documentService.reviewHistory(id)); else setHistory([]); } catch (e) { setError(e instanceof Error ? e.message : '无法加载文档'); } };
  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);
  useEffect(() => { void Promise.resolve().then(load); // API response, rather than the effect itself, updates UI state
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user]);
  const action = async (name: 'publish' | 'archive' | 'saveDraft' | 'submitReview') => { if (!doc) return; setRunning(true); try { const updated = await documentService[name](doc.id); setDoc(updated); await load(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); } finally { setRunning(false); } };
  if (error && !doc) return <div className="p-6 text-destructive">{error}</div>;
  if (!doc) return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin" /></div>;
  const editable = canManage(doc);
  return <div className="h-full overflow-auto"><header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-6 py-4 backdrop-blur"><div className="flex items-center gap-3"><Button variant="ghost" size="icon" onClick={() => router.push('/documents')}><ArrowLeft /></Button><DocumentStatusBadge status={doc.status} /></div>{editable && <div className="flex gap-2"><Button nativeButton={false} variant="outline" render={<Link href={`/documents/${doc.id}/edit`}><Edit />编辑</Link>} disabled={doc.status === 3} />{doc.status === 0 && <Button onClick={() => void action('publish')} disabled={running}><Send />发布 / 提审</Button>}{doc.status === 1 && <><Button variant="outline" onClick={() => void action('saveDraft')} disabled={running}><Upload />下架</Button><Button variant="outline" onClick={() => void action('archive')} disabled={running}><Archive />归档</Button><Button onClick={() => void action('submitReview')} disabled={running}><Send />提交审核</Button></>}{doc.status === 2 && <Button onClick={() => void action('publish')} disabled={running}><Send />重新发布</Button>}</div>}</header><div className="mx-auto grid max-w-6xl gap-8 px-6 py-10 lg:grid-cols-[minmax(0,1fr)_250px]"><article><div className="mb-8 border-b pb-7"><h1 className="text-3xl font-bold tracking-tight">{doc.title}</h1><div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground"><span>{new Date(doc.createdAt).toLocaleString('zh-CN')}</span><span className="flex items-center gap-1"><Eye className="size-4" />{doc.viewCount} 次浏览</span>{doc.tags?.split(',').filter(Boolean).map((tag) => <span className="rounded-full bg-muted px-2 py-0.5" key={tag}>{tag.trim()}</span>)}</div>{doc.summary && <p className="mt-5 rounded-r-lg border-l-4 border-primary/50 bg-muted/50 px-4 py-3 text-muted-foreground">{doc.summary}</p>}</div>{citationChunkId && <section className="mb-6 rounded-lg border-l-4 border-primary bg-primary/5 px-4 py-3"><p className="text-sm text-muted-foreground">此文档是当前 AI 回答的引用来源。</p></section>}<div className="prose prose-slate max-w-none dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content || ''}</ReactMarkdown></div></article><aside className="h-fit rounded-xl border bg-card p-4"><h2 className="font-semibold">文档信息</h2><dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-3"><dt className="text-muted-foreground">状态</dt><dd>{statusLabel(doc.status)}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">字数</dt><dd>{doc.wordCount || (doc.content?.length ?? 0)}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">公开</dt><dd>{doc.isPublic ? '是' : '否'}</dd></div></dl>{editable && history.length > 0 && <><h2 className="mt-7 border-t pt-5 font-semibold">审核记录</h2><ol className="mt-4 space-y-4 border-l pl-4">{history.map((item) => <li key={item.id} className="relative text-sm before:absolute before:-left-[21px] before:top-1 before:size-2 before:rounded-full before:bg-primary"><p>{item.reviewResult === 1 ? '审核通过' : item.reviewResult === 2 ? '审核驳回' : '等待审核'}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString('zh-CN')}</p>{item.reviewComment && <p className="mt-1 text-muted-foreground">{item.reviewComment}</p>}</li>)}</ol></>}</aside></div>{error && <div className="fixed right-4 bottom-4 rounded-lg bg-destructive px-4 py-3 text-sm text-destructive-foreground">{error}</div>}</div>;
}
