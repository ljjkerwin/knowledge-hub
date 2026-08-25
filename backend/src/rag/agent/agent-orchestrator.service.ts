import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import SnowflakeId from 'snowflake-id';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import {
  QuestionAnalyzer,
  RewrittenQuery,
  QueryIntent,
} from './question-analyzer.service';
import {
  StrategySelector,
  RetrievalStrategy,
} from './strategy-selector.service';
import { AnswerEvaluator, EvaluationResult } from './answer-evaluator.service';
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
import { SearchType } from '../dto/query.dto';
import type { ConversationContext } from '../context-manager.service';

interface WeightedQuery {
  query: string;
  weight: number;
}

/** LangGraph 中流转的业务状态；AGUI 事件经 custom stream 单独传输。 */
const AgentState = Annotation.Root({
  queryId: Annotation<string>,
  originalQuestion: Annotation<string>,
  /** 首轮结合会话上下文改写出的独立问题；用于生成与评估。 */
  answerQuestion: Annotation<string>,
  /** 每轮分析、检索所用的问题；可能是追问或扩展查询。 */
  retrievalQuestion: Annotation<string>,
  context: Annotation<ConversationContext>,
  options: Annotation<AguiStreamOptions>,
  maxIterations: Annotation<number>,
  iteration: Annotation<number>,
  completedIterations: Annotation<number>,
  analysis: Annotation<RewrittenQuery | undefined>,
  strategy: Annotation<RetrievalStrategy | undefined>,
  allChunks: Annotation<RetrievedChunk[]>,
  draft: Annotation<GeneratedAnswer | undefined>,
  bestAnswer: Annotation<GeneratedAnswer | undefined>,
  bestRelevance: Annotation<number>,
  evaluation: Annotation<EvaluationResult | undefined>,
  shouldContinue: Annotation<boolean>,
});

type AgentStateValue = typeof AgentState.State;

/** Agent 流式查询的完整输入；Controller 只负责准备会话上下文并转发 SSE。 */
export interface QueryStreamInput extends AguiStreamOptions {
  /** 用户本轮输入的原始问题，用于保留精确术语。 */
  question: string;
  /** 必须在保存当前用户消息前构建，避免问题参与自身的上下文改写。 */
  context: ConversationContext;
}

@Injectable()
export class AgentOrchestrator {
  private readonly logger = new Logger(AgentOrchestrator.name);
  private readonly maxIterations: number;
  /** 跨轮检索结果累计后，允许进入生成上下文的最大片段数。 */
  private readonly maxAccumulatedContextChunks: number;
  private readonly simulatedStreamChunkIntervalMs: number;
  private readonly graph: ReturnType<AgentOrchestrator['buildGraph']>;

  constructor(
    private readonly questionAnalyzer: QuestionAnalyzer,
    private readonly strategySelector: StrategySelector,
    private readonly retrievalService: RetrievalService,
    private readonly graphRetrievalService: GraphRetrievalService,
    private readonly fusionService: FusionService,
    private readonly rerankerService: RerankerService,
    private readonly generationService: GenerationService,
    private readonly answerEvaluator: AnswerEvaluator,
    private readonly config: ConfigService,
  ) {
    this.maxIterations = Number(this.config.get('RAG_MAX_ITERATIONS', 3));
    this.maxAccumulatedContextChunks = Number(
      this.config.get('RAG_MAX_CONTEXT_CHUNKS', 12),
    );
    const configuredInterval = Number(
      this.config.get('RAG_SIMULATED_STREAM_CHUNK_INTERVAL_MS', 80),
    );
    this.simulatedStreamChunkIntervalMs = Number.isFinite(configuredInterval)
      ? Math.max(0, configuredInterval)
      : 80;
    this.graph = this.buildGraph();
  }

  /**
   * 执行检索
   */
  private async executeRetrieval(
    analysis: RewrittenQuery,
    strategy: RetrievalStrategy,
    options?: AguiStreamOptions,
    originalQuery?: string,
  ): Promise<RetrievedChunk[]> {
    const searchOptions = {
      topK: strategy.candidateTopK,
      categoryId: options?.categoryId,
      teamId: options?.teamId,
      userId: options?.userId,
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
            .then((chunks) => ({
              source: 'keyword',
              chunks,
              weight: strategy.sourceWeights.keyword * weight,
            })),
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

    this.logger.verbose(`[langgraph][fusionCandidates] ${JSON.stringify(fusionCandidates, null, 2)}`)

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
    const candidates: WeightedQuery[] = [
      { query: analysis.rewritten, weight: 0.75 },
      { query: originalQuery ?? '', weight: 0.15 },
    ];

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

    const queries = Array.from(unique.values()).slice(0, 5);
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

  /** 业务节点写入 custom stream，queryStream 仅负责映射到 SSE。 */
  private emit(
    event: AguiEventUnion,
    config: { writer?: (event: AguiEventUnion) => void },
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
            content: `开始第 ${state.iteration} 轮迭代分析...`,
          },
          config,
        );
        const analysis = await this.questionAnalyzer.analyze({
          question: state.retrievalQuestion,
          context: state.iteration === 1 ? state.context : undefined,
        });
        this.emit(
          {
            type: AguiEventType.THINKING,
            timestamp: Date.now(),
            content: `问题意图: ${analysis.intent}, 改写为: "${analysis.rewritten}"`,
          },
          config,
        );

        this.logger.verbose(`[langgraph][analyze] ${JSON.stringify(analysis, null, 2)} ${analysis.rewritten}`)

        return {
          analysis,
          retrievalQuestion: analysis.rewritten,
          // 只在首轮固定答案目标，避免后续追问覆盖用户的原始意图。
          answerQuestion:
            state.iteration === 1
              ? analysis.rewritten
              : state.answerQuestion,
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

        this.logger.verbose(`[langgraph][directGenerate]`)

        for await (const chunk of this.generationService.generateDirectStream(
          state.originalQuestion,
          state.context,
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
      // 策略只负责选择参数；真正的检索由下一节点执行。
      .addNode('selectStrategy', (state: AgentStateValue, config) => {
        const strategy = this.strategySelector.selectStrategy(
          state.analysis!.intent,
          state.retrievalQuestion,
        );
        this.emit(
          {
            type: AguiEventType.TOOL_CALL,
            timestamp: Date.now(),
            toolName: 'retrieval',
            args: {
              query: state.analysis!.rewritten,
              searchType: strategy.searchType,
              candidateTopK: strategy.candidateTopK,
              finalTopK: strategy.topK,
            },
          },
          config,
        );

        this.logger.verbose(`[langgraph][strategy] ${JSON.stringify(strategy, null, 2)}`)

        return { strategy };
      })
      // 跨轮合并、去重并限制上下文大小，避免生成提示词无限增长。
      .addNode('retrieve', async (state: AgentStateValue, config) => {
        const { analysis, strategy } = state;
        this.emit(
          {
            type: AguiEventType.RETRIEVAL_START,
            timestamp: Date.now(),
            query: analysis!.rewritten,
            searchType: strategy!.searchType,
          },
          config,
        );
        const chunks = await this.executeRetrieval(
          analysis!,
          strategy!,
          state.options,
          state.originalQuestion,
        );

        this.logger.verbose(`[langgraph][chunks] ${JSON.stringify(chunks, null, 2)}`)

        const allChunks = this.takeTopAccumulatedChunks(
          this.mergeChunks(state.allChunks, chunks),
          this.maxAccumulatedContextChunks,
        );
        this.emit(
          {
            type: AguiEventType.RETRIEVAL_RESULT,
            timestamp: Date.now(),
            chunks: chunks.map((chunk) => ({
              documentId: chunk.documentId,
              documentTitle: chunk.documentTitle,
              content: `${chunk.content.substring(0, 200)}...`,
              similarity: chunk.similarity,
            })),
          },
          config,
        );
        return { allChunks, completedIterations: state.iteration };
      })
      // 草稿保持在服务端，客户端只在最终节点收到选中的答案。
      .addNode('generateDraft', async (state: AgentStateValue, config) => {
        this.emit(
          {
            type: AguiEventType.THINKING,
            timestamp: Date.now(),
            content: `基于 ${state.allChunks.length} 个相关片段生成草稿并评估...`,
          },
          config,
        );

        this.logger.verbose(`[langgraph][generateDraft]`)

        const draft = await this.generationService.generate(
          state.answerQuestion,
          state.allChunks,
        );
        return { draft };
      })
      // 更新最佳草稿，并决定跳回 analyze 开始下一轮或进入 finalize。
      .addNode('evaluate', async (state: AgentStateValue, config) => {
        const evaluation = await this.answerEvaluator.evaluate(
          state.answerQuestion,
          state.draft!,
        );

        this.logger.verbose(`[langgraph][evaluation] ${JSON.stringify(evaluation, null, 2)}`)

        this.emit(
          {
            type: AguiEventType.EVALUATION,
            timestamp: Date.now(),
            relevance: evaluation.relevance,
            completeness: evaluation.completeness,
            needsFollowUp: evaluation.needsFollowUp,
            followUpQuestion: evaluation.followUpQuestion,
          },
          config,
        );
        const best =
          evaluation.relevance > state.bestRelevance
            ? state.draft!
            : state.bestAnswer!;
        const canContinue =
          state.options.enableFollowUp !== false &&
          this.answerEvaluator.shouldFollowUp(evaluation) &&
          state.iteration < state.maxIterations;
        if (!canContinue)
          return {
            evaluation,
            bestAnswer: best,
            bestRelevance: Math.max(state.bestRelevance, evaluation.relevance),
            shouldContinue: false,
          };
        const nextQuestion =
          evaluation.followUpQuestion ||
          state.analysis!.expandedQueries.find(
            (query) => !state.retrievalQuestion.includes(query),
          );
        if (!nextQuestion)
          return {
            evaluation,
            bestAnswer: best,
            bestRelevance: Math.max(state.bestRelevance, evaluation.relevance),
            shouldContinue: false,
          };
        this.emit(
          {
            type: AguiEventType.THINKING,
            timestamp: Date.now(),
            content: evaluation.followUpQuestion
              ? `需要追问: "${nextQuestion}"`
              : `使用扩展查询: "${nextQuestion}"`,
          },
          config,
        );
        return {
          evaluation,
          bestAnswer: best,
          bestRelevance: Math.max(state.bestRelevance, evaluation.relevance),
          retrievalQuestion: nextQuestion,
          iteration: state.iteration + 1,
          shouldContinue: true,
        };
      })
      // 复用最佳草稿并按 SSE 友好的片段输出；不额外调用模型。
      .addNode('finalize', async (state: AgentStateValue, config) => {
        const answer = state.bestAnswer;
        if (!answer) throw new Error('大模型未生成可返回的答案草稿。');
        this.emit(
          {
            type: AguiEventType.RETRIEVAL_RESULT,
            timestamp: Date.now(),
            chunks: answer.citations.map((citation) => ({
              documentId: citation.documentId,
              documentTitle: citation.documentTitle,
              content: citation.chunkContent,
              similarity: citation.similarity,
            })),
          },
          config,
        );
        this.emit(
          {
            type: AguiEventType.THINKING,
            timestamp: Date.now(),
            content: `已选择最佳草稿，基于 ${answer.citations.length} 个相关片段返回答案...`,
          },
          config,
        );
        const chunks = this.splitAnswerForStreaming(answer.answer);
        for (const [index, content] of chunks.entries()) {
          this.emit(
            { type: AguiEventType.TEXT, timestamp: Date.now(), content },
            config,
          );
          if (index < chunks.length - 1 && this.simulatedStreamChunkIntervalMs)
            await new Promise<void>((resolve) =>
              setTimeout(resolve, this.simulatedStreamChunkIntervalMs),
            );
        }
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
      .addConditionalEdges('analyze', (state: AgentStateValue) =>
        !state.analysis!.needsRetrieval ||
        state.analysis!.intent === QueryIntent.CHITCHAT
          ? 'directGenerate'
          : 'selectStrategy',
        ['directGenerate', 'selectStrategy'],
      )
      .addEdge('directGenerate', END)
      .addEdge('selectStrategy', 'retrieve')
      .addEdge('retrieve', 'generateDraft')
      .addEdge('generateDraft', 'evaluate')
      // 质量不足且可继续时回到 analyze，否则输出当前最佳答案。
      .addConditionalEdges('evaluate', (state: AgentStateValue) =>
        state.shouldContinue ? 'analyze' : 'finalize',
        ['analyze', 'finalize'],
      )
      .addEdge('finalize', END)
      .compile();

    graph.getGraphAsync().then(drawable => {
      console.log(drawable.drawMermaid({ withStyles: true }));
    })

    return graph
  }

  /**
   * Agentic RAG 流式查询（AGUI 规范）
   */
  async *queryStream(input: QueryStreamInput): AsyncGenerator<AguiEventUnion> {
    const { question: originalQuestion, context, ...options } = input;
    const queryId = this.generateQueryId();
    const maxIter = options?.maxIterations || this.maxIterations;
    yield {
      type: AguiEventType.METADATA,
      timestamp: Date.now(),
      data: { queryId, maxIterations: maxIter },
    };

    try {
      const stream = await this.graph.stream(
        {
          queryId,
          originalQuestion,
          answerQuestion: originalQuestion,
          retrievalQuestion: originalQuestion,
          context,
          options,
          maxIterations: maxIter,
          iteration: 1,
          completedIterations: 0,
          allChunks: [],
          bestRelevance: Number.NEGATIVE_INFINITY,
          shouldContinue: false,
        },
        { streamMode: 'custom' },
      );
      for await (const event of stream) yield event as AguiEventUnion;
    } catch (error) {
      this.logger.error(
        `Agentic RAG 流式查询失败 [${queryId}]: ${error.message}`,
      );
      yield {
        type: AguiEventType.ERROR,
        timestamp: Date.now(),
        message: error.message,
      };
    }
  }

  /** 将已生成答案拆为适合 SSE 逐步展示的片段，优先保留段落和句子边界。 */
  private splitAnswerForStreaming(answer: string, maxLength = 50): string[] {
    const chunks: string[] = [];
    let remaining = answer;

    while (remaining.length > maxLength) {
      const boundary = Math.max(
        remaining.lastIndexOf('\n\n', maxLength),
        remaining.lastIndexOf('\n', maxLength),
        remaining.lastIndexOf('。', maxLength),
        remaining.lastIndexOf('！', maxLength),
        remaining.lastIndexOf('？', maxLength),
      );
      const splitAt =
        boundary < maxLength / 2
          ? maxLength
          : boundary + (remaining.startsWith('\n\n', boundary) ? 2 : 1);

      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt);
    }

    if (remaining) chunks.push(remaining);
    return chunks;
  }

  /**
   * 生成查询 ID
   */
  private generateQueryId(): string {
    const snowflake = new SnowflakeId();
    return `agent_${snowflake.generate()}`;
  }
}
