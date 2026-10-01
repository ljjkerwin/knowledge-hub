// RAG 检索结果
export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  originalFileName?: string | null;
  fileSize?: string | null;
  content: string;
  heading: string | null;
  chunkIndex: number;
  totalChunks: number;
  similarity: number;
  sourceType?: 'knowledge_base' | 'web';
  sourceUrl?: string;
  metadata: {
    categoryId?: string;
    authorId?: string;
    teamId?: string;
    publishTime?: string;
    siteName?: string;
  };
}

// 引用信息
export interface Citation {
  index: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  originalFileName?: string | null;
  fileSize?: string | null;
  chunkContent: string;
  heading: string | null;
  similarity: number;
  sourceType?: 'knowledge_base' | 'web';
  sourceUrl?: string;
}

// 生成的答案
export interface GeneratedAnswer {
  answer: string;
  citations: Citation[];
}

// 检索选项
export interface SearchOptions {
  topK?: number;
  categoryId?: string;
  teamId?: string;
  authorId?: string;
  similarityThreshold?: number;
  keywordScoreThreshold?: number;
}
