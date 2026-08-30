/**
 * AGUI 事件类型
 */
export enum AguiEventType {
  TEXT = "text",
  THINKING = "thinking",
  ANALYSIS = "analysis",
  TOOL_CALL = "tool_call",
  TOOL_RESULT = "tool_result",
  RETRIEVAL_START = "retrieval_start",
  RETRIEVAL_RESULT = "retrieval_result",
  DRAFT_ASSESSMENT = "draft_assessment",
  ERROR = "error",
  DONE = "done",
  METADATA = "metadata",
}

/**
 * AGUI 基础事件
 */
export interface AguiBaseEvent {
  type: AguiEventType;
  timestamp: number;
}

/**
 * 文本事件
 */
export interface AguiTextEvent extends AguiBaseEvent {
  type: AguiEventType.TEXT;
  content: string;
  done?: boolean;
}

/**
 * 思考事件
 */
export interface AguiThinkingEvent extends AguiBaseEvent {
  type: AguiEventType.THINKING;
  content: string;
}

/** 问题分析事件；可用于调试面板，当前聊天视图不展示。 */
export interface AguiAnalysisEvent extends AguiBaseEvent {
  type: AguiEventType.ANALYSIS;
  rewritten: string;
  intent: string;
  needsRetrieval: boolean;
  entityTerms: string[];
}

/**
 * 工具调用事件
 */
export interface AguiToolCallEvent extends AguiBaseEvent {
  type: AguiEventType.TOOL_CALL;
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * 工具结果事件
 */
export interface AguiToolResultEvent extends AguiBaseEvent {
  type: AguiEventType.TOOL_RESULT;
  toolName: string;
  result: unknown;
}

/**
 * 检索开始事件
 */
export interface AguiRetrievalStartEvent extends AguiBaseEvent {
  type: AguiEventType.RETRIEVAL_START;
  query: string;
  searchType: string;
}

/**
 * 检索结果事件
 */
export interface AguiRetrievalResultEvent extends AguiBaseEvent {
  type: AguiEventType.RETRIEVAL_RESULT;
  chunks: Array<{
    chunkId: string;
    documentId: string;
    documentTitle: string;
    content: string;
    similarity: number;
  }>;
}

/**
 * 草稿运行时评审事件；用于 Agent 内部决定是否继续检索，不代表最终质量。
 */
export interface AguiDraftAssessmentEvent extends AguiBaseEvent {
  type: AguiEventType.DRAFT_ASSESSMENT;
  answerRelevance: number;
  answerCompleteness: number;
  shouldRetrieveMore: boolean;
  followUpQuestion?: string;
  missingAspects?: string[];
  followUpQueries?: string[];
}

/**
 * 错误事件
 */
export interface AguiErrorEvent extends AguiBaseEvent {
  type: AguiEventType.ERROR;
  message: string;
  code?: string;
}

/**
 * 完成事件
 */
export interface AguiDoneEvent extends AguiBaseEvent {
  type: AguiEventType.DONE;
  queryId: string;
  totalIterations: number;
}

/**
 * 元数据事件
 */
export interface AguiMetadataEvent extends AguiBaseEvent {
  type: AguiEventType.METADATA;
  data: {
    conversationId: string;
    queryId: string;
    maxIterations: number;
  };
}

/**
 * AGUI 事件联合类型
 */
export type AguiEvent =
  | AguiTextEvent
  | AguiThinkingEvent
  | AguiAnalysisEvent
  | AguiToolCallEvent
  | AguiToolResultEvent
  | AguiRetrievalStartEvent
  | AguiRetrievalResultEvent
  | AguiDraftAssessmentEvent
  | AguiErrorEvent
  | AguiDoneEvent
  | AguiMetadataEvent;
