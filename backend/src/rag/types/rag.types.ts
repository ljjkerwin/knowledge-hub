// RAG 检索结果
export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  heading: string | null;
  chunkIndex: number;
  totalChunks: number;
  similarity: number;
  metadata: {
    categoryId?: string;
    authorId?: string;
    teamId?: string;
    publishTime?: string;
  };
}

// 引用信息
export interface Citation {
  index: number;
  documentId: string;
  documentTitle: string;
  chunkContent: string;
  heading: string | null;
  similarity: number;
}

// 生成的答案
export interface GeneratedAnswer {
  answer: string;
  citations: Citation[];
  confidence: number;
}

// 检索选项
export interface SearchOptions {
  topK?: number;
  searchType?: 'vector' | 'keyword' | 'hybrid';
  categoryId?: string;
  teamId?: string;
  authorId?: string;
  userId?: string;
  similarityThreshold?: number;
  hybridAlpha?: number;
}

// RAG 查询响应
export interface RagQueryResponse {
  answer: string;
  citations: Citation[];
  confidence: number;
  queryId: string;
  retrievedChunks: RetrievedChunk[];
}
