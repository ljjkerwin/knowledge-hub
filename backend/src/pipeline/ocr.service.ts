import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWorker, OEM, type Worker } from 'tesseract.js';

/**
 * 可选的本地 OCR 适配器。启用后使用 tesseract.js 识别 Markdown 图片。
 *
 * OCR Worker 复用且串行执行，避免多个 WASM 实例同时占用大量内存；达到指定任务数后
 * 会重建 Worker，防止长期运行的 WASM 内存持续膨胀。
 */
@Injectable()
export class OcrService implements OnModuleDestroy {
  private readonly logger = new Logger(OcrService.name);
  private readonly enabled: boolean;
  private readonly language: string;
  private readonly langPath?: string;
  private readonly cachePath?: string;
  private readonly maxImageBytes: number;
  private readonly recycleAfterJobs: number;
  private worker?: Worker;
  private workerPromise?: Promise<Worker>;
  private queuedRecognition = Promise.resolve();
  private completedJobs = 0;

  constructor(config: ConfigService) {
    this.enabled = config.get<string>('OCR_ENABLED', 'false') === 'true';
    this.language = config.get<string>('OCR_LANGUAGE', 'chi_sim');
    this.langPath = config.get<string>('OCR_LANG_PATH') || undefined;
    this.cachePath = config.get<string>('OCR_CACHE_PATH') || undefined;
    this.maxImageBytes = this.positiveNumber(
      config.get<string>('OCR_MAX_IMAGE_BYTES'),
      10 * 1024 * 1024,
    );
    this.recycleAfterJobs = this.positiveNumber(
      config.get<string>('OCR_RECYCLE_AFTER_JOBS'),
      500,
    );
  }

  async enrichMarkdown(markdown: string, documentId: string): Promise<string> {
    if (!this.enabled) return markdown;
    const urls = [
      ...markdown.matchAll(/!\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g),
    ]
      .map((match) => match[1])
      .filter(Boolean);
    if (!urls.length) return markdown;

    const texts = await Promise.all(
      [...new Set(urls)].map((imageUrl) =>
        this.recognizeImage(imageUrl, documentId),
      ),
    );
    const ocrText = texts.filter(Boolean).join('\n\n');
    return ocrText ? `${markdown}\n\n<!-- OCR -->\n${ocrText}` : markdown;
  }

  /** ParsedBlock 流程按单张图片调用；未启用 OCR 时返回空串。 */
  async recognizeImage(imageUrl: string, documentId: string): Promise<string> {
    if (!this.enabled) return '';
    return this.enqueue(() => this.recognize(imageUrl, documentId));
  }

  async onModuleDestroy() {
    await this.worker?.terminate();
    this.worker = undefined;
  }

  private async recognize(
    imageUrl: string,
    documentId: string,
  ): Promise<string> {
    try {
      const url = new URL(imageUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`不支持的图片协议：${url.protocol}`);
      }
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentLength = Number(response.headers.get('content-length') ?? 0);
      if (contentLength > this.maxImageBytes) {
        throw new Error(`图片超过 ${this.maxImageBytes} 字节限制`);
      }
      const image = Buffer.from(await response.arrayBuffer());
      if (!image.length) throw new Error('图片内容为空');
      if (image.length > this.maxImageBytes) {
        throw new Error(`图片超过 ${this.maxImageBytes} 字节限制`);
      }

      const worker = await this.getWorker();
      const { data } = await worker.recognize(image);
      this.completedJobs += 1;
      if (this.completedJobs >= this.recycleAfterJobs) await this.recycleWorker();
      return data.text.trim();
    } catch (error) {
      this.logger.warn(
        `OCR 失败，跳过图片：documentId=${documentId}, ${error instanceof Error ? error.message : String(error)}`,
      );
      return '';
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queuedRecognition.then(task, task);
    this.queuedRecognition = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async getWorker(): Promise<Worker> {
    if (this.worker) return this.worker;
    if (!this.workerPromise) {
      this.workerPromise = createWorker(this.language, OEM.LSTM_ONLY, {
        ...(this.langPath ? { langPath: this.langPath } : {}),
        ...(this.cachePath ? { cachePath: this.cachePath } : {}),
      })
        .then((worker) => {
          this.worker = worker;
          this.completedJobs = 0;
          this.logger.log(
            `本地 OCR Worker 已就绪：language=${this.language}`,
          );
          return worker;
        })
        .finally(() => {
          this.workerPromise = undefined;
        });
    }
    return this.workerPromise;
  }

  private async recycleWorker() {
    const worker = this.worker;
    this.worker = undefined;
    await worker?.terminate();
    this.logger.log(`本地 OCR Worker 已重建：已处理 ${this.completedJobs} 张图片`);
  }

  private positiveNumber(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  }
}
