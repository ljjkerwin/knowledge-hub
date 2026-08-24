import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import SnowflakeId from 'snowflake-id';
import {
  QuestionAnalyzer,
  RewrittenQuery,
  QueryIntent,
} from './question-analyzer.service';
import {
  StrategySelector,
  RetrievalStrategy,
} from './strategy-selector.service';
import { AnswerEvaluator } from './answer-evaluator.service';
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

    this.logger.verbose('do retrieval')

    const graphTask: Promise<RankedRetrievalResult[]> = strategy.useKnowledgeGraph
      ? this.graphRetrievalService
          // 图谱实体词来自同一次问题分析；每轮只查询一次，避免扩展 query 重复访问 Neo4j。
          .search(analysis.rewritten, searchOptions, analysis.entityTerms ?? [])
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

  /**
   * Agentic RAG 流式查询（AGUI 规范）
   */
  async *queryStream(
    input: QueryStreamInput,
  ): AsyncGenerator<AguiEventUnion> {
    const { question: originalQuestion, context, ...options } = input;
    const queryId = this.generateQueryId();
    const maxIter = options?.maxIterations || this.maxIterations;
    const enableFollowUp = options?.enableFollowUp !== false;

    // 发送元数据事件
    yield {
      type: AguiEventType.METADATA,
      timestamp: Date.now(),
      data: { queryId, maxIterations: maxIter },
    };

    let currentQuestion = originalQuestion;
    let allChunks: RetrievedChunk[] = [];
    let completedIterations = 0;
    let bestAnswer: GeneratedAnswer | null = null;
    let bestRelevance = Number.NEGATIVE_INFINITY;

    try {
      for (let iteration = 1; iteration <= maxIter; iteration++) {
        // 发送思考事件
        yield {
          type: AguiEventType.THINKING,
          timestamp: Date.now(),
          content: `开始第 ${iteration} 轮迭代分析...`,
        };

        // 1. 问题分析
        const analysis = await this.questionAnalyzer.analyze({
          question: currentQuestion,
          context: iteration === 1 ? context : undefined,
        });
        yield {
          type: AguiEventType.THINKING,
          timestamp: Date.now(),
          content: `问题意图: ${analysis.intent}, 改写为: "${analysis.rewritten}"`,
        };

        this.logger.verbose('questionAnalyzer' + JSON.stringify(analysis, null, 2));

        // 后续策略、检索、生成都使用模型生成的独立改写问题。
        currentQuestion = analysis.rewritten;

        if (!analysis.needsRetrieval || analysis.intent === QueryIntent.CHITCHAT) {
          yield {
            type: AguiEventType.THINKING,
            timestamp: Date.now(),
            content: '该消息无需查询知识库，直接生成回复。',
          };
          const stream =
            this.generationService.generateDirectStream(currentQuestion);
          for await (const chunk of stream) {
            if (chunk.type === 'token') {
              yield {
                type: AguiEventType.TEXT,
                timestamp: Date.now(),
                content: chunk.content,
              };
            } else if (chunk.type === 'error') {
              throw new Error(chunk.content);
            }
          }
          yield {
            type: AguiEventType.DONE,
            timestamp: Date.now(),
            queryId,
            totalIterations: iteration,
          };
          this.logger.verbose('DONE')
          return;
        }

        // 2. 策略选择
        const strategy = this.strategySelector.selectStrategy(
          analysis.intent,
          currentQuestion,
        );
        yield {
          type: AguiEventType.TOOL_CALL,
          timestamp: Date.now(),
          toolName: 'retrieval',
          args: {
            query: analysis.rewritten,
            searchType: strategy.searchType,
            candidateTopK: strategy.candidateTopK,
            finalTopK: strategy.topK,
          },
        };
                
        this.logger.verbose('strategy' + JSON.stringify(strategy, null, 2));

        // 3. 执行检索
        yield {
          type: AguiEventType.RETRIEVAL_START,
          timestamp: Date.now(),
          query: analysis.rewritten,
          searchType: strategy.searchType,
        };

        const chunks = await this.executeRetrieval(
          analysis,
          strategy,
          options,
          originalQuestion,
        );

        this.logger.verbose(`chunks` + JSON.stringify(chunks, null, 2));

        // 合并跨轮结果后限制总上下文，单轮 topK 已由 executeRetrieval 控制。
        allChunks = this.takeTopAccumulatedChunks(
          this.mergeChunks(allChunks, chunks),
          this.maxAccumulatedContextChunks,
        );
        completedIterations = iteration;

        yield {
          type: AguiEventType.RETRIEVAL_RESULT,
          timestamp: Date.now(),
          chunks: chunks.map((c) => ({
            documentId: c.documentId,
            documentTitle: c.documentTitle,
            content: c.content.substring(0, 200) + '...',
            similarity: c.similarity,
          })),
        };

        // 4. 在服务端生成并评估草稿。草稿不会发送给客户端，避免多轮完整答案被拼接。
        yield {
          type: AguiEventType.THINKING,
          timestamp: Date.now(),
          content: `基于 ${allChunks.length} 个相关片段生成草稿并评估...`,
        };

        this.logger.verbose(`生成答案，基于 ${allChunks.length} 个相关片段生成答案`)

        const draft = await this.generationService.generate(
          originalQuestion,
          allChunks,
        );

        this.logger.verbose(`评估答案 ${JSON.stringify(draft, null, 2)}`)

        // 5. 评估答案
        const evaluation = await this.answerEvaluator.evaluate(
          originalQuestion,
          draft,
        );
        yield {
          type: AguiEventType.EVALUATION,
          timestamp: Date.now(),
          relevance: evaluation.relevance,
          completeness: evaluation.completeness,
          needsFollowUp: evaluation.needsFollowUp,
          followUpQuestion: evaluation.followUpQuestion,
        };

        // 保留最佳草稿，迭代结束后直接返回，避免为最终回答额外调用一次模型。
        if (evaluation.relevance > bestRelevance) {
          bestAnswer = draft;
          bestRelevance = evaluation.relevance;
        }

        // 6. 判断是否需要继续迭代
        if (
          !enableFollowUp ||
          !this.answerEvaluator.shouldFollowUp(evaluation)
        ) {
          yield {
            type: AguiEventType.THINKING,
            timestamp: Date.now(),
            content: `答案质量满足要求，停止迭代`,
          };
          break;
        }

        this.logger.verbose(`准备下一轮迭代 ${JSON.stringify(evaluation, null, 2)}`)

        // 7. 准备下一轮迭代：只切换下一次检索的查询，草稿始终不对客户端可见。
        if (evaluation.followUpQuestion) {
          currentQuestion = evaluation.followUpQuestion;
          yield {
            type: AguiEventType.THINKING,
            timestamp: Date.now(),
            content: `需要追问: "${evaluation.followUpQuestion}"`,
          };
        } else {
          const expandedQuery = analysis.expandedQueries.find(
            (q) => !currentQuestion.includes(q),
          );
          if (expandedQuery) {
            currentQuestion = expandedQuery;
            yield {
              type: AguiEventType.THINKING,
              timestamp: Date.now(),
              content: `使用扩展查询: "${expandedQuery}"`,
            };
          } else {
            break;
          }
        }
      }

      // 未获得草稿视为大模型调用失败；不再额外请求模型进行兜底。
      if (!bestAnswer) {
        throw new Error('大模型未生成可返回的答案草稿。');
      }
      const finalAnswer = bestAnswer;

      // 发送最佳草稿生成时对应的引用，保证答案与引用来自同一轮上下文。
      yield {
        type: AguiEventType.RETRIEVAL_RESULT,
        timestamp: Date.now(),
        chunks: finalAnswer.citations.map((citation) => ({
          documentId: citation.documentId,
          documentTitle: citation.documentTitle,
          content: citation.chunkContent,
          similarity: citation.similarity,
        })),
      };
      yield {
        type: AguiEventType.THINKING,
        timestamp: Date.now(),
        content: `已选择最佳草稿，基于 ${finalAnswer.citations.length} 个相关片段返回答案...`,
      };
      // 复用已评估草稿，按片段发送以保持前端逐步展示；不额外调用模型。
      const answerChunks = this.splitAnswerForStreaming(finalAnswer.answer);
      for (const [index, content] of answerChunks.entries()) {
        yield {
          type: AguiEventType.TEXT,
          timestamp: Date.now(),
          content,
        };
        if (index < answerChunks.length - 1 && this.simulatedStreamChunkIntervalMs) {
          await new Promise<void>((resolve) =>
            setTimeout(resolve, this.simulatedStreamChunkIntervalMs),
          );
        }
      }

      // 发送完成事件
      yield {
        type: AguiEventType.DONE,
        timestamp: Date.now(),
        queryId,
        totalIterations: completedIterations,
      };

      this.logger.verbose('DONE')
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
