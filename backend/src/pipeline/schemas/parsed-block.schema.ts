import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ParsedBlockDocument = HydratedDocument<ParsedBlock>;

/** 文档解析事实层：文本、表格、图片及其后续 OCR/VLM 富化均从这里演进。 */
@Schema({
  collection: 'document_parsed_blocks',
  timestamps: true,
  versionKey: false,
})
export class ParsedBlock {
  @Prop({ type: String, required: true, index: true }) documentId: string;
  @Prop({ type: Number, required: true, index: true }) contentVersion: number;
  @Prop({ type: String, required: true }) blockId: string;
  @Prop({
    type: String,
    required: true,
    enum: ['text', 'table', 'image', 'ocr'],
  })
  type: 'text' | 'table' | 'image' | 'ocr';
  /** 检索或下游分块使用的规范化文本。 */
  @Prop({ type: String, default: '' }) content: string;
  /** 表格原貌（当前为 Markdown；可无缝替换为 HTML）。 */
  @Prop({ type: String, default: null }) rawContent?: string | null;
  @Prop({ type: String, default: null }) sourceUrl?: string | null;
  @Prop({ type: Number, required: true }) ordinal: number;
}

export const ParsedBlockSchema = SchemaFactory.createForClass(ParsedBlock);
ParsedBlockSchema.index(
  { documentId: 1, contentVersion: 1, blockId: 1 },
  { unique: true },
);
