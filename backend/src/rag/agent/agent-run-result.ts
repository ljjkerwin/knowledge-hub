import type { ConversationContext } from '../context-manager.service';
import {
  AguiEventType,
  AguiEventUnion,
  AguiStreamOptions,
} from '../types/agui.types';
import type { Citation } from '../types/rag.types';

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
  private totalIterations = 0;
  private completed = false;
  private error?: AgentRunResult['error'];

  constructor(
    private readonly queryId: string,
    startedAt = Date.now(),
  ) {
    this.startedAt = startedAt;
  }

  consume(event: AguiEventUnion, observedAt = Date.now()): void {
    this.firstEventAt ??= observedAt;

    switch (event.type) {
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
}
