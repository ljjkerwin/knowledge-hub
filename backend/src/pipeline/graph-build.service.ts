import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { Driver, Session } from 'neo4j-driver';
import { ChunkingService } from './chunking.service';
import { ExtractionService } from './extraction.service';
import { DocumentChunk, PipelineDocument } from './types/pipeline.types';

/**
 * KG 知识图谱构建
 *
 * <p>图模型（简化）：</p>
 * <pre>
 * (KnowledgeDocument)-[:HAS_CHUNK]->(DocumentChunk)-[:MENTIONS]->(KnowledgeEntity)
 * (KnowledgeEntity)-[:RELATED_TO]->(KnowledgeEntity)
 * </pre>
 *
 * <p>单篇构建步骤：</p>
 * <ol>
 *   <li>删除该文档旧图数据（clear before build）</li>
 *   <li>MERGE 文档节点</li>
 *   <li>ChunkingService 分块 → 每块建 DocumentChunk + HAS_CHUNK</li>
 *   <li>ExtractionService 抽实体关系 → MERGE 实体 / RELATED_TO / MENTIONS</li>
 * </ol>
 *
 * Neo4j 不可用时跳过写入（不抛错阻断发布消费）。
 */
@Injectable()
export class GraphBuildService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GraphBuildService.name);
  private driver: Driver | null = null;
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly chunkingService: ChunkingService,
    private readonly extractionService: ExtractionService,
  ) {
    this.enabled = this.config.get<string>('NEO4J_ENABLED', 'true') !== 'false';
  }

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.warn('Neo4j 已禁用（NEO4J_ENABLED=false）');
      return;
    }
    const uri = this.config.get('NEO4J_URI', 'bolt://localhost:7687');
    const user = this.config.get('NEO4J_USER', 'neo4j');
    const password = this.config.get('NEO4J_PASSWORD', 'password');
    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
    try {
      await this.driver.verifyConnectivity();
      this.logger.log(`Neo4j 已连接：${uri}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Neo4j 不可用，KG 写入将跳过：${message}`);
      await this.driver.close();
      this.driver = null;
    }
  }

  async onModuleDestroy() {
    await this.driver?.close();
  }

  /**
   * 为单篇文档全量重建图谱。
   * @returns 写入的实体数量（近似）
   */
  async buildForDocument(
    doc: PipelineDocument,
    preparedChunks?: DocumentChunk[],
  ): Promise<number> {
    if (!this.driver) {
      this.logger.warn(`跳过 KG 构建（Neo4j 不可用）：documentId=${doc.id}`);
      return 0;
    }
    if (!doc.content?.trim()) {
      this.logger.log(`文档内容为空，跳过 KG：documentId=${doc.id}`);
      return 0;
    }

    // 先清再建，避免重复发布导致边/节点翻倍
    await this.deleteForDocument(doc.id);

    const session = this.driver.session();
    const now = new Date().toISOString();
    try {
      // ① 文档节点：按 id 幂等 upsert，保留首次 createdAt
      await session.run(
        `
        // 以文档业务 id 为唯一键：存在则命中，不存在则创建
        MERGE (d:KnowledgeDocument {id: $id})
        // 每次重建都刷新可变元数据；createdAt 仅首次写入
        SET d.title = $title, d.summary = $summary, d.categoryId = $categoryId,
            d.teamId = $teamId, d.authorId = $authorId, d.status = $status, d.updatedAt = $now,
            d.createdAt = coalesce(d.createdAt, $now)
        `,
        {
          id: doc.id,
          title: doc.title,
          summary: doc.summary ?? '',
          categoryId: doc.categoryId ?? null,
          teamId: doc.teamId ?? null,
          authorId: doc.authorId ?? null,
          status: doc.status,
          now,
        },
      );

      // ② 优先使用共享分块；保留回退仅兼容历史全量建图入口。
      const chunks =
        preparedChunks ??
        (await this.chunkingService.chunk({
          content: doc.content,
          documentId: doc.id,
          documentTitle: doc.title,
          originalFileName: doc.originalFileName,
          fileSize: doc.fileSize,
          categoryId: doc.categoryId,
          authorId: doc.authorId,
          teamId: doc.teamId,
          docStatus: doc.status,
          publishTime:
            doc.publishTime instanceof Date
              ? doc.publishTime.toISOString()
              : doc.publishTime
                ? new Date(doc.publishTime).toISOString()
                : null,
        }));

      let totalEntities = 0;
      for (const chunk of chunks) {
        // ③ chunk 节点 + 文档→块边：Document -[HAS_CHUNK]-> Chunk
        await session.run(
          `
          // 以全局唯一 chunkId 幂等创建/更新块节点
          MERGE (c:DocumentChunk {chunkId: $chunkId})
          SET c.documentId = $documentId, c.content = $content, c.heading = $heading,
              c.chunkIndex = $chunkIndex, c.totalChunks = $totalChunks, c.updatedAt = $now
          // 携带 c 进入下一子句，避免丢失当前块上下文
          WITH c
          // 找到所属文档（① 已保证存在）
          MATCH (d:KnowledgeDocument {id: $documentId})
          // 文档→块 一对多边；边属性记序号便于按序遍历
          MERGE (d)-[r:HAS_CHUNK]->(c)
          SET r.chunkIndex = $chunkIndex
          `,
          {
            chunkId: chunk.chunkId,
            documentId: doc.id,
            content: chunk.content,
            heading: chunk.heading ?? null,
            chunkIndex: chunk.chunkIndex,
            totalChunks: chunk.totalChunks,
            now,
          },
        );

        // ④ 抽实体关系并落图；单块失败不阻断其余块（图已先清过）
        let extracted;
        try {
          extracted = await this.extractionService.extract(
            chunk.content,
            chunk.heading,
            doc.title,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `KG 抽取失败，跳过该块：documentId=${doc.id}, chunk=${chunk.chunkIndex}, ${message}`,
          );
          extracted = { entities: [], relations: [] };
        }
        // 绑定当前块，writeExtraction 才能建 MENTIONS
        extracted.chunkId = chunk.chunkId;
        // 写入 Neo4j：实体节点 / MENTIONS / RELATED_TO
        const written = await this.writeExtraction(session, extracted);
        // 累加本块实体数，仅用于日志；图数据已在上一行入库
        totalEntities += written;
      }

      this.logger.debug(
        `KG 图谱构建完成：documentId=${doc.id}, chunks=${chunks.length}, entities=${totalEntities}`,
      );
      return totalEntities;
    } finally {
      await session.close();
    }
  }

  /** 批量建图：单篇失败只记日志 */
  async buildBatch(
    docs: PipelineDocument[],
    chunksByDocumentId?: Map<string, DocumentChunk[]>,
  ) {
    for (const doc of docs) {
      try {
        await this.buildForDocument(doc, chunksByDocumentId?.get(doc.id));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`KG 构建失败：documentId=${doc.id}, ${message}`);
      }
    }
  }

  /**
   * 删除文档及其 chunk；再清理「已无人提及」的孤儿实体，避免图膨胀。
   */
  async deleteForDocument(documentId: string) {
    if (!this.driver) return;
    const session = this.driver.session();
    try {
      // 删除文档节点及其所有 chunk（DETACH 会一并拆掉相连关系边）
      await session.run(
        `
        // 定位待删文档
        MATCH (d:KnowledgeDocument {id: $id})
        // 可选匹配下属块：无 chunk 时仍可删文档
        OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:DocumentChunk)
        // DETACH DELETE：先删节点上的所有关系，再删节点本身
        // 会清掉 HAS_CHUNK 等与 c/d 相连的边
        DETACH DELETE c, d
        `,
        { id: documentId },
      );
      // 孤儿实体清理：没有任何 chunk MENTIONS 的实体视为无引用，整节点删除
      await session.run(
        `
        MATCH (e:KnowledgeEntity)
        // 入边 MENTIONS 为空 ⇒ 已无任何文档块引用该实体
        WHERE NOT (e)<-[:MENTIONS]-()
        // DETACH 同时清掉 RELATED_TO 等残留关系，避免悬空边
        DETACH DELETE e
        `,
      );
      this.logger.log(`KG 图谱已删除：documentId=${documentId}`);
    } finally {
      await session.close();
    }
  }

  /**
   * 返回用于可视化的实体子图。节点按被文档块提及次数排序，避免一次向浏览器传递整张图。
   */
  async getVisualization(limit = 60, documentId?: string, keyword?: string) {
    if (!this.driver) {
      throw new ServiceUnavailableException('知识图谱服务暂不可用');
    }

    const safeLimit = Math.min(Math.max(Math.floor(limit) || 60, 1), 150);
    const session = this.driver.session();
    try {
      const nodeResult = await session.run(
        `
        MATCH (e:KnowledgeEntity)<-[:MENTIONS]-(c:DocumentChunk)<-[:HAS_CHUNK]-(d:KnowledgeDocument)
        WHERE ($documentId IS NULL OR d.id = $documentId)
          AND (
            $keyword IS NULL
            OR toLower(coalesce(e.name, '')) CONTAINS $keyword
            OR toLower(coalesce(e.description, '')) CONTAINS $keyword
            OR toLower(coalesce(c.heading, '')) CONTAINS $keyword
            OR toLower(coalesce(c.content, '')) CONTAINS $keyword
            OR toLower(coalesce(d.title, '')) CONTAINS $keyword
            OR toLower(coalesce(d.summary, '')) CONTAINS $keyword
          )
        WITH e, count(DISTINCT c) AS mentions,
             collect(DISTINCT { id: d.id, title: d.title }) AS documents
        RETURN e.name AS id, e.name AS name, e.type AS type,
               e.description AS description, e.aliases AS aliases,
               mentions, documents
        ORDER BY mentions DESC, name ASC
        LIMIT $limit
        `,
        {
          limit: neo4j.int(safeLimit),
          documentId: documentId ?? null,
          keyword: keyword?.trim().toLowerCase() || null,
        },
      );
      const nodes = nodeResult.records.map((record) => ({
        id: String(record.get('id')),
        name: String(record.get('name')),
        type: String(record.get('type') ?? 'CONCEPT'),
        description: String(record.get('description') ?? ''),
        aliases: (record.get('aliases') ?? []) as string[],
        mentions: this.toNumber(record.get('mentions')),
        documents: (record.get('documents') ?? []) as Array<{
          id: string;
          title: string;
        }>,
      }));
      const names = nodes.map((node) => node.name);
      if (!names.length) return { nodes, edges: [] };

      const edgeResult = await session.run(
        `
        MATCH (source:KnowledgeEntity)-[r:RELATED_TO]->(target:KnowledgeEntity)
        WHERE source.name IN $names AND target.name IN $names
        RETURN source.name AS source, target.name AS target,
               r.relation AS relation, r.weight AS weight
        ORDER BY source, target
        `,
        { names },
      );
      const edges = edgeResult.records.map((record) => ({
        source: String(record.get('source')),
        target: String(record.get('target')),
        relation: String(record.get('relation') ?? 'RELATED_TO'),
        weight: this.toNumber(record.get('weight')),
      }));
      return { nodes, edges };
    } finally {
      await session.close();
    }
  }

  /**
   * 搜索图谱中的原始节点。不同节点的业务字段不同，统一映射为前端可直接展示的结果。
   */
  async searchNodes(keyword: string, limit = 20) {
    if (!this.driver) {
      throw new ServiceUnavailableException('知识图谱服务暂不可用');
    }

    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) return [];

    const safeLimit = Math.min(Math.max(Math.floor(limit) || 20, 1), 100);
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (n)
        WHERE (n:KnowledgeDocument OR n:DocumentChunk OR n:KnowledgeEntity)
          AND (
            toLower(coalesce(n.name, '')) CONTAINS $keyword
            OR toLower(coalesce(n.title, '')) CONTAINS $keyword
            OR toLower(coalesce(n.heading, '')) CONTAINS $keyword
            OR toLower(coalesce(n.description, '')) CONTAINS $keyword
            OR toLower(coalesce(n.summary, '')) CONTAINS $keyword
            OR toLower(coalesce(n.content, '')) CONTAINS $keyword
          )
        RETURN labels(n)[0] AS label,
               coalesce(n.name, n.title, n.heading, n.id, n.chunkId) AS name,
               coalesce(n.id, n.chunkId, n.name) AS id,
               n.type AS type,
               n.title AS title,
               n.description AS description,
               n.heading AS heading,
               n.documentId AS documentId,
               n.summary AS summary,
               CASE WHEN n.content IS NULL THEN null ELSE substring(n.content, 0, 160) END AS snippet
        ORDER BY label, name
        LIMIT $limit
        `,
        { keyword: normalizedKeyword, limit: neo4j.int(safeLimit) },
      );

      return result.records.map((record) => ({
        label: String(record.get('label')),
        id: String(record.get('id')),
        name: String(record.get('name')),
        type: record.get('type') == null ? null : String(record.get('type')),
        title: record.get('title') == null ? null : String(record.get('title')),
        description:
          record.get('description') == null
            ? null
            : String(record.get('description')),
        heading:
          record.get('heading') == null ? null : String(record.get('heading')),
        documentId:
          record.get('documentId') == null
            ? null
            : String(record.get('documentId')),
        summary:
          record.get('summary') == null ? null : String(record.get('summary')),
        snippet:
          record.get('snippet') == null ? null : String(record.get('snippet')),
      }));
    } finally {
      await session.close();
    }
  }

  private toNumber(value: unknown): number {
    return typeof value === 'number'
      ? value
      : typeof value === 'object' && value !== null && 'toNumber' in value
        ? Number((value as { toNumber: () => number }).toNumber())
        : Number(value ?? 0);
  }

  /**
   * 把抽取结果写入 Neo4j：
   * - KnowledgeEntity（按 name MERGE，跨文档可复用同名实体）
   * - DocumentChunk -[:MENTIONS]-> Entity
   * - Entity -[:RELATED_TO]-> Entity
   */
  private async writeExtraction(
    session: Session,
    result: {
      chunkId?: string;
      entities: Array<{
        name: string;
        type: string;
        description?: string;
        aliases?: string[];
      }>;
      relations: Array<{
        source: string;
        target: string;
        relation: string;
        weight?: number;
      }>;
    },
  ): Promise<number> {
    const now = new Date().toISOString();
    let count = 0;

    for (const entity of result.entities) {
      await session.run(
        `
        MERGE (e:KnowledgeEntity {name: $name})
        ON CREATE SET e.type = $type, e.description = $description,
                      e.aliases = $aliases, e.createdAt = $now, e.updatedAt = $now
        ON MATCH SET e.type = coalesce($type, e.type),
                     e.description = CASE WHEN $description <> '' THEN $description ELSE e.description END,
                     e.updatedAt = $now
        `,
        {
          name: entity.name,
          type: entity.type,
          description: entity.description ?? '',
          aliases: entity.aliases ?? [],
          now,
        },
      );
      count++;

      if (result.chunkId) {
        await session.run(
          `
          MATCH (c:DocumentChunk {chunkId: $chunkId})
          MATCH (e:KnowledgeEntity {name: $name})
          MERGE (c)-[:MENTIONS]->(e)
          `,
          { chunkId: result.chunkId, name: entity.name },
        );
      }
    }

    for (const rel of result.relations) {
      await session.run(
        `
        MATCH (a:KnowledgeEntity {name: $source})
        MATCH (b:KnowledgeEntity {name: $target})
        MERGE (a)-[r:RELATED_TO]->(b)
        ON CREATE SET r.relation = $relType, r.weight = $weight, r.createdAt = datetime()
        ON MATCH SET r.weight = coalesce($weight, r.weight)
        `,
        {
          source: rel.source,
          target: rel.target,
          relType: rel.relation,
          weight: rel.weight ?? 0.5,
        },
      );
    }

    return count;
  }
}
