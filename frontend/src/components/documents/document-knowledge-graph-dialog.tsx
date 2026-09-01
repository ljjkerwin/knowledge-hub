'use client';

import { PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Maximize2, Minus, Network, Plus, RotateCcw, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { knowledgeGraphService } from '@/services/knowledge-graph.service';
import { KnowledgeGraph, KnowledgeGraphNode } from '@/types/api.types';

type Position = { x: number; y: number };

function position(index: number, total: number) {
  const angle = (Math.PI * 2 * index) / Math.max(total, 1) - Math.PI / 2;
  const radius = index < 10 ? 28 : 44 + ((index % 3) * 6);
  return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius };
}

export function DocumentKnowledgeGraphDialog({ documentId }: { documentId: string }) {
  const [open, setOpen] = useState(false);
  const [graph, setGraph] = useState<KnowledgeGraph>();
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [selected, setSelected] = useState<KnowledgeGraphNode>();
  const [draggingId, setDraggingId] = useState<string>();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState<{ x: number; y: number; pointerX: number; pointerY: number }>();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const setDialogOpen = async (nextOpen: boolean) => {
    setOpen(nextOpen);
    // 每次打开都按当前文档重新读取，避免在客户端切换文档后复用上一页的图数据。
    if (!nextOpen || loading) return;
    setLoading(true); setError('');
    try {
      const result = await knowledgeGraphService.getForDocument(documentId);
      setGraph(result);
      setSelected(undefined);
      setZoom(1); setPan({ x: 0, y: 0 }); setQuery('');
      setPositions(Object.fromEntries(result.nodes.map((node, index) => [node.id, position(index, result.nodes.length)])));
    }
    catch (e) { setError(e instanceof Error ? e.message : '无法加载该文档的知识图谱'); }
    finally { setLoading(false); }
  };

  const moveNode = (event: PointerEvent<HTMLDivElement>) => {
    if (panStart) {
      setPan({ x: panStart.x + event.clientX - panStart.pointerX, y: panStart.y + event.clientY - panStart.pointerY });
      return;
    }
    if (!draggingId || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.min(94, Math.max(6, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.min(94, Math.max(6, ((event.clientY - rect.top) / rect.height) * 100));
    setPositions((current) => ({ ...current, [draggingId]: { x, y } }));
  };

  const resetView = () => {
    if (!graph) return;
    setPositions(Object.fromEntries(graph.nodes.map((node, index) => [node.id, position(index, graph.nodes.length)])));
    setZoom(1); setPan({ x: 0, y: 0 }); setSelected(undefined); setQuery('');
  };
  const related = useMemo(() => selected ? new Set(graph?.edges.filter((edge) => edge.source === selected.id || edge.target === selected.id).flatMap((edge) => [edge.source, edge.target])) : null, [graph?.edges, selected]);
  const selectedRelations = useMemo(() => selected ? (graph?.edges ?? []).filter((edge) => edge.source === selected.id || edge.target === selected.id).map((edge) => ({ ...edge, entity: edge.source === selected.id ? edge.target : edge.source })) : [], [graph?.edges, selected]);
  const changeZoom = (delta: number) => setZoom((value) => Math.min(2.5, Math.max(0.45, Number((value + delta).toFixed(2)))));
  const toggleFullscreen = async () => { if (!viewportRef.current) return; if (document.fullscreenElement) await document.exitFullscreen(); else await viewportRef.current.requestFullscreen(); };

  // React 的 wheel 事件在部分浏览器/触控板场景下无法取消页面缩放；用非被动监听确保手势只作用于画布。
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !open) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((value) => Math.min(2.5, Math.max(0.45, Number((value + (event.deltaY < 0 ? 0.1 : -0.1)).toFixed(2)))));
    };
    const preventPageZoom = (event: Event) => event.preventDefault();
    const preventZoomShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && ['+', '=', '-', '0'].includes(event.key)) event.preventDefault();
    };
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    // Safari 的双指捏合使用 gesture* 事件，不会触发标准 wheel；弹窗打开时阻止浏览器缩放。
    document.addEventListener('gesturestart', preventPageZoom, { passive: false });
    document.addEventListener('gesturechange', preventPageZoom, { passive: false });
    document.addEventListener('gestureend', preventPageZoom, { passive: false });
    document.addEventListener('keydown', preventZoomShortcut);
    return () => {
      viewport.removeEventListener('wheel', handleWheel);
      document.removeEventListener('gesturestart', preventPageZoom);
      document.removeEventListener('gesturechange', preventPageZoom);
      document.removeEventListener('gestureend', preventPageZoom);
      document.removeEventListener('keydown', preventZoomShortcut);
    };
  }, [graph?.nodes.length, open]);

  return <Dialog open={open} onOpenChange={(nextOpen) => void setDialogOpen(nextOpen)}>
    <DialogTrigger render={<Button variant="outline"><Network />知识图谱</Button>} />
    <DialogContent className="!flex h-[94vh] w-[98vw] max-w-none flex-col gap-3 p-6 sm:max-w-none" showCloseButton>
      <DialogHeader><DialogTitle>文档知识图谱</DialogTitle><DialogDescription>展示当前文档中抽取的实体，以及它们之间的已有关系。</DialogDescription></DialogHeader>
      {selected && <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm"><div className="flex items-center justify-between gap-4"><div><span className="font-medium">{selected.name}</span><span className="ml-2 text-xs text-muted-foreground">{selected.type} · {selected.mentions} 个关联文档块</span></div><button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setSelected(undefined)}>收起</button></div>{selected.description && <p className="mt-1 text-muted-foreground">{selected.description}</p>}{selected.aliases.length > 0 && <p className="mt-1 text-xs text-muted-foreground">别名：{selected.aliases.join('、')}</p>}{selectedRelations.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{selectedRelations.map((relation, index) => <span key={`${relation.entity}-${relation.relation}-${index}`} className="rounded-md border bg-background px-2 py-1 text-xs"><span className="text-muted-foreground">{relation.relation}</span><span className="mx-1">→</span><span className="font-medium">{relation.entity}</span></span>)}</div>}</div>}
      {loading ? <div className="flex min-h-0 flex-1 items-center justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div>
        : error ? <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
          : !graph?.nodes.length ? <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-muted-foreground"><Network className="size-10" /><p>该文档暂时没有图谱数据</p><p className="text-sm">文档发布后，系统会异步完成实体和关系抽取。</p></div>
            : <div className="flex min-h-0 flex-1 flex-col"><div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"><span>实体 {graph.nodes.length} 个 · 关系 {graph.edges.length} 条</span><div className="flex items-center gap-2"><div className="relative"><Search className="absolute left-2 top-2 size-3.5" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-8 w-44 pl-7 text-xs" placeholder="查找实体" /></div><Button size="icon-sm" variant="outline" onClick={() => changeZoom(-0.15)} aria-label="缩小"><Minus /></Button><span className="w-10 text-center text-xs">{Math.round(zoom * 100)}%</span><Button size="icon-sm" variant="outline" onClick={() => changeZoom(0.15)} aria-label="放大"><Plus /></Button><Button size="icon-sm" variant="outline" onClick={resetView} aria-label="重置视图"><RotateCcw /></Button><Button size="icon-sm" variant="outline" onClick={() => void toggleFullscreen()} aria-label="全屏"><Maximize2 /></Button></div></div><div ref={viewportRef} className="relative min-h-0 flex-1 touch-none overscroll-contain overflow-hidden rounded-xl border bg-[radial-gradient(circle_at_1px_1px,hsl(var(--border))_1px,transparent_0)] bg-[size:20px_20px]"><div ref={canvasRef} onPointerDown={(event) => { if (event.target === event.currentTarget) { event.currentTarget.setPointerCapture(event.pointerId); setPanStart({ ...pan, pointerX: event.clientX, pointerY: event.clientY }); } }} onPointerMove={moveNode} onPointerUp={() => { setDraggingId(undefined); setPanStart(undefined); }} onPointerLeave={() => { setDraggingId(undefined); setPanStart(undefined); }} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} className={`relative h-full min-w-[700px] touch-none transition-transform ${panStart ? 'cursor-grabbing' : 'cursor-grab'}`}><svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">{graph.edges.map((edge, index) => { const source = positions[edge.source]; const target = positions[edge.target]; const isSelectedEdge = selected && (edge.source === selected.id || edge.target === selected.id); const dimmed = (related && !related.has(edge.source)) || (query && !edge.source.toLowerCase().includes(query.toLowerCase()) && !edge.target.toLowerCase().includes(query.toLowerCase())); return source && target ? <g key={`${edge.source}-${edge.target}-${index}`}><line x1={`${source.x}%`} y1={`${source.y}%`} x2={`${target.x}%`} y2={`${target.y}%`} stroke={isSelectedEdge ? '#2563eb' : '#94a3b8'} strokeWidth={isSelectedEdge ? Math.max(2, edge.weight * 3) : Math.max(1, edge.weight * 2)} opacity={dimmed ? '.12' : '.7'} />{isSelectedEdge && <text x={`${(source.x + target.x) / 2}%`} y={`${(source.y + target.y) / 2}%`} textAnchor="middle" className="fill-primary text-[11px] font-medium">{edge.relation}</text>}</g> : null; })}</svg>{graph.nodes.map((node) => { const p = positions[node.id]; if (!p) return null; const matched = !query || node.name.toLowerCase().includes(query.toLowerCase()) || node.aliases.some((alias) => alias.toLowerCase().includes(query.toLowerCase())); const dimmed = !matched || Boolean(related && !related.has(node.id)); return <button key={node.id} onClick={() => setSelected(node)} onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setDraggingId(node.id); }} style={{ left: `${p.x}%`, top: `${p.y}%` }} className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 bg-background px-3 py-2 text-center text-xs shadow-sm transition active:cursor-grabbing ${dimmed ? 'opacity-20' : 'opacity-100'} ${selected?.id === node.id ? 'border-primary ring-2 ring-primary/20' : 'border-primary/60'}`}><span className="block max-w-28 truncate font-medium">{node.name}</span><span className="text-[10px] text-muted-foreground">{node.type}</span></button>; })}</div></div></div>}
    </DialogContent>
  </Dialog>;
}
