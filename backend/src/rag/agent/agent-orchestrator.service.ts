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
import { GenerationService } from '../generation.service';
import { RetrievedChunk, GeneratedAnswer, Citation } from '../types/rag.types';
import {
  AguiEventType,
  AguiEventUnion,
  AguiStreamOptions,
} from '../types/agui.types';

// Agent 响应
export interface AgentResponse {
  answer: string;
  citations: Citation[];
  confidence: number;
  queryId: string;
  iterations: number;
  reasoning: ReasoningStep[];
}

// 推理步骤
export interface ReasoningStep {
  step: string;
  result: string;
}

// Agent 选项
export interface AgentOptions {
  maxIterations?: number;
  enableFollowUp?: boolean;
  userId?: string;
  categoryId?: string;
  teamId?: string;
}

@Injectable()
export class AgentOrchestrator {
  private readonly logger = new Logger(AgentOrchestrator.name);
  private readonly maxIterations: number;

  constructor(
    private readonly questionAnalyzer: QuestionAnalyzer,
    private readonly strategySelector: StrategySelector,
    private readonly retrievalService: RetrievalService,
    private readonly generationService: GenerationService,
    private readonly answerEvaluator: AnswerEvaluator,
    private readonly config: ConfigService,
  ) {
    this.maxIterations = Number(this.config.get('RAG_MAX_ITERATIONS', 3));
  }

  /**
   * Agentic RAG 查询流程
   */
  async query(
    question: string,
    options?: AgentOptions,
  ): Promise<AgentResponse> {
    const queryId = this.generateQueryId();
    const maxIter = options?.maxIterations || this.maxIterations;
    const enableFollowUp = options?.enableFollowUp !== false;

    this.logger.log(`开始 Agentic RAG 查询 [${queryId}]: ${question}`);

    const reasoning: ReasoningStep[] = [];
    let currentQuestion = question;
    let allChunks: RetrievedChunk[] = [];
    let bestAnswer: GeneratedAnswer | null = null;
    let bestEvaluation: EvaluationResult | null = null;

    for (let iteration = 1; iteration <= maxIter; iteration++) {
      this.logger.log(`迭代 ${iteration}/${maxIter} [${queryId}]`);

      // 1. 问题分析
      const analysis = await this.questionAnalyzer.analyze(currentQuestion);
      reasoning.push({
        step: `iteration_${iteration}_analysis`,
        result: `意图: ${analysis.intent}, 改写: "${analysis.rewritten}", 扩展查询: ${analysis.expandedQueries.length}个`,
      });

      // 2. 策略选择
      const strategy = this.strategySelector.selectStrategy(
        analysis.intent,
        currentQuestion,
      );
      reasoning.push({
        step: `iteration_${iteration}_strategy`,
        result: `检索方式: ${strategy.searchType}, topK: ${strategy.topK}, 重排序: ${strategy.rerank}`,
      });

      // 3. 执行检索
      const chunks = await this.executeRetrieval(analysis, strategy, options);
      reasoning.push({
        step: `iteration_${iteration}_retrieval`,
        result: `检索到 ${chunks.length} 个相关片段`,
      });

      // 合并检索结果（去重）
      allChunks = this.mergeChunks(allChunks, chunks);

      // 4. 生成答案
      const answer = await this.generationService.generate(
        currentQuestion,
        allChunks,
      );
      reasoning.push({
        step: `iteration_${iteration}_generation`,
        result: `生成答案，引用 ${answer.citations.length} 个来源，置信度 ${answer.confidence}`,
      });

      // 5. 评估答案
      const evaluation = await this.answerEvaluator.evaluate(question, answer);
      reasoning.push({
        step: `iteration_${iteration}_evaluation`,
        result: `相关性: ${evaluation.relevance}, 完整性: ${evaluation.completeness}, 需追问: ${evaluation.needsFollowUp}`,
      });

      // 更新最佳答案
      if (
        !bestAnswer ||
        evaluation.relevance > (bestEvaluation?.relevance || 0)
      ) {
        bestAnswer = answer;
        bestEvaluation = evaluation;
      }

      // 6. 判断是否需要继续迭代
      if (!enableFollowUp || !this.answerEvaluator.shouldFollowUp(evaluation)) {
        this.logger.log(`答案质量满足要求，停止迭代 [${queryId}]`);
        break;
      }

      // 7. 准备下一轮迭代
      if (evaluation.followUpQuestion) {
        currentQuestion = evaluation.followUpQuestion;
        reasoning.push({
          step: `iteration_${iteration}_followup`,
          result: `追问: "${evaluation.followUpQuestion}"`,
        });
      } else {
        // 使用扩展查询
        const expandedQuery = analysis.expandedQueries.find(
          (q) => !currentQuestion.includes(q),
        );
        if (expandedQuery) {
          currentQuestion = expandedQuery;
          reasoning.push({
            step: `iteration_${iteration}_expand`,
            result: `使用扩展查询: "${expandedQuery}"`,
          });
        } else {
          this.logger.log(`无更多优化策略，停止迭代 [${queryId}]`);
          break;
        }
      }
    }

    // 构建最终响应
    const response: AgentResponse = {
      answer: bestAnswer?.answer || '抱歉，无法生成满意的答案。',
      citations: bestAnswer?.citations || [],
      confidence: bestAnswer?.confidence || 0,
      queryId,
      iterations: reasoning.length,
      reasoning,
    };

    this.logger.log(
      `Agentic RAG 查询完成 [${queryId}]: 迭代次数=${response.iterations}, 置信度=${response.confidence}`,
    );

    return response;
  }

  /**
   * 执行检索
   */
  private async executeRetrieval(
    analysis: RewrittenQuery,
    strategy: RetrievalStrategy,
    options?: AgentOptions,
  ): Promise<RetrievedChunk[]> {
    const searchOptions = {
      topK: strategy.topK,
      categoryId: options?.categoryId,
      teamId: options?.teamId,
      userId: options?.userId,
      hybridAlpha: strategy.hybridAlpha,
    };

    // 如果有扩展查询，执行多路检索
    if (strategy.expandQuery && analysis.expandedQueries.length > 0) {
      const queries = [analysis.rewritten, ...analysis.expandedQueries];
      const allResults = await Promise.all(
        queries.map((query) =>
          this.executeSearch(query, strategy.searchType, searchOptions),
        ),
      );
      return this.mergeChunks(...allResults);
    }

    return this.executeSearch(
      analysis.rewritten,
      strategy.searchType,
      searchOptions,
    );
  }

  /**
   * 执行单次检索
   */
  private async executeSearch(
    query: string,
    searchType: string,
    options: any,
  ): Promise<RetrievedChunk[]> {
    switch (searchType) {
      case 'vector':
        return this.retrievalService.vectorSearch(query, options);
      case 'keyword':
        return this.retrievalService.keywordSearch(query, options);
      case 'hybrid':
      default:
        return this.retrievalService.hybridSearch(query, options);
    }
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

    this.logger.log(`开始 Agentic RAG 流式查询 [${queryId}]: ${question}`);

    // 发送元数据事件
    yield {
      type: AguiEventType.METADATA,
      timestamp: Date.now(),
      data: { queryId, maxIterations: maxIter },
    };

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
            topK: strategy.topK,
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
        allChunks = this.mergeChunks(allChunks, chunks);

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
