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
  ): Promise<RetrievedChunk[]> {
    if (!this.driver || !query.trim()) return [];

    const terms = this.extractTerms(query);
    if (!terms.length) return [];

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
          c.chunkIndex AS chunkIndex, c.totalChunks AS totalChunks
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

      return result.records.map((record, index) => ({
        chunkId: record.get('chunkId'),
        documentId: record.get('documentId'),
        documentTitle: record.get('documentTitle'),
        content: record.get('content'),
        heading: record.get('heading') ?? null,
        chunkIndex: this.toNumber(record.get('chunkIndex')),
        totalChunks: this.toNumber(record.get('totalChunks')),
        // 与混合检索 RRF 分数量级一致，便于在合并阶段按命中质量排序。
        similarity: 0.5 / (61 + index),
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

  private extractTerms(query: string): string[] {
    const normalized = query.trim().toLocaleLowerCase();
    return Array.from(
      new Set([
        normalized,
        ...(normalized.match(/[\p{Script=Han}]{2,}|[a-z0-9_.-]{2,}/gu) ?? []),
      ]),
    ).slice(0, 8);
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
