import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface Mem0SearchResponse {
  results?: Array<{ memory?: unknown }>;
}

interface MemoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Mem0 托管长期记忆的适配层。
 *
 * 该服务故意不使用 conversationId 作为检索范围：长期记忆应属于用户而非单次
 * 会话。conversationId 仅随写入作为元数据，便于在 Mem0 控制台排查来源。
 */
@Injectable()
export class LongTermMemoryService {
  private readonly logger = new Logger(LongTermMemoryService.name);
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly recallLimit: number;
  private readonly maxContextChars: number;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('MEM0_API_KEY')?.trim() || undefined;
    this.baseUrl = (
      this.config.get<string>('MEM0_BASE_URL', 'https://api.mem0.ai') ??
      'https://api.mem0.ai'
    ).replace(/\/$/, '');
    this.recallLimit = this.positiveInteger('MEM0_RECALL_LIMIT', 5);
    this.maxContextChars = this.positiveInteger('MEM0_MAX_CONTEXT_CHARS', 2000);
    this.timeoutMs = this.positiveInteger('MEM0_TIMEOUT_MS', 5000);
  }

  /** 为当前问题召回与用户有关的跨会话记忆。 */
  async recall(userId: string, query: string): Promise<string[]> {
    if (!this.apiKey || !query.trim()) return [];

    try {
      const response = await this.request<Mem0SearchResponse>(
        'memories/search/',
        {
          query,
          filters: { user_id: userId },
          top_k: this.recallLimit,
        },
      );
      const memories: string[] = [];
      let chars = 0;
      for (const item of response.results ?? []) {
        if (typeof item.memory !== 'string') continue;
        const memory = item.memory.trim();
        if (!memory || memories.includes(memory)) continue;
        if (chars + memory.length > this.maxContextChars) break;
        memories.push(memory);
        chars += memory.length;
      }
      return memories;
    } catch (error) {
      this.logFailure('召回', error);
      return [];
    }
  }

  /**
   * 将一轮已成功完成的问答交给 Mem0 提炼。Mem0 的 add API 会异步抽取事实、
   * 偏好和约束，而不是直接把整段对话作为 prompt 原文保存。
   */
  async remember(
    userId: string,
    conversationId: string,
    messages: MemoryMessage[],
  ): Promise<void> {
    if (!this.apiKey || !messages.length) return;

    try {
      await this.request('memories/add/', {
        messages,
        user_id: userId,
        metadata: {
          source: 'knowledge-hub-chat',
          conversation_id: conversationId,
        },
      });
    } catch (error) {
      this.logFailure('写入', error);
    }
  }

  private async request<T = unknown>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}/v3/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Mem0 HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }

  private positiveInteger(key: string, fallback: number): number {
    const value = Number(this.config.get(key, fallback));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }

  private logFailure(operation: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `Mem0 长期记忆${operation}失败，已降级继续对话: ${message}`,
    );
  }
}
