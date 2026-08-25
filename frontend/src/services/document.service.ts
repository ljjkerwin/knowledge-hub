import { apiClient } from '@/lib/api-client';
import {
  DocumentPayload,
  KnowledgeDocument,
  PaginatedResponse,
  ReviewTask,
} from '@/types/api.types';

export interface DocumentQuery {
  title?: string;
  status?: string;
  categoryId?: string;
  page?: number;
  pageSize?: number;
}

const queryParams = (params: DocumentQuery) =>
  Object.fromEntries(
    Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([key, value]) => [key, String(value)]),
  );

export const documentService = {
  list: (params: DocumentQuery = {}) =>
    apiClient.get<PaginatedResponse<KnowledgeDocument>>('/documents', queryParams(params)),
  get: (id: string) => apiClient.get<KnowledgeDocument>(`/documents/${id}`),
  create: (data: DocumentPayload) => apiClient.post<KnowledgeDocument>('/documents', data),
  update: (id: string, data: DocumentPayload) => apiClient.patch<KnowledgeDocument>(`/documents/${id}`, data),
  remove: (id: string) => apiClient.delete<{ id: string; deleted: boolean }>(`/documents/${id}`),
  publish: (id: string) => apiClient.put<KnowledgeDocument>(`/documents/${id}/publish`),
  archive: (id: string) => apiClient.put<KnowledgeDocument>(`/documents/${id}/archive`),
  saveDraft: (id: string) => apiClient.put<KnowledgeDocument>(`/documents/${id}/save-draft`),
  submitReview: (id: string) => apiClient.post<KnowledgeDocument>(`/documents/${id}/reviews/submit`),
  reviewHistory: (id: string) => apiClient.get<ReviewTask[]>(`/documents/${id}/reviews/history`),
  currentReview: (id: string) => apiClient.get<ReviewTask | null>(`/documents/${id}/reviews/current`),
  tasks: (status = 'pending', page = 1, pageSize = 20) =>
    apiClient.get<PaginatedResponse<ReviewTask>>('/documents/reviews/tasks', {
      status,
      page: String(page),
      pageSize: String(pageSize),
    }),
  pendingCount: () => apiClient.get<number>('/documents/reviews/tasks/pending-count'),
  approve: (taskId: string, reviewComment?: string) =>
    apiClient.post<KnowledgeDocument>(`/documents/reviews/tasks/${taskId}/approve`, { reviewComment }),
  reject: (taskId: string, reviewComment: string) =>
    apiClient.post<KnowledgeDocument>(`/documents/reviews/tasks/${taskId}/reject`, { reviewComment }),
  async upload(file: File, metadata: Record<string, string> = {}) {
    const formData = new FormData();
    formData.append('file', file);
    Object.entries(metadata).forEach(([key, value]) => value && formData.append(key, value));
    const token = typeof window === 'undefined' ? null : localStorage.getItem('kh_token');
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5002'}/documents/upload/parse`, {
      method: 'POST', body: formData, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || '文件上传失败');
    return response.json() as Promise<{ documentId: string }>;
  },
};
