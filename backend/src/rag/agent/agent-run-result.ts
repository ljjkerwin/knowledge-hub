import type { ConversationContext } from '../context-manager.service';
import {
  AguiEventType,
  AguiEventUnion,
  AguiStreamOptions,
} from '../types/agui.types';
import type { Citation } from '../types/rag.types';
import type { RetrievedChunk } from '../types/rag.types';

/**
 * 仅在 Agent 核心执行与离线评估之间传递，绝不映射到 SSE/AGUI。
 * 完整 chunk 可能包含内部知识，不可复用公开的 RETRIEVAL_RESULT 事件承载。
 */
export enum AgentInternalEventType {
  GENERATION_CONTEXT = '__generation_context',
  FINAL_GENERATION_CONTEXT = '__final_generation_context',
}

export interface AgentGenerationContextEvent {
  type: AgentInternalEventType.GENERATION_CONTEXT;
  timestamp: number;
  iteration: number;
  chunks: RetrievedChunk[];
}

export interface AgentFinalGenerationContextEvent {
  type: AgentInternalEventType.FINAL_GENERATION_CONTEXT;
  timestamp: number;
  chunks: RetrievedChunk[];
}

export type AgentExecutionEvent =
  | AguiEventUnion
  | AgentGenerationContextEvent
  | AgentFinalGenerationContextEvent;

export function isInternalAgentEvent(
  event: AgentExecutionEvent,
): event is AgentGenerationContextEvent | AgentFinalGenerationContextEvent {
  return (
    event.type === AgentInternalEventType.GENERATION_CONTEXT ||
    event.type === AgentInternalEventType.FINAL_GENERATION_CONTEXT
  );
}

/** 不依赖 HTTP、鉴权或会话持久化的 Agent 核心输入。 */
export interface AgentRunInput extends AguiStreamOptions {
  question: string;
  context: ConversationContext;
  /** 调用方可指定，用于将离线实验与 trace 或数据集项关联。 */
  queryId?: string;
}

export type AgentRoute = 'direct' | 'rag' | 'unknown';

export interface AgentRunResult {
  queryId: string;
  route: AgentRoute;
  answer: string;
  citations: Citation[];
  analyses: Array<{
    rewritten: string;
    intent: string;
    needsRetrieval: boolean;
    entityTerms: string[];
  }>;
  retrievalQueries: string[];
  draftAssessments: Array<{
    answerRelevance: number;
    answerCompleteness: number;
    shouldRetrieveMore: boolean;
  }>;
  /**
   * 每轮生成实际使用的完整上下文，只在离线评估结果中提供。
   * 注意：内容可能含有内部知识，结果文件应按相同数据分级保护。
   */
  generationContexts: Array<{
    iteration: number;
    chunks: RetrievedChunk[];
  }>;
  /** 最终返回答案对应的完整上下文，供 groundedness evaluator 直接使用。 */
  finalGenerationContext: RetrievedChunk[];
  totalIterations: number;
  completed: boolean;
  error?: { message: string; code?: string };
  timings: {
    totalMs: number;
    timeToFirstEventMs?: number;
    timeToFirstTextMs?: number;
  };
}

/** 将一次核心执行过程中产生的事件归并成供离线评测消费的结果。 */
export class AgentRunResultCollector {
  private readonly startedAt: number;
  private firstEventAt?: number;
  private firstTextAt?: number;
  private route: AgentRoute = 'unknown';
  private answer = '';
  private citations: Citation[] = [];
  private readonly analyses: AgentRunResult['analyses'] = [];
  private readonly retrievalQueries: string[] = [];
  private readonly draftAssessments: AgentRunResult['draftAssessments'] = [];
  private readonly generationContexts: AgentRunResult['generationContexts'] =
    [];
  private finalGenerationContext: RetrievedChunk[] = [];
  private totalIterations = 0;
  private completed = false;
  private error?: AgentRunResult['error'];

  constructor(
    private readonly queryId: string,
    startedAt = Date.now(),
  ) {
    this.startedAt = startedAt;
  }

  consume(event: AgentExecutionEvent, observedAt = Date.now()): void {
    // TTFE 是对 SSE 客户端可见的首个事件；内部评估事件不应影响该指标。
    if (!isInternalAgentEvent(event)) this.firstEventAt ??= observedAt;

    switch (event.type) {
      case AgentInternalEventType.GENERATION_CONTEXT:
        this.generationContexts.push({
          iteration: event.iteration,
          // 创建快照，避免后续多轮流程意外修改已记录的评估输入。
          chunks: this.snapshotChunks(event.chunks),
        });
        break;
      case AgentInternalEventType.FINAL_GENERATION_CONTEXT:
        this.finalGenerationContext = this.snapshotChunks(event.chunks);
        break;
      case AguiEventType.ANALYSIS:
        this.route = event.needsRetrieval ? 'rag' : 'direct';
        this.analyses.push({
          rewritten: event.rewritten,
          intent: event.intent,
          needsRetrieval: event.needsRetrieval,
          entityTerms: event.entityTerms,
        });
        break;
      case AguiEventType.RETRIEVAL_START:
        this.route = 'rag';
        this.retrievalQueries.push(event.query);
        break;
      case AguiEventType.RETRIEVAL_RESULT:
        this.citations = event.chunks.map((chunk, index) => ({
          index: index + 1,
          chunkId: chunk.chunkId,
          documentId: chunk.documentId,
          documentTitle: chunk.documentTitle,
          chunkContent: chunk.content,
          heading: null,
          similarity: chunk.similarity,
        }));
        break;
      case AguiEventType.DRAFT_ASSESSMENT:
        this.draftAssessments.push({
          answerRelevance: event.answerRelevance,
          answerCompleteness: event.answerCompleteness,
          shouldRetrieveMore: event.shouldRetrieveMore,
        });
        break;
      case AguiEventType.TEXT:
        this.firstTextAt ??= observedAt;
        this.answer += event.content;
        break;
      case AguiEventType.DONE:
        this.completed = true;
        this.totalIterations = event.totalIterations;
        break;
      case AguiEventType.ERROR:
        this.error = { message: event.message, code: event.code };
        break;
    }
  }

  finish(finishedAt = Date.now()): AgentRunResult {
    return {
      queryId: this.queryId,
      route: this.route,
      answer: this.answer,
      citations: this.citations,
      analyses: this.analyses,
      retrievalQueries: this.retrievalQueries,
      draftAssessments: this.draftAssessments,
      generationContexts: this.generationContexts,
      finalGenerationContext: this.finalGenerationContext,
      totalIterations: this.totalIterations,
      completed: this.completed,
      ...(this.error ? { error: this.error } : {}),
      timings: {
        totalMs: finishedAt - this.startedAt,
        ...(this.firstEventAt !== undefined
          ? { timeToFirstEventMs: this.firstEventAt - this.startedAt }
          : {}),
        ...(this.firstTextAt !== undefined
          ? { timeToFirstTextMs: this.firstTextAt - this.startedAt }
          : {}),
      },
    };
  }

  private snapshotChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
    return chunks.map((chunk) => ({
      ...chunk,
      metadata: { ...chunk.metadata },
    }));
  }
}
