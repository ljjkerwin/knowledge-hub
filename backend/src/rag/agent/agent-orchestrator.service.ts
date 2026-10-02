import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import SnowflakeId from 'snowflake-id';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import {
  AnalyzedQuestion,
  QuestionAnalyzer,
  RewrittenQuery,
  QueryIntent,
  RetrievalStrategy,
} from './question-analyzer.service';
import {
  EvidenceAssessment,
  EvidenceAssessmentService,
  RetrievalSource,
  SearchAttempt,
} from './answer-evaluator.service';
import { RetrievalService } from '../retrieval.service';
import { GraphRetrievalService } from '../graph-retrieval.service';
import { FusionService, RankedRetrievalResult } from '../fusion.service';
import { RerankerService } from '../reranker.service';
import { GenerationService } from '../generation.service';
import { RetrievedChunk, GeneratedAnswer } from '../types/rag.types';
import {
  AguiEventType,
  AguiEventUnion,
  AguiStreamOptions,
} from '../types/agui.types';
import {
  AgentExecutionEvent,
  AgentInternalEventType,
  AgentRunInput,
  AgentRunResult,
  AgentRunResultCollector,
  isInternalAgentEvent,
} from './agent-run-result';
import { SearchType } from '../types/search.types';
import type { ConversationContext } from '../context-manager.service';
import { LongTermMemoryService } from '../long-term-memory.service';
import { CallbackHandler } from '@langfuse/langchain';
import { isLangfuseTracingEnabled } from '../../langfuse.config';
import { startActiveObservation } from '@langfuse/tracing';
import { WebSearchService } from '../web-search.service';

interface WeightedQuery {
  query: string;
  weight: number;
}

/** LangGraph 中流转的业务状态；AGUI 事件经 custom stream 单独传输。 */
const AgentState = Annotation.Root({
  queryId: Annotation<string>,
  originalQuestion: Annotation<string>,
  /** 线上用户标识，仅用于隔离 Mem0 长期记忆；离线运行时为空。 */
  userId: Annotation<string | undefined>,
  /** 首轮结合会话上下文改写出的独立问题；用于生成与评估。 */
  answerQuestion: Annotation<string>,
  /** 每轮分析、检索所用的问题；可能是追问或扩展查询。 */
  retrievalQuestion: Annotation<string>,
  context: Annotation<ConversationContext>,
  options: Annotation<AguiStreamOptions>,
  maxIterations: Annotation<number>,
  iteration: Annotation<number>,
  completedIterations: Annotation<number>,
  analysis: Annotation<AnalyzedQuestion | undefined>,
  /** 当前一轮尚未评审的原始召回结果。 */
  currentChunks: Annotation<RetrievedChunk[]>,
  /** 已通过证据评审、允许进入最终生成上下文的累计片段。 */
  acceptedChunks: Annotation<RetrievedChunk[]>,
  searchHistory: Annotation<SearchAttempt[]>,
  retrievalSource: Annotation<RetrievalSource>,
  evidenceAssessment: Annotation<EvidenceAssessment | undefined>,
  shouldContinue: Annotation<boolean>,
});

type AgentStateValue = typeof AgentState.State;

/** SSE 适配层补充会话标识；核心 AgentRunInput 不依赖会话持久化。 */
export interface QueryStreamInput extends AgentRunInput {
  /** 当前聊天轮次所属会话；随首个 metadata 事件发送并用于 trace session。 */
  conversationId: string;
}

@Injectable()
export class AgentOrchestrator {
  private readonly logger = new Logger(AgentOrchestrator.name);
  /** 内部知识库与联网搜索共用预算，合计最多执行三轮。 */
  private readonly maxIterations: number;
  /** 跨轮检索结果累计后，允许进入生成上下文的最大片段数。 */
  private readonly maxAccumulatedContextChunks: number;
  private readonly graph: ReturnType<AgentOrchestrator['buildGraph']>;

  constructor(
    private readonly questionAnalyzer: QuestionAnalyzer,
    private readonly retrievalService: RetrievalService,
    private readonly graphRetrievalService: GraphRetrievalService,
    private readonly fusionService: FusionService,
    private readonly rerankerService: RerankerService,
    private readonly generationService: GenerationService,
    private readonly evidenceAssessmentService: EvidenceAssessmentService,
    private readonly longTermMemoryService: LongTermMemoryService,
    private readonly webSearchService: WebSearchService,
    private readonly config: ConfigService,
  ) {
    const configuredMaxIterations = Number(
      this.config.get('RAG_MAX_ITERATIONS', 3),
    );
    this.maxIterations = Number.isFinite(configuredMaxIterations)
      ? Math.min(3, Math.max(1, Math.floor(configuredMaxIterations)))
      : 3;
    this.maxAccumulatedContextChunks = Number(
      this.config.get('RAG_MAX_CONTEXT_CHUNKS', 12),
    );
    this.graph = this.buildGraph();
  }

  /**
   * 执行检索
   */
  private async executeRetrieval(
    analysis: RewrittenQuery,
    strategy: RetrievalStrategy,
    originalQuery?: string,
  ): Promise<RetrievedChunk[]> {
    const searchOptions = {
      topK: strategy.candidateTopK,
    };

    const queries = this.buildRetrievalQueries(
      analysis,
      strategy,
      originalQuery,
    );

    const textTasks: Array<Promise<RankedRetrievalResult>> = [];
    for (const { query, weight } of queries) {
      if (strategy.searchType !== SearchType.KEYWORD) {
        textTasks.push(
          this.retrievalService
            .vectorSearch(query, searchOptions)
            // .then((chunks) => {
            //   this.logger.verbose(
            //     `vectorSearch初步结果（${chunks.length} 条）：${JSON.stringify(chunks, null, 2)}`,
            //   );
            //   return chunks
            // })
            .then((chunks) => ({
              source: 'vector',
              chunks,
              weight: strategy.sourceWeights.vector * weight,
            })),
        );
      }
      if (strategy.searchType !== SearchType.VECTOR) {
        textTasks.push(
          this.retrievalService
            .keywordSearch(query, searchOptions)
            // .then((chunks) => {
            //   this.logger.verbose(
            //     `keywordSearch初步结果（${chunks.length} 条）：${JSON.stringify(chunks, null, 2)}`,
            //   );
            //   return chunks
            // })
            .then(async (chunks) => {
              if (chunks.length || strategy.searchType !== SearchType.KEYWORD) {
                return {
                  source: 'keyword' as const,
                  chunks,
                  weight: strategy.sourceWeights.keyword * weight,
                };
              }

              // 纯编号通常适合关键词检索，但索引分词或阈值可能造成零召回；
              // 此时回退向量检索，避免直接带着空上下文进入生成阶段。
              this.logger.warn(
                `关键词检索零召回，回退向量检索：query="${query}"`,
              );
              const fallbackChunks = await this.retrievalService.vectorSearch(
                query,
                searchOptions,
              );
              return {
                source: 'vector' as const,
                chunks: fallbackChunks,
                weight: Math.max(strategy.sourceWeights.vector, 0.8) * weight,
              };
            }),
        );
      }
    }

    this.logger.verbose('do retrieval');

    const graphTask: Promise<RankedRetrievalResult[]> =
      strategy.useKnowledgeGraph
        ? this.graphRetrievalService
            // 图谱实体词来自同一次问题分析；每轮只查询一次，避免扩展 query 重复访问 Neo4j。
            .search(
              analysis.rewritten,
              searchOptions,
              analysis.entityTerms ?? [],
            )
            .then((chunks) => [
              {
                source: 'graph' as const,
                chunks,
                weight: strategy.sourceWeights.graph,
              },
            ])
        : Promise.resolve([]);

    const [textResults, graphResults] = await Promise.all([
      Promise.all(textTasks),
      graphTask,
    ]);

    // 先用 WRRF 融合到较大的候选池，再交给 reranker 输出最终 topK。
    const fusionCandidates = this.fusionService.fuse(
      [...textResults, ...graphResults],
      this.rerankerService.getCandidateLimit(strategy.topK),
    );
    this.logger.verbose(
      `WRRF 融合完成：文本候选=${textResults.reduce((count, result) => count + result.chunks.length, 0)}，图谱候选=${graphResults.reduce((count, result) => count + result.chunks.length, 0)}，精排候选=${fusionCandidates.length}`,
    );

    // this.logger.verbose(`[langgraph][fusionCandidates] ${JSON.stringify(fusionCandidates, null, 2)}`)

    return this.rerankerService.rerank(
      analysis.rewritten,
      fusionCandidates,
      strategy.topK,
    );
  }

  /** 改写查询为主，用户原话用于保留制度名、编号等精确术语。 */
  private buildRetrievalQueries(
    analysis: RewrittenQuery,
    strategy: RetrievalStrategy,
    originalQuery?: string,
  ): WeightedQuery[] {
    const entityQueries = Array.from(
      new Set(
        (analysis.entityTerms ?? []).map((term) => term.trim()).filter(Boolean),
      ),
    ).slice(0, 4);
    const shouldDecompose =
      entityQueries.length >= 2 && strategy.useKnowledgeGraph;
    const baseRewrittenWeight = shouldDecompose ? 0.45 : 0.75;
    const entityTotalWeight = shouldDecompose ? 0.3 : 0;

    const candidates: WeightedQuery[] = [
      { query: analysis.rewritten, weight: baseRewrittenWeight },
      { query: originalQuery ?? '', weight: 0.15 },
    ];

    // 比较题和关系题按实体补充子查询，避免一个强势实体占满候选池，
    // 导致跨文档问题只召回其中一侧。
    if (shouldDecompose) {
      const weight = entityTotalWeight / entityQueries.length;
      candidates.push(...entityQueries.map((query) => ({ query, weight })));
    }

    if (strategy.expandQuery) {
      const expanded = analysis.expandedQueries.slice(0, 3);
      const weight = expanded.length ? 0.1 / expanded.length : 0;
      candidates.push(...expanded.map((query) => ({ query, weight })));
    }

    // 按规范化文本去重；相同 query 的权重合并，避免重复请求 ES / Embedding。
    const unique = new Map<string, WeightedQuery>();
    for (const candidate of candidates) {
      const query = candidate.query.trim();
      if (!query) continue;
      const key = query.normalize('NFKC').toLocaleLowerCase();
      const existing = unique.get(key);
      if (existing) existing.weight += candidate.weight;
      else unique.set(key, { query, weight: candidate.weight });
    }

    const queries = Array.from(unique.values()).slice(0, 6);
    const totalWeight = queries.reduce((sum, item) => sum + item.weight, 0);
    return totalWeight > 0
      ? queries.map((item) => ({ ...item, weight: item.weight / totalWeight }))
      : [{ query: analysis.rewritten, weight: 1 }];
  }

  /**
   * 合并并去重检索结果
   */
  private mergeChunks(...chunkArrays: RetrievedChunk[][]): RetrievedChunk[] {
    const merged = new Map<string, RetrievedChunk>();

    for (const chunks of chunkArrays) {
      for (const chunk of chunks) {
        const existing = merged.get(chunk.chunkId);
        if (!existing || chunk.similarity > existing.similarity) {
          merged.set(chunk.chunkId, chunk);
        }
      }
    }

    // 按相似度排序
    return Array.from(merged.values()).sort(
      (a, b) => b.similarity - a.similarity,
    );
  }

  /** 限制生成上下文，防止扩展查询或多轮迭代无限累积片段。 */
  private takeTopAccumulatedChunks(
    chunks: RetrievedChunk[],
    limit: number,
  ): RetrievedChunk[] {
    return chunks.slice(0, Math.max(1, limit));
  }

  /** 阻止只换措辞、未改变检索空间的补充查询。 */
  private isNovelRetrievalQuery(
    candidate: string,
    searchHistory: SearchAttempt[],
    source: RetrievalSource,
  ): boolean {
    const normalizedCandidate = this.normalizeQuery(candidate);
    if (!normalizedCandidate) return false;

    return searchHistory
      .filter((attempt) => attempt.source === source)
      .every((attempt) => {
        const normalizedSearched = this.normalizeQuery(attempt.query);
        if (!normalizedSearched || normalizedCandidate === normalizedSearched)
          return false;

        const shorterLength = Math.min(
          normalizedCandidate.length,
          normalizedSearched.length,
        );
        const longerLength = Math.max(
          normalizedCandidate.length,
          normalizedSearched.length,
        );
        const isNearContainment =
          shorterLength / longerLength >= 0.75 &&
          (normalizedCandidate.includes(normalizedSearched) ||
            normalizedSearched.includes(normalizedCandidate));
        if (isNearContainment) return false;

        return (
          this.bigramSimilarity(normalizedCandidate, normalizedSearched) < 0.85
        );
      });
  }

  private normalizeQuery(query: string): string {
    return query
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[与及]/g, '和')
      .replace(/[\p{P}\p{S}\s]/gu, '');
  }

  private bigramSimilarity(left: string, right: string): number {
    const toBigrams = (value: string): Set<string> => {
      if (value.length < 2) return new Set([value]);
      return new Set(
        Array.from({ length: value.length - 1 }, (_, index) =>
          value.slice(index, index + 2),
        ),
      );
    };
    const leftBigrams = toBigrams(left);
    const rightBigrams = toBigrams(right);
    const intersection = Array.from(leftBigrams).filter((item) =>
      rightBigrams.has(item),
    ).length;
    const union = new Set([...leftBigrams, ...rightBigrams]).size;
    return union ? intersection / union : 1;
  }

  /** 业务节点写入 custom stream，queryStream 仅负责映射到 SSE。 */
  private emit(
    event: AgentExecutionEvent,
    config: { writer?: (event: AgentExecutionEvent) => void },
  ): void {
    config.writer?.(event);
  }

  private buildGraph() {
    const graph = new StateGraph(AgentState)
      // 每轮都先分析；后续轮次的 retrievalQuestion 由评估节点决定。
      .addNode('analyze', async (state: AgentStateValue, config) => {
        this.emit(
          {
            type: AguiEventType.THINKING,
            timestamp: Date.now(),
            // content: `开始第 ${state.iteration} 轮迭代分析...`,
            content: `正在分析用户问题...`,
          },
          config,
        );
        const analysis = await this.questionAnalyzer.analyze({
          question: state.retrievalQuestion,
          context: state.iteration === 1 ? state.context : undefined,
        });
        this.emit(
          {
            type: AguiEventType.ANALYSIS,
            timestamp: Date.now(),
            rewritten: analysis.rewritten,
            intent: analysis.intent,
            needsRetrieval: analysis.needsRetrieval,
            entityTerms: analysis.entityTerms ?? [],
          },
          config,
        );
        this.emit(
          {
            type: AguiEventType.THINKING,
            timestamp: Date.now(),
            content: `问题意图: ${analysis.intent}, 改写为: "${analysis.rewritten}"`,
          },
          config,
        );

        // this.logger.verbose(
        //   `[langgraph][analyze] ${JSON.stringify(analysis, null, 2)} ${analysis.rewritten}`,
        // );

        return {
          analysis,
          retrievalQuestion: analysis.rewritten,
          retrievalSource:
            analysis.intent === QueryIntent.WEB ? 'web' : 'knowledge_base',
          // 只在首轮固定答案目标，避免后续追问覆盖用户的原始意图。
          answerQuestion:
            state.iteration === 1 ? analysis.rewritten : state.answerQuestion,
        };
      })
      // 闲聊等不需要检索的请求直接流式回答，避免进入 RAG 管线。
      .addNode('directGenerate', async (state: AgentStateValue, config) => {
        this.emit(
          {
            type: AguiEventType.THINKING,
            timestamp: Date.now(),
            content: '该消息无需查询知识库，直接生成回复。',
          },
          config,
        );
        this.emit(
          {
            type: AguiEventType.GENERATION_START,
            timestamp: Date.now(),
            mode: 'direct',
          },
          config,
        );

        this.logger.verbose(`[langgraph][directGenerate]`);

        const longTermMemories =
          state.userId &&
          state.analysis?.intent === QueryIntent.PERSONAL_PREFERENCE
            ? await this.longTermMemoryService.recall(
                state.userId,
                state.answerQuestion,
              )
            : [];

        this.logger.verbose(
          `[longTermMemories] 召回完成：${longTermMemories.length} 条`,
        );

        const context = { ...state.context, longTermMemories };

        for await (const chunk of this.generationService.generateDirectStream(
          state.originalQuestion,
          context,
        )) {
          if (chunk.type === 'token')
            this.emit(
              {
                type: AguiEventType.TEXT,
                timestamp: Date.now(),
                content: chunk.content,
              },
              config,
            );
          else if (chunk.type === 'error') throw new Error(chunk.content);
        }
        this.emit(
          {
            type: AguiEventType.DONE,
            timestamp: Date.now(),
            queryId: state.queryId,
            totalIterations: state.iteration,
          },
          config,
        );
        return {};
      })
      // 每轮只负责召回；是否进入最终上下文由后续证据评审决定。
      .addNode('retrieve', async (state: AgentStateValue, config) => {
        const { analysis } = state;
        if (!analysis) {
          throw new Error('检索分支缺少问题分析。');
        }
        if (state.retrievalSource === 'knowledge_base' && !analysis.strategy) {
          throw new Error('知识库检索分支缺少检索策略。');
        }
        const query = state.retrievalQuestion;
        this.emit(
          {
            type: AguiEventType.RETRIEVAL_START,
            timestamp: Date.now(),
            query,
            searchType:
              state.retrievalSource === 'web'
                ? 'web'
                : analysis.strategy!.searchType,
          },
          config,
        );
        // 首轮知识库问题在检索的同时召回 Mem0；网页问题不混入长期记忆。
        // 后续补充检索复用已有记忆，且不再混入原始 query，避免重复召回。
        const [chunks, longTermMemories] = await Promise.all([
          state.retrievalSource === 'web'
            ? this.webSearchService.search(query)
            : this.executeRetrieval(
                { ...analysis, rewritten: query },
                analysis.strategy!,
                state.iteration === 1 ? state.originalQuestion : undefined,
              ),
          state.iteration === 1 &&
          state.userId &&
          state.analysis?.intent === QueryIntent.KNOWLEDGE_BASE
            ? this.longTermMemoryService.recall(
                state.userId,
                state.answerQuestion,
              )
            : Promise.resolve(state.context.longTermMemories ?? []),
        ]);

        this.logger.verbose(
          `[retrieve][chunks] ${JSON.stringify(chunks, null, 2)}`,
        );

        return {
          currentChunks: chunks,
          searchHistory: [
            ...state.searchHistory,
            { source: state.retrievalSource, query },
          ],
          completedIterations: state.iteration,
          context: { ...state.context, longTermMemories },
        };
      })
      // 先筛选证据，再决定继续内部检索、切换联网搜索或进入最终生成。
      .addNode('assessEvidence', async (state: AgentStateValue, config) => {
        this.emit(
          {
            type: AguiEventType.THINKING,
            timestamp: Date.now(),
            content: `正在评估第 ${state.iteration} 轮检索知识是否足以回答问题...`,
          },
          config,
        );
        const assessment = await this.evidenceAssessmentService.assessEvidence(
          state.answerQuestion,
          state.currentChunks,
          state.acceptedChunks,
          state.searchHistory,
          state.retrievalSource,
          this.webSearchService.isConfigured(),
          state.analysis?.intent === QueryIntent.WEB
            ? 'web_only'
            : 'knowledge_with_web_fallback',
        );
        const usableIds = new Set(assessment.usableChunkIds);
        const acceptedChunks = this.takeTopAccumulatedChunks(
          this.mergeChunks(
            state.acceptedChunks,
            state.currentChunks.filter((chunk) => usableIds.has(chunk.chunkId)),
          ),
          this.maxAccumulatedContextChunks,
        );
        this.emit(
          {
            type: AguiEventType.EVIDENCE_ASSESSMENT,
            timestamp: Date.now(),
            verdict: assessment.verdict,
            usableChunkIds: assessment.usableChunkIds,
            coveredAspects: assessment.coveredAspects,
            missingAspects: assessment.missingAspects,
            shouldRetrieveMore: assessment.shouldContinue,
            needsWebSearch: assessment.needsWebSearch,
            nextSearchSource: assessment.nextSearchSource,
            nextQuery: assessment.nextQuery,
            webSearchQuery: assessment.webSearchQuery,
            newSearchAspect: assessment.newSearchAspect,
          },
          config,
        );

        // 客户端只看到通过评审的累计证据，不展示被拒绝的原始召回片段。
        this.emit(
          {
            type: AguiEventType.RETRIEVAL_RESULT,
            timestamp: Date.now(),
            chunks: acceptedChunks.map((chunk) => ({
              chunkId: chunk.chunkId,
              documentId: chunk.documentId,
              documentTitle: chunk.documentTitle,
              originalFileName: chunk.originalFileName,
              fileSize: chunk.fileSize,
              content:
                chunk.content.substring(0, 200) +
                (chunk.content.length > 200 ? '...' : ''),
              similarity: chunk.similarity,
              sourceType: chunk.sourceType,
              sourceUrl: chunk.sourceUrl,
            })),
          },
          config,
        );

        const nextSource = assessment.nextSearchSource;
        const nextQuery =
          nextSource === 'web'
            ? assessment.webSearchQuery?.trim()
            : assessment.nextQuery?.trim();
        const canContinue = Boolean(
          state.options.enableFollowUp !== false &&
          assessment.shouldContinue &&
          nextQuery &&
          nextSource !== 'none' &&
          state.iteration < state.maxIterations &&
          this.isNovelRetrievalQuery(
            nextQuery,
            state.searchHistory,
            nextSource,
          ),
        );
        if (!canContinue) {
          return {
            evidenceAssessment: assessment,
            acceptedChunks,
            shouldContinue: false,
          };
        }

        this.emit(
          {
            type: AguiEventType.THINKING,
            timestamp: Date.now(),
            content:
              nextSource === 'web'
                ? `内部知识不足，联网搜索: "${nextQuery}"`
                : `发现明确知识缺口，补充知识库检索: "${nextQuery}"`,
          },
          config,
        );
        return {
          evidenceAssessment: assessment,
          acceptedChunks,
          analysis: {
            ...state.analysis!,
            rewritten: nextQuery!,
            // 补检索必须聚焦评审器指出的缺口，不再混入原始扩展查询。
            expandedQueries: [],
            entityTerms: [],
          },
          retrievalQuestion: nextQuery!,
          retrievalSource: nextSource as RetrievalSource,
          iteration: state.iteration + 1,
          shouldContinue: true,
        };
      })
      // 所有检索完成后只生成一次最终答案，并直接向客户端流式输出。
      .addNode('generate', async (state: AgentStateValue, config) => {
        this.emit(
          {
            type: AguiEventType.THINKING,
            timestamp: Date.now(),
            content: state.acceptedChunks.length
              ? `基于 ${state.acceptedChunks.length} 个有效知识片段生成回答...`
              : '未找到可用知识，正在生成资料不足说明...',
          },
          config,
        );
        this.emit(
          {
            type: AguiEventType.GENERATION_START,
            timestamp: Date.now(),
            mode: 'rag',
          },
          config,
        );
        this.emit(
          {
            type: AgentInternalEventType.GENERATION_CONTEXT,
            timestamp: Date.now(),
            iteration: state.completedIterations,
            chunks: state.acceptedChunks,
          },
          config,
        );

        const generate = async (): Promise<GeneratedAnswer> => {
          const stream = this.generationService.generateStream(
            state.answerQuestion,
            state.acceptedChunks,
            state.context,
          );
          while (true) {
            const chunk = await stream.next();
            if (chunk.done) return chunk.value;
            this.emit(
              {
                type: AguiEventType.TEXT,
                timestamp: Date.now(),
                content: chunk.value.content,
              },
              config,
            );
          }
        };
        const finalAnswer = isLangfuseTracingEnabled
          ? await startActiveObservation(
              'generate-answer',
              async (generationChain) => {
                generationChain.update({
                  input: {
                    question: state.answerQuestion,
                    context: state.acceptedChunks,
                  },
                  metadata: {
                    retrievalIterations: state.completedIterations,
                    contextChunkCount: state.acceptedChunks.length,
                    longTermMemoryCount:
                      state.context.longTermMemories?.length ?? 0,
                  },
                });
                const generated = await generate();
                generationChain.update({
                  output: {
                    answer: generated.answer,
                    citationChunkIds: generated.citations.map(
                      (citation) => citation.chunkId,
                    ),
                  },
                });
                return generated;
              },
              { asType: 'chain' },
            )
          : await generate();

        this.emit(
          {
            type: AgentInternalEventType.FINAL_GENERATION_CONTEXT,
            timestamp: Date.now(),
            chunks: state.acceptedChunks,
          },
          config,
        );
        this.emit(
          {
            type: AguiEventType.RETRIEVAL_RESULT,
            timestamp: Date.now(),
            chunks: finalAnswer.citations.map((citation) => ({
              chunkId: citation.chunkId,
              documentId: citation.documentId,
              documentTitle: citation.documentTitle,
              originalFileName: citation.originalFileName,
              fileSize: citation.fileSize,
              content: citation.chunkContent,
              similarity: citation.similarity,
              sourceType: citation.sourceType,
              sourceUrl: citation.sourceUrl,
            })),
          },
          config,
        );
        this.emit(
          {
            type: AguiEventType.DONE,
            timestamp: Date.now(),
            queryId: state.queryId,
            totalIterations: state.completedIterations,
          },
          config,
        );
        return {};
      })
      // 图的固定主干。
      .addEdge(START, 'analyze')
      // 问题分析决定走直答分支还是检索分支。
      .addConditionalEdges(
        'analyze',
        (state: AgentStateValue) =>
          !state.analysis!.needsRetrieval ||
          state.analysis!.intent === QueryIntent.CHITCHAT ||
          state.analysis!.intent === QueryIntent.PERSONAL_PREFERENCE
            ? 'directGenerate'
            : 'retrieve',
        ['directGenerate', 'retrieve'],
      )
      .addEdge('directGenerate', END)
      .addEdge('retrieve', 'assessEvidence')
      // 有明确且新颖的知识缺口且仍有共享轮次预算时继续检索，否则生成答案。
      .addConditionalEdges(
        'assessEvidence',
        (state: AgentStateValue) =>
          state.shouldContinue ? 'retrieve' : 'generate',
        ['retrieve', 'generate'],
      )
      .addEdge('generate', END)
      .compile();

    // graph.getGraphAsync().then(drawable => {
    //   console.log(drawable.drawMermaid({ withStyles: true }));
    // })

    return graph;
  }

  /**
   * Agent 核心执行的实时事件流。不依赖 HTTP、鉴权或会话持久化。
   *
   * 线上 SSE 与离线 run() 都消费这一条执行路径，避免评测逻辑偏离生产逻辑。
   */
  private async *runEvents(
    input: AgentRunInput,
  ): AsyncGenerator<AgentExecutionEvent> {
    const {
      question: originalQuestion,
      context,
      userId,
      queryId: providedQueryId,
      ...options
    } = input;
    const queryId = providedQueryId ?? this.generateQueryId();
    const langfuseHandler = isLangfuseTracingEnabled
      ? new CallbackHandler()
      : undefined;

    try {
      const stream = await this.graph.stream(
        {
          queryId,
          originalQuestion,
          userId,
          answerQuestion: originalQuestion,
          retrievalQuestion: originalQuestion,
          context,
          options,
          maxIterations: this.maxIterations,
          iteration: 1,
          completedIterations: 0,
          currentChunks: [],
          acceptedChunks: [],
          searchHistory: [],
          retrievalSource: 'knowledge_base',
          shouldContinue: false,
        },
        {
          streamMode: 'custom',
          ...(langfuseHandler ? { callbacks: [langfuseHandler] } : {}),
        },
      );
      for await (const event of stream) yield event as AgentExecutionEvent;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Agentic RAG 流式查询失败 [${queryId}]: ${message}`);
      yield {
        type: AguiEventType.ERROR,
        timestamp: Date.now(),
        message,
      };
    }
  }

  /**
   * 运行一次完整 Agent 并汇总为可复现、可离线评测的结果。
   * 此方法不会创建会话、保存消息或调用 HTTP 层。
   */
  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const queryId = input.queryId ?? this.generateQueryId();
    const collector = new AgentRunResultCollector(queryId);

    for await (const event of this.runEvents({ ...input, queryId })) {
      collector.consume(event);
    }

    return collector.finish();
  }

  /**
   * Agentic RAG 的 SSE/AGUI 入口，流程如下：
   *
   * 1. 从传输层输入中剥离 conversationId，并确定本次执行的 queryId；
   * 2. 先发送 metadata，供客户端关联会话、查询和最大迭代次数；
   * 3. 将其余输入交给 runEvents()，沿 LangGraph 执行：
   *    analyze → directGenerate，或
   *    analyze → (retrieve → assessEvidence)×N → generate；
   * 4. 转发公开的 AGUI 事件，并拦截仅供离线评估使用的内部事件。
   *
   * 本方法只适配传输协议，不负责会话持久化和 Agent 业务决策。
   */
  async *queryStream(input: QueryStreamInput): AsyncGenerator<AguiEventUnion> {
    const { conversationId, ...runInput } = input;
    const queryId = runInput.queryId ?? this.generateQueryId();

    yield {
      type: AguiEventType.METADATA,
      timestamp: Date.now(),
      data: {
        conversationId,
        queryId,
        maxIterations: this.maxIterations,
      },
    };

    for await (const event of this.runEvents({ ...runInput, queryId })) {
      // 禁止把完整知识库片段下发给 SSE 客户端。
      if (!isInternalAgentEvent(event)) yield event;
    }
  }

  /**
   * 生成查询 ID
   */
  private generateQueryId(): string {
    const snowflake = new SnowflakeId();
    return `agent_${snowflake.generate()}`;
  }
}
