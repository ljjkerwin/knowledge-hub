import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 可选 OCR 适配器。启用后仅处理 Markdown 图片，服务端点由 OCR_ENDPOINT 提供。
 * 约定请求 { imageUrl }，响应 { text } 或 { data: { text } }；未配置时完全跳过。
 */
@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private readonly enabled: boolean;
  private readonly endpoint?: string;

  constructor(config: ConfigService) {
    this.enabled = config.get<string>('OCR_ENABLED', 'false') === 'true';
    this.endpoint = config.get<string>('OCR_ENDPOINT');
  }

  async enrichMarkdown(markdown: string, documentId: string): Promise<string> {
    if (!this.enabled || !this.endpoint) return markdown;
    const urls = [
      ...markdown.matchAll(/!\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g),
    ]
      .map((match) => match[1])
      .filter(Boolean);
    if (!urls.length) return markdown;

    const texts = await Promise.all(
      [...new Set(urls)].map((imageUrl) =>
        this.recognize(imageUrl, documentId),
      ),
    );
    const ocrText = texts.filter(Boolean).join('\n\n');
    return ocrText ? `${markdown}\n\n<!-- OCR -->\n${ocrText}` : markdown;
  }

  /** ParsedBlock 流程按单张图片调用；未启用 OCR 时返回空串。 */
  async recognizeImage(imageUrl: string, documentId: string): Promise<string> {
    if (!this.enabled || !this.endpoint) return '';
    return this.recognize(imageUrl, documentId);
  }

  private async recognize(
    imageUrl: string,
    documentId: string,
  ): Promise<string> {
    try {
      const response = await fetch(this.endpoint!, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageUrl, documentId }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as {
        text?: unknown;
        data?: { text?: unknown };
      };
      return String(body.text ?? body.data?.text ?? '').trim();
    } catch (error) {
      this.logger.warn(
        `OCR 失败，跳过图片：documentId=${documentId}, ${error instanceof Error ? error.message : String(error)}`,
      );
      return '';
    }
  }
}
