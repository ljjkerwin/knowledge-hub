'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ECharts, EChartsOption } from 'echarts';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2, Minus, Network, Plus, RefreshCw, RotateCcw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { knowledgeGraphService } from '@/services/knowledge-graph.service';
import { KnowledgeGraph, KnowledgeGraphNode, KnowledgeGraphSearchResult } from '@/types/api.types';

const colors: Record<string, string> = {
  PERSON: '#f97316', ORGANIZATION: '#2563eb', CONCEPT: '#7c3aed', DOCUMENT: '#0891b2',
  PROCESS: '#16a34a', PRODUCT: '#db2777', LOCATION: '#ca8a04', TIME: '#64748b',
  POLICY: '#dc2626', RESOURCE: '#0f766e',
};

export default function KnowledgeGraphPage() {
  return <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div>}><KnowledgeGraphContent /></Suspense>;
}

function KnowledgeGraphContent() {
  const searchParams = useSearchParams();
  const documentId = searchParams.get('documentId') ?? undefined;
  const [graph, setGraph] = useState<KnowledgeGraph>({ nodes: [], edges: [] });
  const [selected, setSelected] = useState<KnowledgeGraphNode>();
  const [zoom, setZoom] = useState(1);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<KnowledgeGraphSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);
  const hadSearchQueryRef = useRef(false);
  const load = useCallback(async (keyword?: string) => {
    setLoading(true); setError('');
    try {
      const result = documentId
        ? await knowledgeGraphService.getForDocument(documentId, 60, keyword)
        : await knowledgeGraphService.get(60, keyword);
      setGraph(result);
      setSelected(undefined); setZoom(1);
    }
    catch (e) { setError(e instanceof Error ? e.message : '无法加载知识图谱'); }
    finally { setLoading(false); }
  }, [documentId]);
  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);

  useEffect(() => {
    const keyword = query.trim();
    if (!keyword) {
      const restoreGraph = hadSearchQueryRef.current;
      hadSearchQueryRef.current = false;
      const timer = window.setTimeout(() => {
        setSearchResults([]);
        setSearchLoading(false);
        if (restoreGraph) void load();
      }, 0);
      return () => window.clearTimeout(timer);
    }
    hadSearchQueryRef.current = true;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      void knowledgeGraphService.search(keyword)
        .then((results) => { if (!cancelled) setSearchResults(results); })
        .catch(() => { if (!cancelled) setSearchResults([]); })
        .finally(() => { if (!cancelled) setSearchLoading(false); });
      void load(keyword);
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [load, query]);

  const resetView = () => {
    setZoom(1); setSelected(undefined); setQuery('');
  };
  const changeZoom = (delta: number) => setZoom((value) => Math.min(2.5, Math.max(0.45, Number((value + delta).toFixed(2)))));

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;
    let disposed = false;
    let chart: ECharts | null = null;
    let observer: ResizeObserver | null = null;

    void import('echarts').then(({ init }) => {
      if (disposed) return;
      chart = init(container);
      chartRef.current = chart;
      const option: EChartsOption = {
        animationDurationUpdate: 350,
        tooltip: { show: true },
        series: [{
          type: 'graph',
          layout: 'force',
          roam: true,
          zoom,
          data: graph.nodes.map((node) => ({
            id: node.id,
            name: node.name,
            value: node.mentions,
            symbolSize: Math.min(54, Math.max(28, 24 + node.mentions * 3)),
            itemStyle: { color: colors[node.type] ?? colors.CONCEPT },
          })),
          links: graph.edges.map((edge) => ({
            source: edge.source,
            target: edge.target,
            name: edge.relation,
            value: edge.weight,
            lineStyle: { width: Math.max(1, edge.weight * 2), opacity: 0.65 },
          })),
          force: { repulsion: 320, edgeLength: [80, 180], gravity: 0.08 },
          label: { show: true, position: 'right', formatter: '{b}', fontSize: 11 },
          edgeLabel: {
            show: false,
            formatter: (params) => {
              const data = params.data as { name?: string } | undefined;
              return data?.name ?? '';
            },
            color: '#475569',
            fontSize: 10,
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            borderRadius: 3,
            padding: [2, 4],
          },
          lineStyle: { color: '#94a3b8', curveness: 0.08 },
          emphasis: { focus: 'adjacency', lineStyle: { width: 3 }, edgeLabel: { show: true } },
        }],
      };
      chart.setOption(option);
      chart.on('click', (params) => {
        if (params.dataType !== 'node') return;
        const data = params.data as { id?: string } | undefined;
        const node = graph.nodes.find((item) => item.id === data?.id);
        if (node) setSelected(node);
      });
      observer = new ResizeObserver(() => chart?.resize());
      observer.observe(container);
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      chart?.dispose();
      if (chartRef.current === chart) chartRef.current = null;
    };
  }, [graph, zoom]);

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
            <div className="relative"><Search className="absolute left-2 top-2 size-3.5" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-8 w-52 pl-7 text-xs" placeholder="搜索文档、正文或实体" /></div>
            <Button size="icon-sm" variant="outline" onClick={() => changeZoom(-0.15)} aria-label="缩小"><Minus /></Button>
            <span className="w-10 text-center text-xs">{Math.round(zoom * 100)}%</span>
            <Button size="icon-sm" variant="outline" onClick={() => changeZoom(0.15)} aria-label="放大"><Plus /></Button>
            <Button size="icon-sm" variant="outline" onClick={resetView} aria-label="重置视图"><RotateCcw /></Button>
          </div>
        </div>
        <div ref={chartContainerRef} className="min-h-0 flex-1 overflow-hidden rounded-2xl border bg-background/85 shadow-sm" />
      </section>
      <aside className="overflow-auto border-l bg-card p-5">
        {query.trim() ? <SearchResults query={query} results={searchResults} loading={searchLoading} onSelectEntity={(result) => { const node = graph.nodes.find((item) => item.id === result.id); if (node) setSelected(node); }} /> : selected ? <div><div className="flex items-start justify-between gap-3"><div><span className="rounded-full px-2 py-1 text-xs text-white" style={{ backgroundColor: colors[selected.type] ?? colors.CONCEPT }}>{selected.type}</span><h2 className="mt-3 text-xl font-semibold">{selected.name}</h2></div><Button size="icon-sm" variant="ghost" onClick={() => setSelected(undefined)} aria-label="关闭详情"><X /></Button></div>
          {selected.description && <p className="mt-4 text-sm leading-6 text-muted-foreground">{selected.description}</p>}
          <dl className="mt-5 space-y-3 border-y py-4 text-sm"><div className="flex justify-between"><dt className="text-muted-foreground">关联文档块</dt><dd>{selected.mentions}</dd></div><div className="flex justify-between"><dt className="text-muted-foreground">关系数</dt><dd>{graph.edges.filter((edge) => edge.source === selected.id || edge.target === selected.id).length}</dd></div></dl>
          {selected.aliases.length > 0 && <div className="mt-5"><h3 className="text-sm font-medium">别名</h3><p className="mt-2 text-sm text-muted-foreground">{selected.aliases.join('、')}</p></div>}
          {selected.documents.length > 0 && <div className="mt-5"><h3 className="text-sm font-medium">来源文档</h3><ul className="mt-2 space-y-2">{selected.documents.map((doc) => <li key={doc.id}><Link className="text-sm text-primary hover:underline" href={`/documents/${doc.id}`}>{doc.title}</Link></li>)}</ul></div>}
        </div> : <div className="flex h-full flex-col justify-center text-center text-sm text-muted-foreground"><Network className="mx-auto mb-3 size-8" /><p>点击图中的实体查看详情、关联文档和关系。</p><p className="mt-5 text-xs">实体 {graph.nodes.length} 个 · 关系 {graph.edges.length} 条</p></div>}
      </aside>
    </main>}
  </div>;
}

const labelNames: Record<KnowledgeGraphSearchResult['label'], string> = {
  KnowledgeDocument: '文档',
  DocumentChunk: '文档块',
  KnowledgeEntity: '知识实体',
};

function SearchResults({ query, results, loading, onSelectEntity }: {
  query: string;
  results: KnowledgeGraphSearchResult[];
  loading: boolean;
  onSelectEntity: (result: KnowledgeGraphSearchResult) => void;
}) {
  if (loading) return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div>;
  if (!results.length) return <div className="flex h-full flex-col justify-center text-center text-sm text-muted-foreground"><Search className="mx-auto mb-3 size-8" /><p>未找到“{query.trim()}”相关节点</p><p className="mt-2 text-xs">可匹配文档标题和摘要、文档块标题和正文、实体名称和描述。</p></div>;
  return <div><h2 className="text-base font-semibold">搜索结果</h2><p className="mt-1 text-xs text-muted-foreground">{results.length} 个匹配节点</p><div className="mt-4 space-y-3">{results.map((result) => {
    const documentId = result.label === 'KnowledgeDocument' ? result.id : result.documentId;
    const detail = result.description ?? result.summary ?? result.snippet ?? result.heading;
    const content = <><div className="flex items-center justify-between gap-2"><span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{labelNames[result.label]}</span>{result.type && <span className="truncate text-[11px] text-muted-foreground">{result.type}</span>}</div><p className="mt-2 truncate text-sm font-medium">{result.name}</p>{detail && <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{detail}</p>}</>;
    return result.label === 'KnowledgeEntity' ? <button key={`${result.label}-${result.id}`} onClick={() => onSelectEntity(result)} className="block w-full rounded-lg border p-3 text-left transition hover:border-primary/50 hover:bg-muted/40">{content}</button> : documentId ? <Link key={`${result.label}-${result.id}`} href={`/documents/${documentId}${result.label === 'DocumentChunk' ? `?citation=${encodeURIComponent(result.id)}` : ''}`} className="block rounded-lg border p-3 transition hover:border-primary/50 hover:bg-muted/40">{content}</Link> : <div key={`${result.label}-${result.id}`} className="rounded-lg border p-3">{content}</div>;
  })}</div></div>;
}
