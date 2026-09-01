'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2, Network, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { knowledgeGraphService } from '@/services/knowledge-graph.service';
import { KnowledgeGraph, KnowledgeGraphNode } from '@/types/api.types';

const colors: Record<string, string> = {
  PERSON: '#f97316', ORGANIZATION: '#2563eb', CONCEPT: '#7c3aed', DOCUMENT: '#0891b2',
  PROCESS: '#16a34a', PRODUCT: '#db2777', LOCATION: '#ca8a04', TIME: '#64748b',
  POLICY: '#dc2626', RESOURCE: '#0f766e',
};

function position(index: number, total: number) {
  const angle = (Math.PI * 2 * index) / Math.max(total, 1) - Math.PI / 2;
  const ring = index < 12 ? 30 : 41 + ((index % 3) * 8);
  return { x: 50 + Math.cos(angle) * ring, y: 50 + Math.sin(angle) * ring };
}

export default function KnowledgeGraphPage() {
  return <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div>}><KnowledgeGraphContent /></Suspense>;
}

function KnowledgeGraphContent() {
  const searchParams = useSearchParams();
  const documentId = searchParams.get('documentId') ?? undefined;
  const [graph, setGraph] = useState<KnowledgeGraph>({ nodes: [], edges: [] });
  const [selected, setSelected] = useState<KnowledgeGraphNode>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setGraph(documentId ? await knowledgeGraphService.getForDocument(documentId) : await knowledgeGraphService.get()); setSelected(undefined); }
    catch (e) { setError(e instanceof Error ? e.message : '无法加载知识图谱'); }
    finally { setLoading(false); }
  }, [documentId]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const layout = useMemo(() => new Map(graph.nodes.map((node, index) => [node.id, position(index, graph.nodes.length)])), [graph.nodes]);
  const connected = useMemo(() => selected ? new Set(graph.edges.filter((edge) => edge.source === selected.id || edge.target === selected.id).flatMap((edge) => [edge.source, edge.target])) : null, [graph.edges, selected]);

  return <div className="flex h-full flex-col overflow-hidden">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-5">
      <div><h1 className="flex items-center gap-2 text-2xl font-semibold"><Network className="size-6 text-primary" />{documentId ? '文档知识图谱' : '知识图谱'}</h1><p className="mt-1 text-sm text-muted-foreground">{documentId ? '展示当前文档中抽取的实体及其关系' : '浏览已发布文档中抽取的实体及其关系'}</p></div>
      <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />刷新</Button>
    </header>
    {error ? <div className="m-6 rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{error}</div> : loading ? <div className="flex flex-1 items-center justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div> : graph.nodes.length === 0 ? <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground"><Network className="size-10" /><p>暂时没有可展示的图谱数据</p><p className="text-sm">发布包含正文的文档后，系统会异步抽取实体与关系。</p></div> : <main className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="relative min-h-[520px] overflow-auto bg-[radial-gradient(circle_at_1px_1px,hsl(var(--border))_1px,transparent_0)] bg-[size:20px_20px] p-6">
        <div className="relative mx-auto h-[680px] min-w-[720px] max-w-[1100px] rounded-2xl border bg-background/85 shadow-sm">
          <svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
            {graph.edges.map((edge, index) => { const a = layout.get(edge.source); const b = layout.get(edge.target); if (!a || !b) return null; const faded = selected && edge.source !== selected.id && edge.target !== selected.id; return <line key={`${edge.source}-${edge.target}-${index}`} x1={`${a.x}%`} y1={`${a.y}%`} x2={`${b.x}%`} y2={`${b.y}%`} stroke={faded ? '#cbd5e1' : '#94a3b8'} strokeWidth={Math.max(1, edge.weight * 2)} opacity={faded ? .25 : .7} />; })}
          </svg>
          {graph.nodes.map((node) => { const p = layout.get(node.id)!; const active = !connected || connected.has(node.id); return <button key={node.id} onClick={() => setSelected(node)} title={node.name} style={{ left: `${p.x}%`, top: `${p.y}%`, borderColor: colors[node.type] ?? colors.CONCEPT }} className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-background px-3 py-2 text-xs font-medium shadow-sm transition hover:scale-105 ${active ? 'opacity-100' : 'opacity-25'}`}><span className="block max-w-24 truncate">{node.name}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{node.type}</span></button>; })}
        </div>
      </section>
      <aside className="overflow-auto border-l bg-card p-5">
        {selected ? <div><div className="flex items-start justify-between gap-3"><div><span className="rounded-full px-2 py-1 text-xs text-white" style={{ backgroundColor: colors[selected.type] ?? colors.CONCEPT }}>{selected.type}</span><h2 className="mt-3 text-xl font-semibold">{selected.name}</h2></div><Button size="icon-sm" variant="ghost" onClick={() => setSelected(undefined)} aria-label="关闭详情"><X /></Button></div>
          {selected.description && <p className="mt-4 text-sm leading-6 text-muted-foreground">{selected.description}</p>}
          <dl className="mt-5 space-y-3 border-y py-4 text-sm"><div className="flex justify-between"><dt className="text-muted-foreground">关联文档块</dt><dd>{selected.mentions}</dd></div><div className="flex justify-between"><dt className="text-muted-foreground">关系数</dt><dd>{graph.edges.filter((edge) => edge.source === selected.id || edge.target === selected.id).length}</dd></div></dl>
          {selected.aliases.length > 0 && <div className="mt-5"><h3 className="text-sm font-medium">别名</h3><p className="mt-2 text-sm text-muted-foreground">{selected.aliases.join('、')}</p></div>}
          {selected.documents.length > 0 && <div className="mt-5"><h3 className="text-sm font-medium">来源文档</h3><ul className="mt-2 space-y-2">{selected.documents.map((doc) => <li key={doc.id}><Link className="text-sm text-primary hover:underline" href={`/documents/${doc.id}`}>{doc.title}</Link></li>)}</ul></div>}
        </div> : <div className="flex h-full flex-col justify-center text-center text-sm text-muted-foreground"><Network className="mx-auto mb-3 size-8" /><p>点击图中的实体查看详情、关联文档和关系。</p><p className="mt-5 text-xs">实体 {graph.nodes.length} 个 · 关系 {graph.edges.length} 条</p></div>}
      </aside>
    </main>}
  </div>;
}
