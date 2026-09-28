import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OcrService } from './ocr.service';
import {
  ParsedBlock,
  ParsedBlockDocument,
} from './schemas/parsed-block.schema';
import { PipelineDocument } from './types/pipeline.types';

@Injectable()
export class ParsedBlockService {
  constructor(
    @InjectModel(ParsedBlock.name)
    private readonly blocks: Model<ParsedBlockDocument>,
    private readonly ocr: OcrService,
  ) {}

  async rebuild(doc: PipelineDocument): Promise<ParsedBlock[]> {
    const existing = await this.blocks
      .find({ documentId: doc.id, contentVersion: doc.contentVersion })
      .sort({ ordinal: 1 })
      .lean();
    if (existing.length) return existing;
    const tokens = this.tokenize(doc.content);
    const records: Omit<ParsedBlock, '_id'>[] = [];
    for (const token of tokens) {
      const blockId = createHash('sha256')
        .update(`${doc.id}:${token.ordinal}:${token.type}:${token.raw}`)
        .digest('hex');
      records.push({
        documentId: doc.id,
        contentVersion: doc.contentVersion,
        blockId,
        type: token.type,
        content: token.content,
        rawContent: token.type === 'table' ? token.raw : null,
        sourceUrl: token.url ?? null,
        ordinal: token.ordinal,
      });
      if (token.type === 'image' && token.url) {
        const ocrText = await this.ocr.recognizeImage(token.url, doc.id);
        if (ocrText)
          records.push({
            documentId: doc.id,
            contentVersion: doc.contentVersion,
            blockId: createHash('sha256')
              .update(`${blockId}:ocr`)
              .digest('hex'),
            type: 'ocr',
            content: ocrText,
            rawContent: null,
            sourceUrl: token.url,
            ordinal: token.ordinal + 0.1,
          });
      }
    }
    await this.blocks.deleteMany({ documentId: doc.id });
    if (records.length) await this.blocks.insertMany(records);
    return records as ParsedBlock[];
  }

  async deleteByDocumentId(documentId: string) {
    await this.blocks.deleteMany({ documentId });
  }

  private tokenize(markdown: string) {
    const pattern =
      /((?:^|\n)(?:\|[^\n]+\|\n)\|\s*:?-{3,}[^\n]*\|(?:\n\|[^\n]+\|)+)|(!\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\))/g;
    const result: Array<{
      type: 'text' | 'table' | 'image';
      raw: string;
      content: string;
      url?: string;
      ordinal: number;
    }> = [];
    let cursor = 0;
    let ordinal = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(markdown))) {
      const before = markdown.slice(cursor, match.index).trim();
      if (before)
        result.push({
          type: 'text',
          raw: before,
          content: before,
          ordinal: ordinal++,
        });
      const table = match[1];
      const image = match[2];
      if (table)
        result.push({
          type: 'table',
          raw: table.trim(),
          content: this.tableSummary(table),
          ordinal: ordinal++,
        });
      if (image)
        result.push({
          type: 'image',
          raw: image,
          content: '',
          url: match[3],
          ordinal: ordinal++,
        });
      cursor = match.index + match[0].length;
    }
    const tail = markdown.slice(cursor).trim();
    if (tail)
      result.push({ type: 'text', raw: tail, content: tail, ordinal: ordinal });
    return result;
  }

  private tableSummary(table: string) {
    const lines = table.trim().split('\n').filter(Boolean);
    return `表格摘要：字段 ${lines[0] ?? ''}；共 ${Math.max(0, lines.length - 2)} 行。\n样例数据：\n${lines.slice(2, 5).join('\n')}`;
  }
}
