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
  chunkId: string;
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
  /** 检索片段相似度的聚合值，不代表答案本身的置信度。 */
  retrievalConfidence: number;
}

// 检索选项
export interface SearchOptions {
  topK?: number;
  categoryId?: string;
  teamId?: string;
  authorId?: string;
  userId?: string;
  similarityThreshold?: number;
  keywordScoreThreshold?: number;
}
