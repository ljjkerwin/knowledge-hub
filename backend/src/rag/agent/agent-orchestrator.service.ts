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
import { AnswerEvaluator, EvaluationResult } from './answer-evaluator.service';
import { RetrievalService } from '../retrieval.service';
import { GraphRetrievalService } from '../graph-retrieval.service';
import { FusionService, RankedRetrievalResult } from '../fusion.service';
import { GenerationService } from '../generation.service';
import { RetrievedChunk, GeneratedAnswer } from '../types/rag.types';
import {
  AguiEventType,
  AguiEventUnion,
  AguiStreamOptions,
} from '../types/agui.types';
import { SearchType } from '../dto/query.dto';

@Injectable()
export class AgentOrchestrator {
  private readonly logger = new Logger(AgentOrchestrator.name);
  private readonly maxIterations: number;
  private readonly maxContextChunks: number;

  constructor(
    private readonly questionAnalyzer: QuestionAnalyzer,
    private readonly strategySelector: StrategySelector,
    private readonly retrievalService: RetrievalService,
    private readonly graphRetrievalService: GraphRetrievalService,
    private readonly fusionService: FusionService,
    private readonly generationService: GenerationService,
    private readonly answerEvaluator: AnswerEvaluator,
    private readonly config: ConfigService,
  ) {
    this.maxIterations = Number(this.config.get('RAG_MAX_ITERATIONS', 3));
    this.maxContextChunks = Number(
      this.config.get('RAG_MAX_CONTEXT_CHUNKS', 12),
    );
  }

  /**
   * 执行检索
   */
  private async executeRetrieval(
    analysis: RewrittenQuery,
    strategy: RetrievalStrategy,
    options?: AguiStreamOptions,
  ): Promise<RetrievedChunk[]> {
    const searchOptions = {
      topK: strategy.candidateTopK,
      categoryId: options?.categoryId,
      teamId: options?.teamId,
      userId: options?.userId,
    };

    const expandedQueries = strategy.expandQuery
      ? analysis.expandedQueries.slice(0, 4)
      : [];
    const queries = [analysis.rewritten, ...expandedQueries];
    const queryWeights = this.getQueryWeights(queries.length);
    const textTasks: Array<Promise<RankedRetrievalResult>> = [];
    for (const [index, query] of queries.entries()) {
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
              weight:
                this.fusionService.getSourceWeight('vector') *
                strategy.sourceWeights.vector *
                queryWeights[index],
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
              weight:
                this.fusionService.getSourceWeight('keyword') *
                strategy.sourceWeights.keyword *
                queryWeights[index],
            })),
        );
      }
    }

    this.logger.verbose('do retrieval')

    const [textResults, graphResults] = await Promise.all([
      Promise.all(textTasks),
      strategy.useKnowledgeGraph
        ? Promise.all(
            queries.map((query, index) =>
              this.graphRetrievalService
                .search(query, searchOptions)
                .then((chunks) => {
                  this.logger.verbose(
                    `graphRetrievalService初步结果（${chunks.length} 条）：${JSON.stringify(chunks, null, 2)}  query：${query}`,
                  );
                  return chunks
                })
                .then((chunks) => ({
                  source: 'graph' as const,
                  chunks,
                  weight:
                    this.fusionService.getSourceWeight('graph') *
                    strategy.sourceWeights.graph *
                    queryWeights[index],
                })),
            ),
          )
        : Promise.resolve([]),
    ]);

    const chunks = this.fusionService.fuse(
      [...textResults, ...graphResults],
      strategy.topK,
    );
    this.logger.verbose(
      `WRRF 融合完成：文本候选=${textResults.reduce((count, result) => count + result.chunks.length, 0)}，图谱候选=${graphResults.reduce((count, result) => count + result.chunks.length, 0)}，最终=${chunks.length}`,
    );
    const topChunks = this.takeTopChunks(chunks, strategy.topK);
    return topChunks;
  }

  /** 原始改写 query 占 60%，其余预算由扩展 query 均分，防止扩展数量放大来源权重。 */
  private getQueryWeights(queryCount: number): number[] {
    if (queryCount <= 1) return [1];
    return [0.6, ...Array(queryCount - 1).fill(0.4 / (queryCount - 1))];
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
  private takeTopChunks(
    chunks: RetrievedChunk[],
    limit: number,
  ): RetrievedChunk[] {
    return chunks.slice(0, Math.max(1, limit));
  }

  /**
   * Agentic RAG 流式查询（AGUI 规范）
   */
  async *queryStream(
    question: string,
    options?: AguiStreamOptions,
  ): AsyncGenerator<AguiEventUnion> {
    const queryId = this.generateQueryId();
    const maxIter = options?.maxIterations || this.maxIterations;
    const enableFollowUp = options?.enableFollowUp !== false;

    // 发送元数据事件
    yield {
      type: AguiEventType.METADATA,
      timestamp: Date.now(),
      data: { queryId, maxIterations: maxIter },
    };

    if (options?.skipRetrieval) {
      yield {
        type: AguiEventType.THINKING,
        timestamp: Date.now(),
        content: '结合上下文判断该消息无需查询知识库，直接生成回复。',
      };
      this.logger.verbose('skipRetrieval')

      const stream = this.generationService.generateDirectStream(question);
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
        totalIterations: 1,
      };
      this.logger.verbose('DONE')
      return;
    }

    let currentQuestion = question;
    let allChunks: RetrievedChunk[] = [];
    let bestAnswer: GeneratedAnswer | null = null;
    let bestEvaluation: EvaluationResult | null = null;

    try {
      for (let iteration = 1; iteration <= maxIter; iteration++) {
        // 发送思考事件
        yield {
          type: AguiEventType.THINKING,
          timestamp: Date.now(),
          content: `开始第 ${iteration} 轮迭代分析...`,
        };

        // 1. 问题分析
        const analysis = await this.questionAnalyzer.analyze(currentQuestion);
        yield {
          type: AguiEventType.THINKING,
          timestamp: Date.now(),
          content: `问题意图: ${analysis.intent}, 改写为: "${analysis.rewritten}"`,
        };
        this.logger.verbose('questionAnalyzer' + JSON.stringify(analysis, null, 2));

        if (analysis.intent === QueryIntent.CHITCHAT) {
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

        // 3. 执行检索
        yield {
          type: AguiEventType.RETRIEVAL_START,
          timestamp: Date.now(),
          query: analysis.rewritten,
          searchType: strategy.searchType,
        };

        const chunks = await this.executeRetrieval(analysis, strategy, options);

        // this.logger.verbose(`chunks` + JSON.stringify(chunks, null, 2));

        allChunks = this.takeTopChunks(
          this.mergeChunks(allChunks, chunks),
          this.maxContextChunks,
        );

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

        // 4. 生成答案（流式）
        yield {
          type: AguiEventType.THINKING,
          timestamp: Date.now(),
          content: `基于 ${allChunks.length} 个相关片段生成答案...`,
        };

        let answerText = '';
        const stream = this.generationService.generateStream(
          currentQuestion,
          allChunks,
        );
        for await (const chunk of stream) {
          if (chunk.type === 'token') {
            answerText += chunk.content;
            yield {
              type: AguiEventType.TEXT,
              timestamp: Date.now(),
              content: chunk.content,
            };
          } else if (chunk.type === 'citations') {
            yield {
              type: AguiEventType.TOOL_RESULT,
              timestamp: Date.now(),
              toolName: 'retrieval',
              result: { citations: chunk.content },
            };
          }
        }

        // 构建完整答案
        const answer: GeneratedAnswer = {
          answer: answerText,
          citations: allChunks.map((c, i) => ({
            index: i + 1,
            documentId: c.documentId,
            documentTitle: c.documentTitle,
            chunkContent: c.content.substring(0, 200),
            heading: c.heading,
            similarity: c.similarity,
          })),
          confidence: this.calculateConfidence(allChunks),
        };

        // 5. 评估答案
        const evaluation = await this.answerEvaluator.evaluate(
          question,
          answer,
        );
        yield {
          type: AguiEventType.EVALUATION,
          timestamp: Date.now(),
          relevance: evaluation.relevance,
          completeness: evaluation.completeness,
          needsFollowUp: evaluation.needsFollowUp,
          followUpQuestion: evaluation.followUpQuestion,
        };

        // 更新最佳答案
        if (
          !bestAnswer ||
          evaluation.relevance > (bestEvaluation?.relevance || 0)
        ) {
          bestAnswer = answer;
          bestEvaluation = evaluation;
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

        // 7. 准备下一轮迭代
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

      // 发送完成事件
      yield {
        type: AguiEventType.DONE,
        timestamp: Date.now(),
        queryId,
        totalIterations: allChunks.length > 0 ? 1 : 0,
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

  /**
   * 计算置信度
   */
  private calculateConfidence(chunks: RetrievedChunk[]): number {
    if (chunks.length === 0) return 0;
    const avgSimilarity =
      chunks.reduce((sum, c) => sum + c.similarity, 0) / chunks.length;
    return Math.round(avgSimilarity * 100) / 100;
  }

  /**
   * 生成查询 ID
   */
  private generateQueryId(): string {
    const snowflake = new SnowflakeId();
    return `agent_${snowflake.generate()}`;
  }
}
