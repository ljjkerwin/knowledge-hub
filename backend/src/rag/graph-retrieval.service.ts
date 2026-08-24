import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { Driver } from 'neo4j-driver';
import { RetrievedChunk, SearchOptions } from './types/rag.types';

/**
 * 以知识实体为入口定位文档块。图谱是补充召回源，不可用时不影响 ES 检索。
 */
@Injectable()
export class GraphRetrievalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GraphRetrievalService.name);
  private readonly enabled: boolean;
  private readonly topK: number;
  private driver: Driver | null = null;

  constructor(private readonly config: ConfigService) {
    this.enabled = this.config.get<string>('RAG_ENABLE_KG_RETRIEVAL', 'true') !== 'false';
    this.topK = Number(this.config.get('RAG_KG_TOP_K', 3));
  }

  async onModuleInit() {
    if (!this.enabled) return;

    this.driver = neo4j.driver(
      this.config.get('NEO4J_URI', 'bolt://localhost:7687'),
      neo4j.auth.basic(
        this.config.get('NEO4J_USER', 'neo4j'),
        this.config.get('NEO4J_PASSWORD', 'password'),
      ),
    );
    try {
      await this.driver.verifyConnectivity();
      this.logger.log('Neo4j 图谱检索已连接');
    } catch (error) {
      this.logger.warn(`Neo4j 图谱检索不可用，将跳过：${this.errorMessage(error)}`);
      await this.driver.close();
      this.driver = null;
    }
  }

  async onModuleDestroy() {
    await this.driver?.close();
  }

  async search(
    query: string,
    options?: SearchOptions,
    entityTerms: string[] = [],
  ): Promise<RetrievedChunk[]> {
    if (!this.driver || !query.trim()) return [];

    // LLM 实体词是主路径。仅在无法召回可用 chunk 时才执行 n-gram，避免泛化短词污染结果。
    const exactTerms = this.normalizeTerms(entityTerms);
    if (exactTerms.length) {
      const exactMatches = await this.searchByTerms(exactTerms, options);
      if (exactMatches.length) return exactMatches;
    }

    return this.searchByTerms(this.extractTerms(query), options);
  }

  /** 使用给定词集合查询图谱。 */
  private async searchByTerms(
    terms: string[],
    options?: SearchOptions,
  ): Promise<RetrievedChunk[]> {
    if (!this.driver || !terms.length) return [];
    const session = this.driver.session({ defaultAccessMode: neo4j.session.READ });
    try {
      const result = await session.run(
        `
        MATCH (seed:KnowledgeEntity)
        WHERE any(term IN $terms WHERE
          toLower(seed.name) CONTAINS term OR term CONTAINS toLower(seed.name)
          OR any(alias IN coalesce(seed.aliases, []) WHERE toLower(alias) CONTAINS term OR term CONTAINS toLower(alias))
        )
        OPTIONAL MATCH (seed)-[:RELATED_TO]-(related:KnowledgeEntity)
        WITH seed, collect(related) + [seed] AS entities
        UNWIND entities AS entity
        MATCH (d:KnowledgeDocument)-[:HAS_CHUNK]->(c:DocumentChunk)-[:MENTIONS]->(entity)
        WHERE d.status = 1
          AND ($categoryId IS NULL OR d.categoryId = $categoryId)
          AND ($teamId IS NULL OR d.teamId = $teamId)
        WITH d, c, count(DISTINCT entity) AS graphHits
        RETURN c.chunkId AS chunkId, c.documentId AS documentId,
          d.title AS documentTitle, c.content AS content, c.heading AS heading,
          c.chunkIndex AS chunkIndex, c.totalChunks AS totalChunks, graphHits
        ORDER BY graphHits DESC, c.chunkIndex ASC
        LIMIT $topK
        `,
        {
          terms,
          categoryId: options?.categoryId ?? null,
          teamId: options?.teamId ?? null,
          topK: neo4j.int(Math.min(options?.topK ?? this.topK, this.topK)),
        },
      );

      return result.records.map((record) => ({
        chunkId: record.get('chunkId'),
        documentId: record.get('documentId'),
        documentTitle: record.get('documentTitle'),
        content: record.get('content'),
        heading: record.get('heading') ?? null,
        chunkIndex: this.toNumber(record.get('chunkIndex')),
        totalChunks: this.toNumber(record.get('totalChunks')),
        // 图谱路的原始命中分；FusionService 会在融合后写入最终分数。
        similarity: this.toNumber(record.get('graphHits')),
        metadata: {
          categoryId: options?.categoryId,
          teamId: options?.teamId,
        },
      }));
    } catch (error) {
      this.logger.warn(`图谱检索失败，将忽略本路结果：${this.errorMessage(error)}`);
      return [];
    } finally {
      await session.close();
    }
  }

  /**
   * 生成可用于实体名/别名匹配的候选词。
   * 中文没有天然空格，不能把一整句当作一个 term；同时保留完整 query，
   * 并从连续中文片段生成 2~6 字 n-gram，以匹配实体的名称片段。
   */
  private extractTerms(query: string): string[] {
    const normalized = query.trim().normalize('NFKC').toLocaleLowerCase();
    const terms = new Set<string>([normalized]);

    for (const segment of normalized.match(/[\p{Script=Han}]+/gu) ?? []) {
      const chars = Array.from(segment);
      for (let size = Math.min(6, chars.length); size >= 2; size--) {
        for (let start = 0; start + size <= chars.length; start++) {
          terms.add(chars.slice(start, start + size).join(''));
        }
      }
    }

    for (const token of normalized.match(/[a-z0-9_.-]{2,}/gu) ?? []) {
      terms.add(token);
    }

    // 长词优先，减少短词先触发宽泛匹配的概率；上限保护 Cypher 参数规模。
    return Array.from(terms)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .slice(0, 64);
  }

  /** 规范化并去重 LLM 产出的精确实体词。 */
  private normalizeTerms(entityTerms: string[]): string[] {
    const terms = new Set<string>();
    for (const term of entityTerms) {
      const normalized = String(term ?? '')
        .trim()
        .normalize('NFKC')
        .toLocaleLowerCase();
      if (normalized) terms.add(normalized);
      if (terms.size >= 64) break;
    }
    return Array.from(terms);
  }

  private toNumber(value: unknown): number {
    return typeof value === 'object' && value && 'toNumber' in value
      ? (value as { toNumber(): number }).toNumber()
      : Number(value);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
