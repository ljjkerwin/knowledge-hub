/**
 * API 响应通用类型
 */
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export interface AboutInfo {
  title: string;
  description: string;
  highlights: string[];
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

export interface KnowledgeGraphNode {
  id: string;
  name: string;
  type: string;
  description: string;
  aliases: string[];
  mentions: number;
  documents: Array<{ id: string; title: string }>;
}

export interface KnowledgeGraphEdge {
  source: string;
  target: string;
  relation: string;
  weight: number;
}

export interface KnowledgeGraph {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
}

/** 知识图谱搜索接口对不同节点属性做过统一映射后的结果。 */
export interface KnowledgeGraphSearchResult {
  label: 'KnowledgeDocument' | 'DocumentChunk' | 'KnowledgeEntity';
  id: string;
  name: string;
  type: string | null;
  title: string | null;
  description: string | null;
  heading: string | null;
  documentId: string | null;
  summary: string | null;
  snippet: string | null;
}

export type DocumentStatus = 0 | 1 | 2 | 3;

export interface KnowledgeDocument {
  id: string;
  title: string;
  originalFileName?: string | null;
  fileSize?: string | null;
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

export interface FullTextSearchResult {
  id: string;
  title: string;
  summary?: string | null;
  content?: string | null;
  tags?: string | null;
  publishTime?: string | null;
  score?: number | null;
  highlights: Record<string, string[]>;
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
 * 引用来源
 */
export interface Citation {
  index: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  originalFileName?: string | null;
  fileSize?: string | null;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
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
  role: "user" | "assistant" | "system";
  content: string;
  citations?: Citation[];
  queryId?: string;
  createdAt: string;
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
  roles: string[];
  permissions: string[];
}

export type PermissionType = 1 | 2 | 3;

export interface Permission {
  id: string;
  parentId: string;
  permissionName: string;
  permissionCode: string;
  permissionType: PermissionType;
  menuUrl?: string | null;
  apiUrl?: string | null;
  method?: string | null;
  icon?: string | null;
  sort: number;
  status: number;
}

export interface RoleWithPermissions {
  id: string;
  roleName: string;
  roleCode: string;
  description?: string | null;
  status: number;
  permissionIds: string[];
}

export interface ManagedUser {
  id: string;
  username: string;
  email: string;
  nickname?: string | null;
  phone?: string | null;
  status: 0 | 1;
  lastLoginAt?: string | null;
  createdAt: string;
  roleIds: string[];
  roleNames: string[];
  roleCodes: string[];
}

export interface TeamUser {
  id: string;
  username: string;
  nickname?: string | null;
  email: string;
}

export interface TeamMember {
  id: string;
  userId: string;
  username: string;
  nickname?: string | null;
  memberRole: "leader" | "member";
}

export interface TeamNode {
  id: string;
  teamName: string;
  teamCode?: string | null;
  description?: string | null;
  leaderId?: string | null;
  leaderName?: string | null;
  parentId: string;
  sort: number;
  status: number;
  members: TeamMember[];
  children: TeamNode[];
}

/**
 * 登录请求
 */
export interface LoginRequest {
  username: string;
  password: string;
  rememberMe?: boolean;
}

/**
 * 登录响应
 */
export interface LoginResponse {
  user: User;
  accessToken: string;
  rememberMe: boolean;
}
