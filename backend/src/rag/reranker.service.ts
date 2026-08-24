import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RetrievedChunk } from './types/rag.types';

interface RerankApiResponse {
  results?: Array<{
    index: number;
    relevance_score: number;
  }>;
}

/**
 * 调用 OpenAI-compatible rerank API 对 WRRF 融合候选做精排。
 *
 * 与聊天模型不同，rerank 模型使用 POST /rerank，而不是 /chat/completions。
 */
@Injectable()
export class RerankerService {
  private readonly logger = new Logger(RerankerService.name);
  private readonly enabled: boolean;
  private readonly apiKey?: string;
  private readonly baseURL?: string;
  private readonly model?: string;
  private readonly maxCandidates: number;
  private readonly minScore: number;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('RERANKER_API_KEY');
    this.baseURL = this.config.get<string>('RERANKER_BASE_URL');
    this.model = this.config.get<string>('RERANKER_MODEL');
    this.enabled =
      this.config.get<string>('RAG_RERANK_ENABLED', 'true').toLowerCase() !==
        'false' && Boolean(this.apiKey && this.baseURL && this.model);
    this.maxCandidates = Math.max(
      1,
      Number(this.config.get('RAG_RERANK_CANDIDATE_TOP_K', 30)),
    );
    this.minScore = Math.min(
      1,
      Math.max(0, Number(this.config.get('RAG_RERANK_MIN_SCORE', 0.5))),
    );

    if (!this.enabled) {
      this.logger.warn(
        'Rerank 已跳过：请配置 RERANKER_API_KEY、RERANKER_BASE_URL 和 RERANKER_MODEL',
      );
    }
  }

  getCandidateLimit(finalTopK: number): number {
    return Math.max(1, finalTopK, this.maxCandidates);
  }

  async rerank(
    query: string,
    candidates: RetrievedChunk[],
    finalTopK: number,
  ): Promise<RetrievedChunk[]> {
    const limited = candidates.slice(0, this.getCandidateLimit(finalTopK));
    const limit = Math.max(1, finalTopK);
    if (!this.enabled || !limited.length) return limited.slice(0, limit);

    try {
      const response = await fetch(this.getEndpoint(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          query,
          documents: limited.map((chunk) => this.toDocument(chunk)),
          // 请求全部评分，应用本地阈值后再截取最终 topK。
          top_n: limited.length,
          return_documents: false,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        throw new Error(`${response.status} ${await response.text()}`);
      }

      const payload = (await response.json()) as RerankApiResponse;
      const scores = new Map<number, number>();
      for (const item of payload.results ?? []) {
        if (
          Number.isInteger(item.index) &&
          item.index >= 0 &&
          item.index < limited.length &&
          Number.isFinite(item.relevance_score) &&
          !scores.has(item.index)
        ) {
          scores.set(item.index, item.relevance_score);
        }
      }
      if (!scores.size) throw new Error('reranker returned no valid scores');

      const reranked = limited
        .map((chunk, index) => ({ chunk, index, score: scores.get(index) }))
        .filter(({ score }) => score !== undefined && score >= this.minScore)
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.index - b.index)
        .slice(0, limit)
        .map(({ chunk, score }) => ({
          ...chunk,
          similarity: score ?? chunk.similarity,
        }));

      this.logger.verbose(
        `Rerank 完成：候选=${limited.length}，有效评分=${scores.size}，阈值=${this.minScore}，保留=${reranked.length}`,
      );
      return reranked;
    } catch (error) {
      this.logger.warn(`Rerank 失败，回退 WRRF 顺序：${error.message}`);
      return limited.slice(0, limit);
    }
  }

  private getEndpoint(): string {
    return `${this.baseURL!.replace(/\/$/, '')}/rerank`;
  }

  private toDocument(chunk: RetrievedChunk): string {
    return [chunk.documentTitle, chunk.heading, chunk.content]
      .filter(Boolean)
      .join('\n')
      .slice(0, 2_000);
  }
}
