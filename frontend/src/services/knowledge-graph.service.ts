import { apiClient } from '@/lib/api-client';
import { KnowledgeGraph, KnowledgeGraphSearchResult } from '@/types/api.types';

export const knowledgeGraphService = {
  get: (limit = 60, keyword?: string) => apiClient.get<KnowledgeGraph>('/knowledge-graph', {
    limit: String(limit),
    ...(keyword ? { keyword } : {}),
  }),
  getForDocument: (documentId: string, limit = 60, keyword?: string) => apiClient.get<KnowledgeGraph>(
    `/knowledge-graph/documents/${encodeURIComponent(documentId)}`,
    { limit: String(limit), ...(keyword ? { keyword } : {}) },
  ),
  search: (keyword: string, limit = 20) => apiClient.get<KnowledgeGraphSearchResult[]>(
    '/knowledge-graph/search',
    { keyword, limit: String(limit) },
  ),
};
