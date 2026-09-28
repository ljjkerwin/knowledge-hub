import { Injectable, Logger } from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EntityManager } from 'typeorm';
import {
  DocumentEntity,
  DocumentStatus,
} from '../document/entities/document.entity';
import {
  DocumentContent,
  DocumentContentDocument,
} from '../document/schemas/document-content.schema';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import { GraphBuildService } from './graph-build.service';
import { SearchIndexService } from './search-index.service';
import { VectorIndexService } from './vector-index.service';
import { PipelineDocument } from './types/pipeline.types';
import { ChunkStoreService } from './chunk-store.service';

/**
 * 发布后知识管线编排器
 *
 * <p>RAG：分块 → Embedding → ES kh_chunk</p>
 * <p>Search：整篇快照 → ES kh_document</p>
 * <p>KG：分块 → 抽实体关系 → Neo4j</p>
 *
 * <p>由 {@link DocumentPipelineConsumer} 在消费到 MQ 消息后调用；</p>
 * <p>本类负责「加载文档 → 调具体服务」，不直接碰 RabbitMQ。</p>
 */
@Injectable()
export class PipelineOrchestrator {
  private readonly logger = new Logger(PipelineOrchestrator.name);

  constructor(
    @InjectEntityManager()
    private readonly em: EntityManager,
    @InjectModel(DocumentContent.name)
    private readonly contentModel: Model<DocumentContentDocument>,
    private readonly chunkingService: ChunkingService,
    private readonly embeddingService: EmbeddingService,
    private readonly vectorIndexService: VectorIndexService,
    private readonly searchIndexService: SearchIndexService,
    private readonly graphBuildService: GraphBuildService,
    private readonly chunkStore: ChunkStoreService,
  ) {}

  /**
   * 处理 RAG 重建 / 删除消息。
   *
   * 重建流水线（单文档）：清旧块 → Chunking → Embedding → 写入 ES kh_chunk
   */
  async handleRagReindex(type: string, documentIds?: string[]) {
    if (type === 'DELETE_BY_DOC_IDS' && documentIds?.length) {
      for (const id of documentIds) {
        await this.vectorIndexService.deleteByDocId(id);
      }
      return;
    }

    if (type !== 'BY_DOC_IDS' || !documentIds?.length) {
      this.logger.warn(`忽略未支持的 RAG 消息：type=${type}`);
      return;
    }

    const docs = await this.loadDocumentsByIds(documentIds);
    this.logger.log(`RAG 开始索引：type=${type}, total=${docs.length}`);

    for (const doc of docs) {
      try {
        await this.reindexOne(doc);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`RAG 索引失败：documentId=${doc.id}, ${message}`);
      }
    }
  }

  /**
   * 处理 Search 索引消息。
   * INDEX：按文档 ID 加载完整正文后写入 ES kh_document。
   * DELETE：按 documentId 删除。
   */
  async handleSearchIndex(type: string, documentId: string) {
    if (type === 'DELETE') {
      await this.searchIndexService.deleteDocument(documentId);
      return;
    }

    if (type === 'INDEX') {
      const [document] = await this.loadDocumentsByIds([documentId]);
      if (!document || document.status !== DocumentStatus.Published) {
        // 发布后的旧消息可能晚于下架消息到达，避免重新写入不可见文档。
        await this.searchIndexService.deleteDocument(documentId);
        return;
      }
      await this.searchIndexService.indexDocument(
        this.toSearchIndexDocument(document),
      );
      return;
    }

    this.logger.warn(`忽略未支持的 Search 消息：type=${type}`);
  }

  /**
   * 处理 KG 建图消息。
   * BUILD_*：读正文 → 分块 → 抽实体关系 → 写 Neo4j
   * DELETE_*：删文档节点及其 chunk / 孤儿实体
   */
  async handleKgBuild(type: string, documentIds?: string[]) {
    if (type === 'DELETE_BY_DOC_IDS' && documentIds?.length) {
      for (const id of documentIds) {
        await this.graphBuildService.deleteForDocument(id);
      }
      return;
    }

    const docs =
      type === 'BUILD_BY_DOC_IDS' && documentIds?.length
        ? await this.loadDocumentsByIds(documentIds)
        : type === 'BUILD_ALL'
          ? await this.loadAllPublishedDocuments()
          : [];

    if (!docs.length) {
      this.logger.warn(`忽略未支持或空的 KG 消息：type=${type}`);
      return;
    }

    this.logger.log(`KG 开始建图：type=${type}, total=${docs.length}`);
    await this.graphBuildService.buildBatch(docs);
  }

  /** 单篇：分块 → 批量嵌入 → 落库 */
  private async reindexOne(doc: PipelineDocument) {
    if (!doc.content?.trim()) {
      this.logger.warn(`文档内容为空，跳过 RAG：documentId=${doc.id}`);
      return;
    }

    // 先清旧块，避免重复发布时脏数据残留
    await this.vectorIndexService.deleteByDocId(doc.id);

    const chunks = await this.chunkStore.rebuild(doc);

    if (!chunks.length) return;

    const embeddings = await this.embeddingService.embedBatch(
      chunks.map((c) => c.content),
    );
    for (let i = 0; i < chunks.length; i++) {
      chunks[i].embedding = embeddings[i];
    }

    await this.vectorIndexService.indexChunks(chunks);
    this.logger.log(
      `RAG 索引完成：documentId=${doc.id}, chunks=${chunks.length}`,
    );
  }

  /**
   * 统一录入：OCR（按需）与分块只执行一次，随后将同一批 Chunk 投影到 RAG 和 KG。
   * 此方法由新的 ingest 消费者调用；旧的 RAG/KG 入口仍保留作历史任务兼容。
   */
  async handleSharedIngest(type: 'UPSERT' | 'DELETE', documentId: string) {
    if (type === 'DELETE') {
      await Promise.all([
        this.vectorIndexService.deleteByDocId(documentId),
        this.graphBuildService.deleteForDocument(documentId),
        this.chunkStore.deleteByDocumentId(documentId),
      ]);
      return;
    }
    const [doc] = await this.loadDocumentsByIds([documentId]);
    if (!doc || doc.status !== DocumentStatus.Published) {
      await this.handleSharedIngest('DELETE', documentId);
      return;
    }
    if (!doc.content.trim()) {
      await this.handleSharedIngest('DELETE', documentId);
      return;
    }
    // 先清投影，再生成一次共享 Chunk。任一投影失败会由 MQ 重试；Chunk 事实层可复用。
    await this.vectorIndexService.deleteByDocId(documentId);
    const chunks = await this.chunkStore.rebuild(doc);
    await this.embeddingAndIndex(chunks);
    await this.graphBuildService.buildForDocument(doc, chunks);
  }

  private async embeddingAndIndex(
    chunks: import('./types/pipeline.types').DocumentChunk[],
  ) {
    if (!chunks.length) return;
    const embeddings = await this.embeddingService.embedBatch(
      chunks.map((chunk) => chunk.content),
    );
    chunks.forEach((chunk, index) => {
      chunk.embedding = embeddings[index];
    });
    await this.vectorIndexService.indexChunks(chunks);
  }

  /** ES date 字段需要 ISO-8601；Date#toString() 会被拒绝 */
  private toIsoDate(value?: Date | string | null): string | null {
    if (value == null) return null;
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  /** 按 ID 列表加载元数据 + Mongo 正文 */
  private async loadDocumentsByIds(ids: string[]): Promise<PipelineDocument[]> {
    const result: PipelineDocument[] = [];
    for (const id of ids) {
      const doc = await this.em.findOne(DocumentEntity, {
        where: { id, deleted: false },
      });
      if (!doc) continue;
      const contentDoc = await this.contentModel
        .findOne({ _id: doc.contentId, deleted: false })
        .lean();
      result.push(
        this.toPipelineDoc(
          doc,
          contentDoc?.content ?? '',
          contentDoc?.version ?? 1,
        ),
      );
    }
    return result;
  }

  /** 加载全部已发布且未删除的文档（BUILD_ALL） */
  private async loadAllPublishedDocuments(): Promise<PipelineDocument[]> {
    const docs = await this.em.find(DocumentEntity, {
      where: { deleted: false, status: DocumentStatus.Published },
    });
    const result: PipelineDocument[] = [];
    for (const doc of docs) {
      const contentDoc = await this.contentModel
        .findOne({ _id: doc.contentId, deleted: false })
        .lean();
      result.push(
        this.toPipelineDoc(
          doc,
          contentDoc?.content ?? '',
          contentDoc?.version ?? 1,
        ),
      );
    }
    return result;
  }

  /** Postgres 实体 + Mongo 正文 → 管线统一 DTO */
  private toPipelineDoc(
    doc: DocumentEntity,
    content: string,
    contentVersion: number,
  ): PipelineDocument {
    return {
      id: doc.id,
      title: doc.title,
      content,
      contentVersion,
      summary: doc.summary,
      categoryId: doc.categoryId,
      authorId: doc.authorId,
      teamId: doc.teamId,
      status: doc.status,
      tags: doc.tags,
      isPublic: doc.isPublic,
      viewCount: doc.viewCount,
      likeCount: doc.likeCount,
      commentCount: doc.commentCount,
      createBy: doc.createBy,
      publishTime: doc.publishTime,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  /** 将完整的管线文档转换为 ES 全文检索记录。 */
  private toSearchIndexDocument(
    doc: PipelineDocument,
  ): Record<string, unknown> {
    return {
      id: doc.id,
      title: doc.title,
      summary: doc.summary ?? null,
      content: doc.content,
      categoryId: doc.categoryId ?? null,
      tags: doc.tags ?? null,
      status: doc.status,
      isPublic: doc.isPublic ?? false,
      viewCount: doc.viewCount ?? 0,
      likeCount: doc.likeCount ?? 0,
      commentCount: doc.commentCount ?? 0,
      authorId: doc.authorId ?? null,
      createBy: doc.createBy ?? null,
      publishTime: this.toIsoDate(doc.publishTime),
      createdAt: this.toIsoDate(doc.createdAt),
      updatedAt: this.toIsoDate(doc.updatedAt),
    };
  }
}
