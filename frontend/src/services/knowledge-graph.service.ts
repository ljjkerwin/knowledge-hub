import { apiClient } from '@/lib/api-client';
import { KnowledgeGraph } from '@/types/api.types';

export const knowledgeGraphService = {
  get: (limit = 60) => apiClient.get<KnowledgeGraph>('/knowledge-graph', {
    limit: String(limit),
  }),
  getForDocument: (documentId: string, limit = 60) => apiClient.get<KnowledgeGraph>(
    `/knowledge-graph/documents/${encodeURIComponent(documentId)}`,
    { limit: String(limit) },
  ),
};
