import { create } from "zustand";
import { documentService } from "@/services/document.service";
import { KnowledgeDocument, PaginatedResponse } from "@/types/api.types";

export interface DocumentListQuery {
  title: string;
  status: string;
  page: number;
  pageSize: number;
}

type DocumentListCache = Record<string, PaginatedResponse<KnowledgeDocument>>;

interface DocumentState {
  query: DocumentListQuery;
  items: KnowledgeDocument[];
  total: number;
  loading: boolean;
  error: string;
  cache: DocumentListCache;
  setQuery: (query: Partial<DocumentListQuery>) => void;
  setError: (error: string) => void;
  load: (force?: boolean) => Promise<void>;
  invalidate: () => void;
}

const cacheKey = ({ title, status, page, pageSize }: DocumentListQuery) =>
  JSON.stringify({ title, status, page, pageSize });

// 合并开发模式重复执行 effect 等情况下的相同列表请求。
const pendingRequests = new Map<
  string,
  Promise<PaginatedResponse<KnowledgeDocument>>
>();

export const useDocumentStore = create<DocumentState>((set, get) => ({
  query: { title: "", status: "", page: 1, pageSize: 10 },
  items: [],
  total: 0,
  loading: true,
  error: "",
  cache: {},

  setQuery: (query) => set((state) => ({ query: { ...state.query, ...query } })),
  setError: (error) => set({ error }),

  load: async (force = false) => {
    const query = get().query;
    const key = cacheKey(query);
    const cached = get().cache[key];

    if (cached && !force) {
      set({ items: cached.items, total: cached.total, loading: false, error: "" });
      return;
    }

    set({ loading: true, error: "" });
    let request = pendingRequests.get(key);
    if (!request) {
      request = documentService.list(query);
      pendingRequests.set(key, request);
    }

    try {
      const result = await request;
      set((state) => {
        const nextCache = { ...state.cache, [key]: result };
        // 查询条件已改变时，仅写入缓存，不覆盖用户正在查看的列表。
        if (cacheKey(state.query) !== key) return { cache: nextCache };
        return {
          cache: nextCache,
          items: result.items,
          total: result.total,
          loading: false,
          error: "",
        };
      });
    } catch (error) {
      if (cacheKey(get().query) === key) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : "无法加载文档",
        });
      }
    } finally {
      pendingRequests.delete(key);
    }
  },

  invalidate: () => set({ cache: {} }),
}));
