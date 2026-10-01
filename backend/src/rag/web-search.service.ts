import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RetrievedChunk } from './types/rag.types';

interface BochaWebPage {
  name?: unknown;
  url?: unknown;
  snippet?: unknown;
  summary?: unknown;
  siteName?: unknown;
  datePublished?: unknown;
}

interface BochaWebSearchResponse {
  code?: unknown;
  msg?: unknown;
  log_id?: unknown;
  data?: {
    webPages?: {
      value?: BochaWebPage[];
    };
  };
}

/** 博查 Web Search API 适配层，将网页结果转换成 Agent 可统一评审的证据片段。 */
@Injectable()
export class WebSearchService {
  private readonly logger = new Logger(WebSearchService.name);
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly resultCount: number;
  private readonly maxResultChars: number;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('BOCHA_API_KEY')?.trim() || undefined;
    this.baseUrl = (
      config.get<string>('BOCHA_BASE_URL', 'https://api.bocha.cn') ??
      'https://api.bocha.cn'
    ).replace(/\/$/, '');
    this.resultCount = this.clampedInteger(
      config.get('BOCHA_SEARCH_COUNT', 5),
      5,
      1,
      10,
    );
    this.maxResultChars = this.clampedInteger(
      config.get('BOCHA_MAX_RESULT_CHARS', 4000),
      4000,
      500,
      10000,
    );
    this.timeoutMs = this.clampedInteger(
      config.get('BOCHA_TIMEOUT_MS', 8000),
      8000,
      1000,
      30000,
    );
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * 搜索失败时降级为空结果，由证据评审按 empty 路径结束，不让外部服务故障
   * 中断已经可以基于内部知识作答的主链路。
   */
  async search(query: string): Promise<RetrievedChunk[]> {
    if (!this.apiKey || !query.trim()) return [];

    try {
      const response = await fetch(`${this.baseUrl}/v1/web-search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: query.trim(),
          freshness: 'noLimit',
          summary: true,
          count: this.resultCount,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`Bocha HTTP ${response.status}`);
      }

      const payload = (await response.json()) as BochaWebSearchResponse;
      if (payload.code !== undefined && payload.code !== 200) {
        throw new Error(
          `Bocha API ${this.errorValue(payload.code)}: ${this.errorValue(payload.msg)}`,
        );
      }

      const seenUrls = new Set<string>();
      const chunks: RetrievedChunk[] = [];
      for (const page of payload.data?.webPages?.value ?? []) {
        const url = this.webUrl(page.url);
        const title = this.stringValue(page.name);
        const rawContent =
          this.stringValue(page.summary) || this.stringValue(page.snippet);
        if (!url || !title || !rawContent || seenUrls.has(url)) continue;
        seenUrls.add(url);
        const content = rawContent.slice(0, this.maxResultChars);

        const id = createHash('sha256').update(url).digest('hex').slice(0, 24);
        const index = chunks.length;
        chunks.push({
          chunkId: `web-${id}`,
          documentId: `web-${id}`,
          documentTitle: title,
          originalFileName: null,
          fileSize: null,
          content,
          heading: null,
          chunkIndex: index,
          totalChunks: 1,
          // 博查未返回跨源可比的相关性分数，这里只保留结果顺序供稳定排序。
          similarity: Math.max(0.1, 1 - index * 0.1),
          sourceType: 'web',
          sourceUrl: url,
          metadata: {
            siteName: this.stringValue(page.siteName) || undefined,
            publishTime: this.stringValue(page.datePublished) || undefined,
          },
        });
      }

      this.logger.log(`博查网页搜索完成，返回 ${chunks.length} 个结果`);
      return chunks;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`博查网页搜索失败，已降级为空结果: ${message}`);
      return [];
    }
  }

  private stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private errorValue(value: unknown): string {
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value);
    }
    return 'unknown error';
  }

  private webUrl(value: unknown): string {
    const raw = this.stringValue(value);
    if (!raw) return '';
    try {
      const url = new URL(raw);
      return url.protocol === 'http:' || url.protocol === 'https:' ? raw : '';
    } catch {
      return '';
    }
  }

  private clampedInteger(
    value: unknown,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? Math.min(maximum, Math.max(minimum, Math.floor(parsed)))
      : fallback;
  }
}
