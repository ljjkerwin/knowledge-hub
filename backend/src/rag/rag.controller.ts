import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  Sse,
  Logger,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { LangfuseClient } from '@langfuse/client';
import { LangfuseSpan, startActiveObservation } from '@langfuse/tracing';
import { AgentOrchestrator } from './agent/agent-orchestrator.service';
import { ConversationService } from './conversation.service';
import { ContextManager } from './context-manager.service';
import { ChatDto, ConversationListDto } from './dto/chat.dto';
import { AguiEventType } from './types/agui.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { isLangfuseTracingEnabled } from '../langfuse.config';

interface AuthenticatedRequest {
  user: {
    id: string;
  };
}

@Controller('rag')
@UseGuards(JwtAuthGuard)
export class RagController {
  private readonly logger = new Logger(RagController.name);
  private readonly langfuse = isLangfuseTracingEnabled
    ? new LangfuseClient()
    : undefined;

  constructor(
    private readonly agentOrchestrator: AgentOrchestrator,
    private readonly conversationService: ConversationService,
    private readonly contextManager: ContextManager,
  ) {}

  // ==================== 多轮对话 ====================

  /**
   * 多轮对话流式（AGUI 规范）
   */
  @Post('chat/stream')
  @Sse('chat/stream')
  async chatStream(
    @Body() dto: ChatDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Observable<MessageEvent>> {
    const subject = new Subject<MessageEvent>();

    void startActiveObservation('rag.chat.stream', async (span) => {
      try {
        span.update({ input: { messageLength: dto.message.length } });
        // 1. 获取或创建对话
        let conversationId = dto.conversationId;
        if (!conversationId) {
          const conversation = await this.conversationService.create(
            req.user.id,
          );
          conversationId = conversation.id;
        } else {
          // 校验用户是否有权访问指定会话
          await this.conversationService.findOneForUser(
            conversationId,
            req.user.id,
          );
        }

        // 2. 在保存当前消息前读取历史；Agent 会用它完成上下文改写。
        const context = await this.contextManager.buildContext(conversationId);

        // 3. 保存用户消息。
        await this.conversationService.addMessage(
          conversationId,
          'user',
          dto.message,
        );

        // 4. 流式执行 Agentic RAG（含上下文改写、问题分析和检索）。
        let answerText = '';
        let lastQueryId = '';
        let lastCitations: any[] = []; // 引用
        let lastConfidence = 0;
        let didComplete = false;
        let streamError: string | undefined;
        let totalIterations = 0;

        for await (const event of this.agentOrchestrator.queryStream({
          question: dto.message,
          conversationId,
          context,
          enableFollowUp: true,
        })) {
          subject.next({
            data: JSON.stringify(event),
          } as MessageEvent);

          // 收集答案信息
          if (event.type === AguiEventType.TEXT) answerText += event.content;
          // 检索结果
          if (event.type === AguiEventType.RETRIEVAL_RESULT) {
            lastCitations = event.chunks.map((c: any, i: number) => ({
              index: i + 1,
              chunkId: c.chunkId,
              documentId: c.documentId,
              documentTitle: c.documentTitle,
              content: c.content,
              score: c.similarity,
            }));
          }
          // 评估结果
          if (event.type === AguiEventType.EVALUATION) {
            lastConfidence = event.relevance ?? 0;
          }
          if (event.type === AguiEventType.DONE) {
            lastQueryId = event.queryId;
            totalIterations = event.totalIterations;
            didComplete = true;
          }
          if (event.type === AguiEventType.ERROR) streamError = event.message;
        }

        // queryStream 会将 Agent 内部异常转为 ERROR 事件，因此不能仅依赖 catch
        // 判断请求是否成功；没有 DONE 的流也不能保存为一条正常的助手消息。
        if (streamError || !didComplete) {
          this.recordRequestSuccess(span, false, {
            conversationId,
            queryId: lastQueryId || undefined,
            reason: streamError ?? 'stream_completed_without_done',
          });
          return;
        }

        // 5. 保存助手消息
        await this.conversationService.addMessage(
          conversationId,
          'assistant',
          answerText,
          {
            citations: lastCitations,
            queryId: lastQueryId,
            confidence: lastConfidence,
          },
        );

        this.recordRequestSuccess(span, true, {
          conversationId,
          queryId: lastQueryId,
          totalIterations,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`对话流式查询失败: ${message}`);
        this.recordRequestSuccess(span, false, { reason: message });
        subject.next({
          data: JSON.stringify({
            type: AguiEventType.ERROR,
            timestamp: Date.now(),
            message,
          }),
        } as MessageEvent);
      } finally {
        subject.complete();
      }
    });

    return subject.asObservable();
  }

  /**
   * request_success 是接口级业务结果：仅当收到 DONE 且助手消息落库成功时为 true。
   * Langfuse 的 LangChain Callback 只感知链和模型调用，无法推断这个 HTTP/SSE 结果。
   */
  private recordRequestSuccess(
    span: LangfuseSpan,
    success: boolean,
    metadata: Record<string, unknown>,
  ): void {
    span.update({
      output: { requestSuccess: success },
      metadata,
      level: success ? 'DEFAULT' : 'ERROR',
      statusMessage: success ? 'SSE chat completed' : 'SSE chat failed',
    });
    this.langfuse?.score.trace(
      { otelSpan: span.otelSpan },
      {
        name: 'rag.request.success',
        value: success ? 1 : 0,
        dataType: 'BOOLEAN',
        metadata,
      },
    );
  }

  // ==================== 对话管理 ====================

  /**
   * 获取对话列表
   */
  @Get('conversations')
  async getConversations(
    @Query() dto: ConversationListDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.conversationService.list(req.user.id, dto.page, dto.pageSize);
  }

  /**
   * 获取对话历史
   */
  @Get('conversations/:id/history')
  async getConversationHistory(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const conversation = await this.conversationService.findOneForUser(
      id,
      req.user.id,
    );
    const history = await this.conversationService.getHistory(id);
    return {
      conversation,
      messages: history,
    };
  }

  /**
   * 删除对话
   */
  @Delete('conversations/:id')
  async deleteConversation(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.conversationService.delete(id, req.user.id);
    return { success: true };
  }
}
