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
import { RagService } from './rag.service';
import { AgentOrchestrator } from './agent/agent-orchestrator.service';
import { ConversationService } from './conversation.service';
import { ContextManager } from './context-manager.service';
import { QueryRagDto } from './dto/query.dto';
import { AgentQueryDto } from './dto/agent-query.dto';
import { ChatDto, ConversationListDto } from './dto/chat.dto';
import { RagQueryResponseDto } from './dto/response.dto';
import { AgentQueryResponseDto } from './dto/agent-response.dto';
import { AguiEventType } from './types/agui.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

interface AuthenticatedRequest {
  user: {
    id: string;
  };
}

@Controller('rag')
@UseGuards(JwtAuthGuard)
export class RagController {
  private readonly logger = new Logger(RagController.name);

  constructor(
    private readonly ragService: RagService,
    private readonly agentOrchestrator: AgentOrchestrator,
    private readonly conversationService: ConversationService,
    private readonly contextManager: ContextManager,
  ) {}

  // ==================== 基础 RAG 查询 ====================

  /**
   * 单轮问答
   */
  @Post('query')
  async query(
    @Body() dto: QueryRagDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<RagQueryResponseDto> {
    return this.ragService.query(dto, req.user.id);
  }

  /**
   * 流式问答（SSE）
   */
  @Post('query/stream')
  @Sse('query/stream')
  async queryStream(
    @Body() dto: QueryRagDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Observable<MessageEvent>> {
    const subject = new Subject<MessageEvent>();

    (async () => {
      try {
        for await (const chunk of this.ragService.queryStream(
          dto,
          req.user.id,
        )) {
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

  // ==================== Agentic RAG ====================

  /**
   * Agentic RAG 问答
   */
  @Post('agent')
  async agentQuery(
    @Body() dto: AgentQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AgentQueryResponseDto> {
    return this.agentOrchestrator.query(dto.question, {
      maxIterations: dto.maxIterations,
      enableFollowUp: dto.enableFollowUp,
      userId: req.user.id,
      categoryId: dto.categoryId,
      teamId: dto.teamId,
    });
  }

  /**
   * Agentic RAG 流式问答（AGUI 规范）
   */
  @Post('agent/stream')
  @Sse('agent/stream')
  async agentStream(
    @Body() dto: AgentQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Observable<MessageEvent>> {
    const subject = new Subject<MessageEvent>();

    (async () => {
      try {
        for await (const event of this.agentOrchestrator.queryStream(
          dto.question,
          {
            maxIterations: dto.maxIterations,
            enableFollowUp: dto.enableFollowUp,
            userId: req.user.id,
            categoryId: dto.categoryId,
            teamId: dto.teamId,
          },
        )) {
          subject.next({
            data: JSON.stringify(event),
          } as MessageEvent);
        }
      } catch (error) {
        this.logger.error(`AGUI 流式查询失败: ${error.message}`);
        subject.next({
          data: JSON.stringify({
            type: AguiEventType.ERROR,
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

    (async () => {
      try {
        // 1. 获取或创建对话
        let conversationId = dto.conversationId;
        if (!conversationId) {
          const conversation = await this.conversationService.create(
            req.user.id,
          );
          conversationId = conversation.id;
        } else {
          await this.conversationService.findOneForUser(
            conversationId,
            req.user.id,
          );
        }

        // 2. 在保存当前消息前读取历史，避免当前问题参与自身的上下文改写。
        const context = await this.contextManager.buildContext(
          conversationId,
          dto.message,
        );

        // 3. 保存用户消息。先持久化，再告知客户端会话 ID，保证客户端刷新后
        // 能立即从会话历史列表中查询到该会话。
        await this.conversationService.addMessage(
          conversationId,
          'user',
          dto.message,
        );

        // 发送对话 ID
        subject.next({
          data: JSON.stringify({
            type: AguiEventType.METADATA,
            timestamp: Date.now(),
            conversationId,
          }),
        } as MessageEvent);

        // 4. 使用模型把依赖历史的问题改写为独立检索问题。
        const fullQuestion =
          await this.contextManager.rewriteQueryForRetrieval(context);

        // 5. 流式执行 Agentic RAG
        let answerText = '';
        let lastQueryId = '';
        let lastCitations: any[] = [];
        let lastConfidence = 0;

        for await (const event of this.agentOrchestrator.queryStream(
          fullQuestion,
          {
            maxIterations: dto.maxIterations,
            enableFollowUp: true,
            userId: req.user.id,
          },
        )) {
          subject.next({
            data: JSON.stringify(event),
          } as MessageEvent);

          // 收集答案信息
          if (event.type === AguiEventType.TEXT) {
            answerText += event.content;
          }
          if (event.type === AguiEventType.RETRIEVAL_RESULT) {
            lastCitations = event.chunks.map((c: any, i: number) => ({
              index: i + 1,
              chunkId: c.documentId,
              documentId: c.documentId,
              documentTitle: c.documentTitle,
              content: c.content,
              score: c.similarity,
            }));
          }
          if (event.type === AguiEventType.EVALUATION) {
            lastConfidence = event.relevance ?? 0;
          }
          if (event.type === AguiEventType.DONE) {
            lastQueryId = event.queryId;
          }
        }

        // 7. 保存助手消息
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
      } catch (error) {
        this.logger.error(`对话流式查询失败: ${error.message}`);
        subject.next({
          data: JSON.stringify({
            type: AguiEventType.ERROR,
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
