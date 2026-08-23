import { Controller, Post, Body, Sse, Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { RagService } from './rag.service';
import { AgentOrchestrator } from './agent/agent-orchestrator.service';
import { QueryRagDto } from './dto/query.dto';
import { AgentQueryDto } from './dto/agent-query.dto';
import { RagQueryResponseDto } from './dto/response.dto';
import { AgentQueryResponseDto } from './dto/agent-response.dto';
import { AguiEventUnion } from './types/agui.types';

@Controller('rag')
export class RagController {
  private readonly logger = new Logger(RagController.name);

  constructor(
    private readonly ragService: RagService,
    private readonly agentOrchestrator: AgentOrchestrator,
  ) {}

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

  /**
   * Agentic RAG 问答
   */
  @Post('agent')
  async agentQuery(@Body() dto: AgentQueryDto): Promise<AgentQueryResponseDto> {
    return this.agentOrchestrator.query(dto.question, {
      maxIterations: dto.maxIterations,
      enableFollowUp: dto.enableFollowUp,
      userId: dto.userId,
      categoryId: dto.categoryId,
      teamId: dto.teamId,
    });
  }

  /**
   * Agentic RAG 流式问答（AGUI 规范）
   */
  @Post('agent/stream')
  @Sse('agent/stream')
  async agentStream(@Body() dto: AgentQueryDto): Promise<Observable<MessageEvent>> {
    const subject = new Subject<MessageEvent>();

    // 异步执行流式查询
    (async () => {
      try {
        for await (const event of this.agentOrchestrator.queryStream(dto.question, {
          maxIterations: dto.maxIterations,
          enableFollowUp: dto.enableFollowUp,
          userId: dto.userId,
          categoryId: dto.categoryId,
          teamId: dto.teamId,
        })) {
          subject.next({
            data: JSON.stringify(event),
          } as MessageEvent);
        }
      } catch (error) {
        this.logger.error(`AGUI 流式查询失败: ${error.message}`);
        subject.next({
          data: JSON.stringify({
            type: 'error',
            timestamp: Date.now(),
            message: error.message,
          }),
        } as MessageEvent);
      } finally {
        subject.complete();
      }
    })();

    return subject.asObservable();
  }
}
