import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type StoredDocumentChunkDocument = HydratedDocument<StoredDocumentChunk>;

/**
 * 文档解析后的共享分块事实层。
 * ES / Neo4j 均是此集合的可重建投影，不能反向作为分块来源。
 */
@Schema({ collection: 'document_chunks', timestamps: true, versionKey: false })
export class StoredDocumentChunk {
  @Prop({ type: String, required: true, index: true })
  documentId: string;

  /** document_content.version；防止旧消费结果覆盖新正文。 */
  @Prop({ type: Number, required: true, index: true })
  contentVersion: number;

  @Prop({ type: String, required: true })
  chunkId: string;

  @Prop({ type: String, required: true })
  documentTitle: string;

  /** 原正文块与 OCR 结果合成后的可检索文本。 */
  @Prop({ type: String, required: true })
  content: string;

  /** 表格原貌（Markdown；后续解析器提供 HTML 时可切换为 HTML）。 */
  @Prop({ type: String, default: null })
  tableContent?: string | null;

  @Prop({ type: String, default: null })
  heading?: string | null;

  @Prop({ type: Number, required: true })
  chunkIndex: number;

  @Prop({ type: Number, required: true })
  totalChunks: number;

  @Prop({ type: String, default: null }) categoryId?: string | null;
  @Prop({ type: String, default: null }) authorId?: string | null;
  @Prop({ type: String, default: null }) teamId?: string | null;
  @Prop({ type: Number, default: null }) docStatus?: number | null;
  @Prop({ type: String, default: null }) publishTime?: string | null;
}

export const StoredDocumentChunkSchema =
  SchemaFactory.createForClass(StoredDocumentChunk);
StoredDocumentChunkSchema.index(
  { documentId: 1, contentVersion: 1, chunkId: 1 },
  { unique: true },
);
