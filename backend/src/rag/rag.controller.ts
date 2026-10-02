import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  Logger,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  type UIMessage,
} from 'ai';
import { LangfuseClient } from '@langfuse/client';
import { LangfuseSpan, startActiveObservation } from '@langfuse/tracing';
import { AgentOrchestrator } from './agent/agent-orchestrator.service';
import { ConversationService } from './conversation.service';
import { ContextManager } from './context-manager.service';
import { LongTermMemoryService } from './long-term-memory.service';
import { ChatDto, ConversationListDto } from './dto/chat.dto';
import { AguiEventType, type AgentWorkflow } from './types/agui.types';
import type { Citation } from './types/rag.types';
import { isLangfuseTracingEnabled } from '../langfuse.config';

interface AuthenticatedRequest {
  user: {
    id: string;
  };
}

interface StreamCitation extends Citation {
  content: string;
  score: number;
}

interface ChatMessageMetadata {
  conversationId?: string;
  queryId?: string;
  totalIterations?: number;
}

type KnowledgeUIMessage = UIMessage<
  ChatMessageMetadata,
  {
    conversation: {
      conversationId: string;
      title: string;
    };
    status: {
      text: string;
    };
    workflow: AgentWorkflow;
    citations: StreamCitation[];
  }
>;

@Controller('rag')
export class RagController {
  private readonly logger = new Logger(RagController.name);
  private readonly langfuse = isLangfuseTracingEnabled
    ? new LangfuseClient()
    : undefined;

  constructor(
    private readonly agentOrchestrator: AgentOrchestrator,
    private readonly conversationService: ConversationService,
    private readonly contextManager: ContextManager,
    private readonly longTermMemoryService: LongTermMemoryService,
  ) {}

  // ==================== 多轮对话 ====================

  /** 多轮对话流式（Vercel AI SDK UI Message Stream 规范） */
  @Post('chat/stream')
  async chatStream(
    @Body() dto: ChatDto,
    @Req() req: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const stream = createUIMessageStream<KnowledgeUIMessage>({
      execute: async ({ writer }) => {
        await startActiveObservation('rag.chat.stream', async (span) => {
          const startedAt = Date.now();
          let textStarted = false;
          const textPartId = `text-${startedAt}`;
          const workflow: AgentWorkflow = {
            analysis: 'running',
            rounds: [],
            generation: 'pending',
            statusText: '正在分析用户问题...',
            completed: false,
          };
          const writeWorkflow = () => {
            writer.write({
              type: 'data-workflow',
              id: 'workflow',
              data: {
                ...workflow,
                rounds: workflow.rounds.map((round) => ({ ...round })),
              },
            });
          };
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

            writer.write({
              type: 'start',
              messageId: `assistant-${conversationId}-${startedAt}`,
              messageMetadata: { conversationId },
            });
            writer.write({
              type: 'data-conversation',
              id: 'conversation',
              data: {
                conversationId,
                title:
                  dto.message.length > 20
                    ? `${dto.message.substring(0, 20)}...`
                    : dto.message,
              },
              transient: true,
            });
            writeWorkflow();

            // 2. 在保存当前消息前读取短期历史。长期记忆会在 Agent 完成问题
            // 改写后，与知识库检索并行召回。
            const context =
              await this.contextManager.buildContext(conversationId);

            // 3. 保存用户消息。
            await this.conversationService.addMessage(
              conversationId,
              'user',
              dto.message,
            );

            // 4. 流式执行 Agentic RAG（含上下文改写、问题分析和检索）。
            let answerText = '';
            let lastQueryId = '';
            let lastCitations: StreamCitation[] = [];
            let didComplete = false;
            let streamError: string | undefined;
            let totalIterations = 0;
            let timeToFirstTextMs: number | undefined;

            for await (const event of this.agentOrchestrator.queryStream({
              question: dto.message,
              conversationId,
              userId: req.user.id,
              context,
              enableFollowUp: true,
            })) {
              // 收集答案信息
              if (event.type === AguiEventType.TEXT) {
                timeToFirstTextMs ??= Date.now() - startedAt;
                answerText += event.content;
                if (workflow.generation !== 'running') {
                  workflow.analysis = 'completed';
                  workflow.rounds.forEach((round) => {
                    round.status = 'completed';
                  });
                  workflow.generation = 'running';
                  workflow.statusText = '正在生成回答...';
                  writeWorkflow();
                }
                if (!textStarted) {
                  writer.write({
                    type: 'text-start',
                    id: textPartId,
                  });
                  textStarted = true;
                }
                writer.write({
                  type: 'text-delta',
                  id: textPartId,
                  delta: event.content,
                });
              }
              if (event.type === AguiEventType.THINKING) {
                workflow.statusText = event.content;
                writeWorkflow();
                writer.write({
                  type: 'data-status',
                  id: 'status',
                  data: { text: event.content },
                });
              }
              if (event.type === AguiEventType.ANALYSIS) {
                workflow.analysis = 'completed';
                writeWorkflow();
              }
              if (event.type === AguiEventType.RETRIEVAL_START) {
                workflow.rounds.forEach((round) => {
                  round.status = 'completed';
                });
                workflow.rounds.push({
                  iteration: workflow.rounds.length + 1,
                  source: event.searchType === 'web' ? 'web' : 'knowledge_base',
                  query: event.query,
                  status: 'running',
                });
                workflow.statusText =
                  event.searchType === 'web'
                    ? '正在联网搜索...'
                    : '正在检索知识库...';
                writeWorkflow();
              }
              if (event.type === AguiEventType.EVIDENCE_ASSESSMENT) {
                const round = workflow.rounds.at(-1);
                if (round) {
                  round.status = 'completed';
                  round.verdict = event.verdict;
                }
                writeWorkflow();
              }
              if (event.type === AguiEventType.GENERATION_START) {
                workflow.analysis = 'completed';
                workflow.rounds.forEach((round) => {
                  round.status = 'completed';
                });
                workflow.generation = 'running';
                writeWorkflow();
              }
              // 检索结果
              if (event.type === AguiEventType.RETRIEVAL_RESULT) {
                const round = workflow.rounds.at(-1);
                if (round) round.acceptedCount = event.chunks.length;
                writeWorkflow();
                lastCitations = event.chunks.map((chunk, index) => ({
                  index: index + 1,
                  chunkId: chunk.chunkId,
                  documentId: chunk.documentId,
                  documentTitle: chunk.documentTitle,
                  originalFileName: chunk.originalFileName,
                  fileSize: chunk.fileSize,
                  content: chunk.content,
                  score: chunk.similarity,
                  chunkContent: chunk.content,
                  heading: null,
                  similarity: chunk.similarity,
                  sourceType: chunk.sourceType,
                  sourceUrl: chunk.sourceUrl,
                }));
                writer.write({
                  type: 'data-citations',
                  id: 'citations',
                  data: lastCitations,
                });
              }
              if (event.type === AguiEventType.DONE) {
                lastQueryId = event.queryId;
                totalIterations = event.totalIterations;
                didComplete = true;
                workflow.analysis = 'completed';
                workflow.rounds.forEach((round) => {
                  round.status = 'completed';
                });
                workflow.generation = 'completed';
                workflow.statusText = '流程完成';
                workflow.completed = true;
                writeWorkflow();
              }
              if (event.type === AguiEventType.ERROR) {
                streamError = event.message;
                writer.write({
                  type: 'error',
                  errorText: event.message,
                });
              }
            }

            if (textStarted) {
              writer.write({
                type: 'text-end',
                id: textPartId,
              });
              textStarted = false;
            }
            writer.write({
              type: 'data-status',
              id: 'status',
              data: { text: '' },
            });

            // queryStream 会将 Agent 内部异常转为 ERROR 事件，因此不能仅依赖 catch
            // 判断请求是否成功；没有 DONE 的流也不能保存为一条正常的助手消息。
            if (streamError || !didComplete) {
              this.recordRequestSuccess(span, false, {
                conversationId,
                queryId: lastQueryId || undefined,
                reason: streamError ?? 'stream_completed_without_done',
                totalMs: Date.now() - startedAt,
                ...(timeToFirstTextMs !== undefined
                  ? { timeToFirstTextMs }
                  : {}),
              });
              writer.write({
                type: 'finish',
                finishReason: 'error',
                messageMetadata: { conversationId },
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
                workflow,
              },
            );

            this.recordRequestSuccess(span, true, {
              conversationId,
              queryId: lastQueryId,
              totalIterations,
              totalMs: Date.now() - startedAt,
              ...(timeToFirstTextMs !== undefined ? { timeToFirstTextMs } : {}),
            });

            writer.write({
              type: 'finish',
              finishReason: 'stop',
              messageMetadata: {
                conversationId,
                queryId: lastQueryId,
                totalIterations,
              },
            });

            // 主请求已成功完成后再异步提交长期记忆，避免 Mem0 网络耗时拖慢
            // SSE 连接结束。remember 内部负责超时和错误日志，不向主链路抛错。
            void this.longTermMemoryService.remember(
              req.user.id,
              conversationId,
              dto.message,
            );
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.error(`对话流式查询失败: ${message}`);
            this.recordRequestSuccess(span, false, {
              reason: message,
              totalMs: Date.now() - startedAt,
            });
            if (textStarted) {
              writer.write({
                type: 'text-end',
                id: textPartId,
              });
            }
            writer.write({
              type: 'error',
              errorText: message,
            });
            writer.write({
              type: 'finish',
              finishReason: 'error',
            });
          }
        });
      },
      onError: (error) =>
        error instanceof Error ? error.message : '对话流式查询失败',
    });

    await pipeUIMessageStreamToResponse({ response, stream });
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
