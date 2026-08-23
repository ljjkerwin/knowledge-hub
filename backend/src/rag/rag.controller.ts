import { Controller, Post, Body, Sse, Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { RagService } from './rag.service';
import { QueryRagDto } from './dto/query.dto';
import { RagQueryResponseDto } from './dto/response.dto';

@Controller('rag')
export class RagController {
  private readonly logger = new Logger(RagController.name);

  constructor(private readonly ragService: RagService) {}

  /**
   * 单轮问答
   */
  @Post('query')
  async query(@Body() dto: QueryRagDto): Promise<RagQueryResponseDto> {
    return this.ragService.query(dto);
  }

  /**
   * 流式问答（SSE）
   */
  @Post('query/stream')
  @Sse('query/stream')
  async queryStream(@Body() dto: QueryRagDto): Promise<Observable<MessageEvent>> {
    const subject = new Subject<MessageEvent>();

    // 异步执行流式查询
    (async () => {
      try {
        for await (const chunk of this.ragService.queryStream(dto)) {
          subject.next({
            data: JSON.stringify(chunk),
          } as MessageEvent);
        }
      } catch (error) {
        this.logger.error(`SSE 流式查询失败: ${error.message}`);
        subject.next({
          data: JSON.stringify({ type: 'error', content: error.message }),
        } as MessageEvent);
      } finally {
        subject.complete();
      }
    })();

    return subject.asObservable();
  }
}
