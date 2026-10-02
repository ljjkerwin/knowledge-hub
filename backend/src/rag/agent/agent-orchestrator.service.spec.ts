import {
  QueryIntent,
  RetrievalStrategy,
  RewrittenQuery,
} from './question-analyzer.service';
import { SearchType } from '../types/search.types';
import { RetrievedChunk } from '../types/rag.types';
import { AgentOrchestrator } from './agent-orchestrator.service';

describe('AgentOrchestrator retrieval query construction', () => {
  it('adds per-entity queries for comparative cross-document questions', () => {
    const analysis: RewrittenQuery = {
      rewritten: '财务审核员和 SRE 值班工程师的职责分别是什么？',
      intent: QueryIntent.KNOWLEDGE_BASE,
      expandedQueries: ['角色职责对比'],
      entityTerms: ['财务审核员', 'SRE 值班工程师'],
      needsRetrieval: true,
    };
    const strategy: RetrievalStrategy = {
      searchType: SearchType.HYBRID,
      topK: 8,
      candidateTopK: 10,
      expandQuery: true,
      useKnowledgeGraph: true,
      sourceWeights: { vector: 0.8, keyword: 1.2, graph: 1 },
    };
    const buildRetrievalQueries = (
      AgentOrchestrator.prototype as unknown as {
        buildRetrievalQueries: (
          analysis: RewrittenQuery,
          strategy: RetrievalStrategy,
          originalQuery?: string,
        ) => Array<{ query: string; weight: number }>;
      }
    ).buildRetrievalQueries;

    const queries = buildRetrievalQueries.call(
      {},
      analysis,
      strategy,
      analysis.rewritten,
    ) as Array<{ query: string; weight: number }>;

    expect(queries.map((item) => item.query)).toEqual(
      expect.arrayContaining(['财务审核员', 'SRE 值班工程师']),
    );
    expect(queries.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(1);
  });

  it('rejects synonymous or near-identical follow-up queries', () => {
    const isNovelRetrievalQuery = (
      AgentOrchestrator.prototype as unknown as {
        isNovelRetrievalQuery: (
          candidate: string,
          searchHistory: Array<{
            source: 'knowledge_base' | 'web';
            query: string;
          }>,
          source: 'knowledge_base' | 'web',
        ) => boolean;
      }
    ).isNovelRetrievalQuery;

    expect(
      isNovelRetrievalQuery.call(
        AgentOrchestrator.prototype,
        'A 与 B 的审批流程有什么区别？',
        [
          {
            source: 'knowledge_base',
            query: 'A和B的审批流程有什么区别？',
          },
        ],
        'knowledge_base',
      ),
    ).toBe(false);
    expect(
      isNovelRetrievalQuery.call(
        AgentOrchestrator.prototype,
        'B 的审批节点和审批人',
        [
          {
            source: 'knowledge_base',
            query: 'A和B的审批流程有什么区别？',
          },
        ],
        'knowledge_base',
      ),
    ).toBe(true);
  });
});

describe('AgentOrchestrator evidence-first graph', () => {
  it('starts a web-classified question directly with web search', async () => {
    const webChunk = {
      ...createChunk('web-news', '这是今天发布的公开消息。'),
      sourceType: 'web' as const,
      sourceUrl: 'https://example.com/news',
    };
    const analyze = jest.fn().mockResolvedValue({
      rewritten: '今天的公开消息是什么？',
      intent: QueryIntent.WEB,
      expandedQueries: [],
      entityTerms: [],
      needsRetrieval: true,
    });
    const vectorSearch = jest.fn();
    const webSearch = jest.fn().mockResolvedValue([webChunk]);
    const assessEvidence = jest.fn().mockResolvedValue({
      verdict: 'sufficient',
      usableChunkIds: ['web-news'],
      coveredAspects: ['今天的公开消息'],
      missingAspects: [],
      shouldContinue: false,
      needsWebSearch: false,
      nextSearchSource: 'none',
      reasoning: '网页证据充足。',
    });
    const generateStream = jest.fn(function* () {
      const answer = '这是今天的公开消息。[1]';
      yield { type: 'token' as const, content: answer };
      return {
        answer,
        citations: [
          {
            index: 1,
            chunkId: webChunk.chunkId,
            documentId: webChunk.documentId,
            documentTitle: webChunk.documentTitle,
            chunkContent: webChunk.content,
            heading: null,
            similarity: webChunk.similarity,
            sourceType: 'web' as const,
            sourceUrl: webChunk.sourceUrl,
          },
        ],
      };
    });
    const orchestrator = new AgentOrchestrator(
      { analyze } as never,
      { vectorSearch } as never,
      { search: jest.fn() } as never,
      { fuse: jest.fn() } as never,
      { getCandidateLimit: jest.fn(), rerank: jest.fn() } as never,
      { generateStream } as never,
      { assessEvidence } as never,
      { recall: jest.fn().mockResolvedValue([]) } as never,
      { search: webSearch, isConfigured: jest.fn(() => true) } as never,
      {
        get: jest.fn((_key: string, fallback: unknown) => fallback),
      } as never,
    );

    const result = await orchestrator.run({
      question: '今天有什么公开消息？',
      context: { history: [], conversationId: 'conversation-web' },
      enableFollowUp: true,
    });

    expect(vectorSearch).not.toHaveBeenCalled();
    expect(webSearch).toHaveBeenCalledWith('今天的公开消息是什么？');
    expect(result.route).toBe('web');
    expect(result.retrievalAttempts).toEqual([
      { query: '今天的公开消息是什么？', searchType: 'web' },
    ]);
    expect(result.answer).toBe('这是今天的公开消息。[1]');
    expect(result.completed).toBe(true);
    expect(generateStream).toHaveBeenCalledTimes(1);
  });

  it('shares a three-attempt budget across knowledge and web search, then generates once', async () => {
    const firstChunk = createChunk('chunk-a', 'A 需要财务负责人审批。');
    const secondChunk = createChunk('chunk-b', 'B 需要部门负责人审批。');
    const webChunk = {
      ...createChunk('web-current', '监管机构公布了最新外部要求。'),
      sourceType: 'web' as const,
      sourceUrl: 'https://example.com/current-rule',
    };
    const analyze = jest.fn().mockResolvedValue({
      rewritten: 'A 和 B 的审批流程有什么区别？',
      intent: QueryIntent.KNOWLEDGE_BASE,
      expandedQueries: [],
      entityTerms: [],
      needsRetrieval: true,
      strategy: {
        searchType: SearchType.VECTOR,
        topK: 5,
        candidateTopK: 7,
        expandQuery: false,
        useKnowledgeGraph: false,
        sourceWeights: { vector: 1, keyword: 0, graph: 0 },
      },
    });
    const vectorSearch = jest
      .fn()
      .mockResolvedValueOnce([firstChunk])
      .mockResolvedValueOnce([secondChunk]);
    const assessEvidence = jest
      .fn()
      .mockResolvedValueOnce({
        verdict: 'partial',
        usableChunkIds: ['chunk-a'],
        coveredAspects: ['A 的审批流程'],
        missingAspects: ['B 的审批节点和审批人'],
        shouldContinue: true,
        needsWebSearch: false,
        nextSearchSource: 'knowledge_base',
        nextQuery: 'B 的审批节点和审批人',
        newSearchAspect: 'B 的审批信息',
        reasoning: '缺少 B。',
      })
      .mockResolvedValueOnce({
        verdict: 'partial',
        usableChunkIds: ['chunk-b'],
        coveredAspects: ['A 的审批流程', 'B 的审批流程'],
        missingAspects: ['最新外部监管要求'],
        shouldContinue: true,
        needsWebSearch: true,
        nextSearchSource: 'web',
        webSearchQuery: 'A B 审批流程 最新监管要求',
        newSearchAspect: '最新公开监管要求',
        reasoning: '需要联网确认近期公开信息。',
      })
      .mockResolvedValueOnce({
        verdict: 'sufficient',
        usableChunkIds: ['web-current'],
        coveredAspects: ['A 的审批流程', 'B 的审批流程', '最新外部要求'],
        missingAspects: [],
        shouldContinue: false,
        needsWebSearch: false,
        nextSearchSource: 'none',
        reasoning: '累计证据已经完整。',
      });
    const generateStream = jest.fn(function* () {
      const answer = 'A 和 B 的审批流程不同。[1][2]';
      yield { type: 'token' as const, content: 'A 和 B 的审批流程' };
      yield { type: 'token' as const, content: '不同。[1][2]' };
      return {
        answer,
        citations: [firstChunk, secondChunk, webChunk].map((chunk, index) => ({
          index: index + 1,
          chunkId: chunk.chunkId,
          documentId: chunk.documentId,
          documentTitle: chunk.documentTitle,
          chunkContent: chunk.content,
          heading: chunk.heading,
          similarity: chunk.similarity,
        })),
      };
    });
    const webSearch = jest.fn().mockResolvedValue([webChunk]);

    const orchestrator = new AgentOrchestrator(
      { analyze } as never,
      { vectorSearch } as never,
      { search: jest.fn() } as never,
      {
        fuse: jest.fn((results: Array<{ chunks: RetrievedChunk[] }>) =>
          results.flatMap((result) => result.chunks),
        ),
      } as never,
      {
        getCandidateLimit: jest.fn((topK: number) => topK),
        rerank: jest.fn((_query: string, chunks: RetrievedChunk[]) => chunks),
      } as never,
      { generateStream } as never,
      { assessEvidence } as never,
      { recall: jest.fn().mockResolvedValue([]) } as never,
      { search: webSearch, isConfigured: jest.fn(() => true) } as never,
      {
        get: jest.fn((_key: string, fallback: unknown) => fallback),
      } as never,
    );

    const result = await orchestrator.run({
      question: 'A 和 B 的审批流程有什么区别？',
      context: { history: [], conversationId: 'conversation-1' },
      userId: 'user-1',
      enableFollowUp: true,
    });

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(vectorSearch).toHaveBeenCalledTimes(2);
    expect(webSearch).toHaveBeenCalledTimes(1);
    expect(assessEvidence).toHaveBeenCalledTimes(3);
    expect(generateStream).toHaveBeenCalledTimes(1);
    expect(result.retrievalQueries).toEqual([
      'A 和 B 的审批流程有什么区别？',
      'B 的审批节点和审批人',
      'A B 审批流程 最新监管要求',
    ]);
    expect(result.totalIterations).toBe(3);
    expect(result.answer).toBe('A 和 B 的审批流程不同。[1][2]');
    expect(result.completed).toBe(true);
    expect(result.finalGenerationContext.map((chunk) => chunk.chunkId)).toEqual(
      ['chunk-a', 'chunk-b', 'web-current'],
    );
  });
});

function createChunk(chunkId: string, content: string): RetrievedChunk {
  return {
    chunkId,
    documentId: `document-${chunkId}`,
    documentTitle: '审批制度',
    content,
    heading: null,
    chunkIndex: 0,
    totalChunks: 1,
    similarity: 0.8,
    metadata: {},
  };
}
