/** RAG 重建 / 删除索引消息 */
export type ReindexType = 'BY_DOC_IDS' | 'DELETE_BY_DOC_IDS';

export interface ReindexMessage {
  taskId: string;
  type: ReindexType;
  documentIds?: string[];
}

/** ES 搜索索引消息（消费者按 documentId 加载完整正文后落库） */
export type SearchIndexType = 'INDEX' | 'DELETE';

export interface SearchIndexMessage {
  taskId: string;
  type: SearchIndexType;
  documentId: string;
}

/** KG 建图 / 删图消息 */
export type KgBuildType =
  'BUILD_ALL' | 'BUILD_BY_DOC_IDS' | 'DELETE_BY_DOC_IDS';

export interface KgBuildMessage {
  taskId: string;
  type: KgBuildType;
  documentIds?: string[];
}

/** 发布/下架触发一次统一解析、按需 OCR 与共享分块。 */
export interface DocumentIngestMessage {
  taskId: string;
  type: 'UPSERT' | 'DELETE';
  documentId: string;
}
