import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ChunkingService } from './chunking.service';
import { ParsedBlockService } from './parsed-block.service';
import {
  StoredDocumentChunk,
  StoredDocumentChunkDocument,
} from './schemas/document-chunk.schema';
import { DocumentChunk, PipelineDocument } from './types/pipeline.types';

@Injectable()
export class ChunkStoreService {
  constructor(
    @InjectModel(StoredDocumentChunk.name)
    private readonly chunks: Model<StoredDocumentChunkDocument>,
    private readonly chunking: ChunkingService,
    private readonly parsedBlocks: ParsedBlockService,
  ) {}

  /** 一次解析/富化/分块后写入共享事实层，供向量与图谱消费者复用。 */
  async rebuild(doc: PipelineDocument): Promise<DocumentChunk[]> {
    const existing = await this.chunks
      .find({ documentId: doc.id, contentVersion: doc.contentVersion })
      .sort({ chunkIndex: 1 })
      .lean();
    if (existing.length) return existing as DocumentChunk[];

    const blocks = await this.parsedBlocks.rebuild(doc);
    const text = blocks
      .filter((block) => block.type === 'text' || block.type === 'ocr')
      .map((block) => block.content)
      .join('\n\n');
    const chunks = await this.chunking.chunk({
      content: text,
      documentId: doc.id,
      documentTitle: doc.title,
      originalFileName: doc.originalFileName,
      fileSize: doc.fileSize,
      categoryId: doc.categoryId,
      authorId: doc.authorId,
      teamId: doc.teamId,
      docStatus: doc.status,
      publishTime: this.toIsoDate(doc.publishTime),
    });
    const tableBlocks = blocks.filter((block) => block.type === 'table');
    const tableChunks: DocumentChunk[] = tableBlocks.map((block, index) => ({
      chunkId: block.blockId,
      documentId: doc.id,
      documentTitle: doc.title,
      originalFileName: doc.originalFileName,
      fileSize: doc.fileSize,
      content: block.content,
      tableContent: block.rawContent ?? undefined,
      heading: '表格',
      chunkIndex: chunks.length + index,
      totalChunks: chunks.length + tableBlocks.length,
      categoryId: doc.categoryId,
      authorId: doc.authorId,
      teamId: doc.teamId,
      docStatus: doc.status,
      publishTime: this.toIsoDate(doc.publishTime),
    }));
    const allChunks = [...chunks, ...tableChunks];
    allChunks.forEach((chunk) => (chunk.totalChunks = allChunks.length));
    await this.chunks.deleteMany({ documentId: doc.id });
    if (allChunks.length) {
      await this.chunks.insertMany(
        allChunks.map(({ embedding, ...chunk }) => ({
          ...chunk,
          contentVersion: doc.contentVersion,
        })),
      );
    }
    return allChunks;
  }

  async findByDocumentId(documentId: string): Promise<DocumentChunk[]> {
    return this.chunks
      .find({ documentId })
      .sort({ chunkIndex: 1 })
      .lean() as Promise<DocumentChunk[]>;
  }

  async deleteByDocumentId(documentId: string) {
    await this.chunks.deleteMany({ documentId });
    await this.parsedBlocks.deleteByDocumentId(documentId);
  }

  private toIsoDate(value?: Date | string | null) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
}
