import { Controller, Post, Get, Delete, Body, Param, Query, Sse, Logger } from '@nestjs/common';
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

@Controller('rag')
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

  // ==================== Agentic RAG ====================

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
   * 多轮对话（支持上下文）
   */
  @Post('chat')
  async chat(@Body() dto: ChatDto) {
    // 1. 获取或创建对话
    let conversationId = dto.conversationId;
    if (!conversationId) {
      const conversation = await this.conversationService.create(dto.userId);
      conversationId = conversation.id;
    }

    // 2. 保存用户消息
    await this.conversationService.addMessage(conversationId, 'user', dto.message);

    // 3. 构建上下文
    const context = await this.contextManager.buildContext(conversationId, dto.message);

    // 4. 检测是否是追问
    const isFollowUp = this.contextManager.isFollowUpQuestion(dto.message, context.history);

    // 5. 构建完整问题（包含上下文）
    let fullQuestion = dto.message;
    if (isFollowUp && context.history.length > 0) {
      const relevantContext = this.contextManager.extractRelevantContext(dto.message, context.history);
      fullQuestion = `基于之前的对话：\n${relevantContext}\n\n当前问题：${dto.message}`;
    }

    // 6. 执行 Agentic RAG 查询
    const result = await this.agentOrchestrator.query(fullQuestion, {
      maxIterations: dto.maxIterations,
      enableFollowUp: true,
      userId: dto.userId,
    });

    // 7. 保存助手消息
    await this.conversationService.addMessage(conversationId, 'assistant', result.answer, {
      citations: result.citations,
      queryId: result.queryId,
      confidence: result.confidence,
    });

    return {
      conversationId,
      answer: result.answer,
      citations: result.citations,
      confidence: result.confidence,
      queryId: result.queryId,
    };
  }

  /**
   * 多轮对话流式（AGUI 规范）
   */
  @Post('chat/stream')
  @Sse('chat/stream')
  async chatStream(@Body() dto: ChatDto): Promise<Observable<MessageEvent>> {
    const subject = new Subject<MessageEvent>();

    (async () => {
      try {
        // 1. 获取或创建对话
        let conversationId = dto.conversationId;
        if (!conversationId) {
          const conversation = await this.conversationService.create(dto.userId);
          conversationId = conversation.id;
        }

        // 发送对话 ID
        subject.next({
          data: JSON.stringify({
            type: AguiEventType.METADATA,
            timestamp: Date.now(),
            data: { conversationId },
          }),
        } as MessageEvent);

        // 2. 保存用户消息
        await this.conversationService.addMessage(conversationId, 'user', dto.message);

        // 3. 构建上下文
        const context = await this.contextManager.buildContext(conversationId, dto.message);

        // 4. 检测是否是追问
        const isFollowUp = this.contextManager.isFollowUpQuestion(dto.message, context.history);

        // 5. 构建完整问题
        let fullQuestion = dto.message;
        if (isFollowUp && context.history.length > 0) {
          const relevantContext = this.contextManager.extractRelevantContext(dto.message, context.history);
          fullQuestion = `基于之前的对话：\n${relevantContext}\n\n当前问题：${dto.message}`;

          subject.next({
            data: JSON.stringify({
              type: AguiEventType.THINKING,
              timestamp: Date.now(),
              content: '检测到追问，已加载对话上下文',
            }),
          } as MessageEvent);
        }

        // 6. 流式执行 Agentic RAG
        let answerText = '';
        let lastQueryId = '';
        let lastCitations: any[] = [];
        let lastConfidence = 0;

        for await (const event of this.agentOrchestrator.queryStream(fullQuestion, {
          maxIterations: dto.maxIterations,
          enableFollowUp: true,
          userId: dto.userId,
        })) {
          subject.next({
            data: JSON.stringify(event),
          } as MessageEvent);

          // 收集答案信息
          if (event.type === AguiEventType.TEXT) {
            answerText += event.content;
          }
          if (event.type === AguiEventType.DONE) {
            lastQueryId = event.queryId;
          }
        }

        // 7. 保存助手消息
        await this.conversationService.addMessage(conversationId, 'assistant', answerText, {
          citations: lastCitations,
          queryId: lastQueryId,
          confidence: lastConfidence,
        });

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
  async getConversations(@Query() dto: ConversationListDto) {
    return this.conversationService.list(dto.userId, dto.page, dto.pageSize);
  }

  /**
   * 获取对话历史
   */
  @Get('conversations/:id/history')
  async getConversationHistory(@Param('id') id: string) {
    const conversation = await this.conversationService.findOne(id);
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
  async deleteConversation(@Param('id') id: string) {
    await this.conversationService.delete(id);
    return { success: true };
  }
}
