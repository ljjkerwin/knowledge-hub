// AGUI (Agent User Interface) 规范类型定义

// AGUI 事件类型
export enum AguiEventType {
  // 消息相关
  TEXT = 'text', // 文本内容
  THINKING = 'thinking', // 思考过程

  // 工具相关
  TOOL_CALL = 'tool_call', // 工具调用
  TOOL_RESULT = 'tool_result', // 工具结果

  // 检索相关
  RETRIEVAL_START = 'retrieval_start', // 开始检索
  RETRIEVAL_RESULT = 'retrieval_result', // 检索结果

  // 评估相关
  EVALUATION = 'evaluation', // 评估结果

  // 状态相关
  ERROR = 'error', // 错误
  DONE = 'done', // 完成
  METADATA = 'metadata', // 元数据
}

// AGUI 基础事件
export interface AguiEvent {
  type: AguiEventType;
  timestamp: number;
}

// 文本事件
export interface AguiTextEvent extends AguiEvent {
  type: AguiEventType.TEXT;
  content: string;
}

// 思考事件
export interface AguiThinkingEvent extends AguiEvent {
  type: AguiEventType.THINKING;
  content: string;
}

// 工具调用事件
export interface AguiToolCallEvent extends AguiEvent {
  type: AguiEventType.TOOL_CALL;
  toolName: string;
  args: Record<string, any>;
}

// 工具结果事件
export interface AguiToolResultEvent extends AguiEvent {
  type: AguiEventType.TOOL_RESULT;
  toolName: string;
  result: any;
}

// 检索开始事件
export interface AguiRetrievalStartEvent extends AguiEvent {
  type: AguiEventType.RETRIEVAL_START;
  query: string;
  searchType: string;
}

// 检索结果事件
export interface AguiRetrievalResultEvent extends AguiEvent {
  type: AguiEventType.RETRIEVAL_RESULT;
  chunks: Array<{
    chunkId: string;
    documentId: string;
    documentTitle: string;
    content: string;
    similarity: number;
  }>;
}

// 评估事件
export interface AguiEvaluationEvent extends AguiEvent {
  type: AguiEventType.EVALUATION;
  relevance: number;
  completeness: number;
  needsFollowUp: boolean;
  followUpQuestion?: string;
}

// 错误事件
export interface AguiErrorEvent extends AguiEvent {
  type: AguiEventType.ERROR;
  message: string;
  code?: string;
}

// 完成事件
export interface AguiDoneEvent extends AguiEvent {
  type: AguiEventType.DONE;
  queryId: string;
  totalIterations: number;
}

// 元数据事件
export interface AguiMetadataEvent extends AguiEvent {
  type: AguiEventType.METADATA;
  data: Record<string, any>;
}

// AGUI 事件联合类型
export type AguiEventUnion =
  | AguiTextEvent
  | AguiThinkingEvent
  | AguiToolCallEvent
  | AguiToolResultEvent
  | AguiRetrievalStartEvent
  | AguiRetrievalResultEvent
  | AguiEvaluationEvent
  | AguiErrorEvent
  | AguiDoneEvent
  | AguiMetadataEvent;

// AGUI 流式响应选项
export interface AguiStreamOptions {
  maxIterations?: number;
  enableFollowUp?: boolean;
  userId?: string;
  categoryId?: string;
  teamId?: string;
}
