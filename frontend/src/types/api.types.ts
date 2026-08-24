/**
 * API 响应通用类型
 */
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

/**
 * 分页响应
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type DocumentStatus = 0 | 1 | 2 | 3;

export interface KnowledgeDocument {
  id: string;
  title: string;
  contentId?: string;
  content?: string;
  summary?: string;
  categoryId?: string | null;
  teamId?: string | null;
  authorId?: string | null;
  coverImage?: string | null;
  tags?: string | null;
  status: DocumentStatus;
  remark?: string | null;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  favouriteCount: number;
  wordCount: number;
  publishTime?: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  createBy?: string | null;
  updateBy?: string | null;
  deleted: boolean;
}

export interface DocumentPayload {
  title?: string;
  content?: string;
  summary?: string;
  categoryId?: string;
  teamId?: string;
  authorId?: string;
  coverImage?: string;
  tags?: string;
  remark?: string;
  isPublic?: boolean;
  createBy?: string;
  updateBy?: string;
  status?: 0 | 1;
}

export interface ReviewTask {
  id: string;
  documentId: string;
  reviewerId?: string | null;
  reviewerName?: string | null;
  reviewResult: 1 | 2 | null;
  reviewComment?: string | null;
  beforeStatus: DocumentStatus;
  reviewedAt?: string | null;
  createdAt: string;
}

/**
 * RAG 查询请求
 */
export interface RagQueryRequest {
  query: string;
  searchType?: 'vector' | 'keyword' | 'hybrid';
  topK?: number;
  filters?: Record<string, unknown>;
}

/**
 * Agent 查询请求
 */
export interface AgentQueryRequest {
  query: string;
  conversationId?: string;
  maxIterations?: number;
  streamResponse?: boolean;
}

/**
 * 引用来源
 */
export interface Citation {
  index: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/**
 * RAG 查询响应
 */
export interface RagQueryResponse {
  queryId: string;
  answer: string;
  citations: Citation[];
  confidence: number;
  processingTime: number;
}

/**
 * 推理步骤
 */
export interface ReasoningStep {
  step: number;
  type: 'analyze' | 'retrieve' | 'evaluate' | 'refine';
  description: string;
  result?: string;
  timestamp: number;
}

/**
 * Agent 查询响应
 */
export interface AgentQueryResponse {
  queryId: string;
  answer: string;
  citations: Citation[];
  confidence: number;
  reasoning: ReasoningStep[];
  iterations: number;
  processingTime: number;
}

/**
 * 对话
 */
export interface Conversation {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 消息
 */
export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations?: Citation[];
  queryId?: string;
  confidence?: number;
  createdAt: string;
}

/**
 * 聊天请求
 */
export interface ChatRequest {
  message: string;
  conversationId?: string;
  maxIterations?: number;
  streamResponse?: boolean;
}

/**
 * 用户
 */
export interface User {
  id: string;
  username: string;
  email: string;
  nickname?: string;
  avatar?: string;
  role: number;
}

/**
 * 登录请求
 */
export interface LoginRequest {
  username: string;
  password: string;
}

/**
 * 登录响应
 */
export interface LoginResponse {
  user: User;
  token: string;
}
