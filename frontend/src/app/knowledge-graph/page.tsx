'use client';

import { PointerEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2, Minus, Network, Plus, RefreshCw, RotateCcw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { knowledgeGraphService } from '@/services/knowledge-graph.service';
import { KnowledgeGraph, KnowledgeGraphNode } from '@/types/api.types';

const colors: Record<string, string> = {
  PERSON: '#f97316', ORGANIZATION: '#2563eb', CONCEPT: '#7c3aed', DOCUMENT: '#0891b2',
  PROCESS: '#16a34a', PRODUCT: '#db2777', LOCATION: '#ca8a04', TIME: '#64748b',
  POLICY: '#dc2626', RESOURCE: '#0f766e',
};

type Position = { x: number; y: number };

function position(index: number, total: number) {
  const angle = (Math.PI * 2 * index) / Math.max(total, 1) - Math.PI / 2;
  const ring = index < 12 ? 30 : 41 + ((index % 3) * 8);
  // 给节点标签预留边距，避免外层节点越过图画布的圆角边框。
  const clamp = (value: number) => Math.max(10, Math.min(90, value));
  return {
    x: clamp(50 + Math.cos(angle) * ring),
    y: clamp(50 + Math.sin(angle) * ring),
  };
}

export default function KnowledgeGraphPage() {
  return <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div>}><KnowledgeGraphContent /></Suspense>;
}

function KnowledgeGraphContent() {
  const searchParams = useSearchParams();
  const documentId = searchParams.get('documentId') ?? undefined;
  const [graph, setGraph] = useState<KnowledgeGraph>({ nodes: [], edges: [] });
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [selected, setSelected] = useState<KnowledgeGraphNode>();
  const [draggingId, setDraggingId] = useState<string>();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState<{ x: number; y: number; pointerX: number; pointerY: number }>();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = documentId ? await knowledgeGraphService.getForDocument(documentId) : await knowledgeGraphService.get();
      setGraph(result);
      setPositions(Object.fromEntries(result.nodes.map((node, index) => [node.id, position(index, result.nodes.length)])));
      setSelected(undefined); setZoom(1); setPan({ x: 0, y: 0 }); setQuery('');
    }
    catch (e) { setError(e instanceof Error ? e.message : '无法加载知识图谱'); }
    finally { setLoading(false); }
  }, [documentId]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const connected = useMemo(() => selected ? new Set(graph.edges.filter((edge) => edge.source === selected.id || edge.target === selected.id).flatMap((edge) => [edge.source, edge.target])) : null, [graph.edges, selected]);

  const moveGraph = (event: PointerEvent<HTMLDivElement>) => {
    if (panStart) {
      setPan({ x: panStart.x + event.clientX - panStart.pointerX, y: panStart.y + event.clientY - panStart.pointerY });
      return;
    }
    if (!draggingId || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.min(90, Math.max(10, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.min(90, Math.max(10, ((event.clientY - rect.top) / rect.height) * 100));
    setPositions((current) => ({ ...current, [draggingId]: { x, y } }));
  };

  const resetView = () => {
    setPositions(Object.fromEntries(graph.nodes.map((node, index) => [node.id, position(index, graph.nodes.length)])));
    setZoom(1); setPan({ x: 0, y: 0 }); setSelected(undefined); setQuery('');
  };
  const changeZoom = (delta: number) => setZoom((value) => Math.min(2.5, Math.max(0.45, Number((value + delta).toFixed(2)))));

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((value) => Math.min(2.5, Math.max(0.45, Number((value + (event.deltaY < 0 ? 0.1 : -0.1)).toFixed(2)))));
    };
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [graph.nodes.length]);

  return <div className="flex h-full min-w-0 flex-col overflow-hidden">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-5">
      <div><h1 className="flex items-center gap-2 text-2xl font-semibold"><Network className="size-6 text-primary" />{documentId ? '文档知识图谱' : '知识图谱'}</h1><p className="mt-1 text-sm text-muted-foreground">{documentId ? '展示当前文档中抽取的实体及其关系' : '浏览已发布文档中抽取的实体及其关系'}</p></div>
      <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />刷新</Button>
    </header>
    {error ? <div className="m-6 rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{error}</div> : loading ? <div className="flex flex-1 items-center justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div> : graph.nodes.length === 0 ? <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground"><Network className="size-10" /><p>暂时没有可展示的图谱数据</p><p className="text-sm">发布包含正文的文档后，系统会异步抽取实体与关系。</p></div> : <main className="grid min-h-0 min-w-0 flex-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="flex min-h-[520px] min-w-0 flex-col gap-3 overflow-hidden bg-[radial-gradient(circle_at_1px_1px,hsl(var(--border))_1px,transparent_0)] bg-[size:20px_20px] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>实体 {graph.nodes.length} 个 · 关系 {graph.edges.length} 条</span>
          <div className="flex items-center gap-2">
            <div className="relative"><Search className="absolute left-2 top-2 size-3.5" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-8 w-44 pl-7 text-xs" placeholder="查找实体" /></div>
            <Button size="icon-sm" variant="outline" onClick={() => changeZoom(-0.15)} aria-label="缩小"><Minus /></Button>
            <span className="w-10 text-center text-xs">{Math.round(zoom * 100)}%</span>
            <Button size="icon-sm" variant="outline" onClick={() => changeZoom(0.15)} aria-label="放大"><Plus /></Button>
            <Button size="icon-sm" variant="outline" onClick={resetView} aria-label="重置视图"><RotateCcw /></Button>
          </div>
        </div>
        <div ref={viewportRef} className="relative min-h-0 flex-1 touch-none overscroll-contain overflow-hidden rounded-2xl border bg-background/85 shadow-sm">
          <div ref={canvasRef} onPointerDown={(event) => { if (event.target === event.currentTarget) { event.currentTarget.setPointerCapture(event.pointerId); setPanStart({ ...pan, pointerX: event.clientX, pointerY: event.clientY }); } }} onPointerMove={moveGraph} onPointerUp={() => { setDraggingId(undefined); setPanStart(undefined); }} onPointerLeave={() => { setDraggingId(undefined); setPanStart(undefined); }} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} className={`relative h-full w-full touch-none transition-transform ${panStart ? 'cursor-grabbing' : 'cursor-grab'}`}>
            <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
              {graph.edges.map((edge, index) => { const a = positions[edge.source]; const b = positions[edge.target]; if (!a || !b) return null; const active = selected && (edge.source === selected.id || edge.target === selected.id); const faded = Boolean((connected && !connected.has(edge.source)) || (query && !edge.source.toLowerCase().includes(query.toLowerCase()) && !edge.target.toLowerCase().includes(query.toLowerCase()))); return <g key={`${edge.source}-${edge.target}-${index}`}><line x1={`${a.x}%`} y1={`${a.y}%`} x2={`${b.x}%`} y2={`${b.y}%`} stroke={active ? '#2563eb' : '#94a3b8'} strokeWidth={active ? Math.max(2, edge.weight * 3) : Math.max(1, edge.weight * 2)} opacity={faded ? .12 : .7} />{active && <text x={`${(a.x + b.x) / 2}%`} y={`${(a.y + b.y) / 2}%`} textAnchor="middle" className="fill-primary text-[11px] font-medium">{edge.relation}</text>}</g>; })}
            </svg>
            {graph.nodes.map((node) => { const p = positions[node.id]; if (!p) return null; const matched = !query || node.name.toLowerCase().includes(query.toLowerCase()) || node.aliases.some((alias) => alias.toLowerCase().includes(query.toLowerCase())); const active = matched && (!connected || connected.has(node.id)); return <button key={node.id} onClick={() => setSelected(node)} onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setDraggingId(node.id); }} title={node.name} style={{ left: `${p.x}%`, top: `${p.y}%`, borderColor: colors[node.type] ?? colors.CONCEPT }} className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 bg-background px-3 py-2 text-xs font-medium shadow-sm transition active:cursor-grabbing ${selected?.id === node.id ? 'ring-2 ring-primary/20' : ''} ${active ? 'opacity-100' : 'opacity-20'}`}><span className="block max-w-24 truncate">{node.name}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{node.type}</span></button>; })}
          </div>
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
