import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ConversationService } from './conversation.service';
import { MessageEntity } from './entities/message.entity';
import { LlmService } from '../llm/llm.service';
import { ChatOpenAI } from '@langchain/openai';

// 对话上下文
export interface ConversationContext {
  history: MessageEntity[];
  currentQuery: string;
  summary?: string;
  conversationId: string;
}

@Injectable()
export class ContextManager {
  private readonly logger = new Logger(ContextManager.name);
  private readonly maxHistoryLength: number;
  private readonly llm: ChatOpenAI;

  constructor(
    private readonly conversationService: ConversationService,
    private readonly config: ConfigService,
    private readonly llmService: LlmService,
  ) {
    this.maxHistoryLength = Number(
      this.config.get('CONVERSATION_MAX_HISTORY', 20),
    );
    this.llm = this.llmService.create({
      temperature: 0,
      maxTokens: 300,
    });
  }

  /**
   * 构建对话上下文
   */
  async buildContext(
    conversationId: string,
    currentQuery: string,
  ): Promise<ConversationContext> {
    // 多取一条，用于判断是否需要摘要；调用方必须在写入当前消息前调用此方法。
    let history = await this.conversationService.getHistory(
      conversationId,
      this.maxHistoryLength + 1,
    );

    // 如果历史消息过多，生成摘要
    let summary: string | undefined;
    if (history.length > this.maxHistoryLength) {
      summary = await this.generateSummary(history);
      // 只保留最近的消息
      history = history.slice(-10);
    }

    return {
      history,
      currentQuery,
      summary,
      conversationId,
    };
  }

  /**
   * 将依赖上下文的当前问题改写为可独立检索的问题。
   * 独立问题保持原样，模型不可回答问题或补充历史中不存在的事实。
   */
  async rewriteQueryForRetrieval(
    context: ConversationContext,
  ): Promise<string> {
    if (context.history.length === 0 && !context.summary) {
      return context.currentQuery;
    }

    try {
      const response = await this.llm.invoke([
        new SystemMessage(`你是检索查询改写器。根据给定的对话摘要和历史，将“当前问题”改写成脱离上下文也能理解、可直接用于知识库检索的单句问题。

规则：
1. 若当前问题不依赖历史，必须原样返回当前问题。
2. 若问题含有指代、省略或相对时间，只能用历史中明确出现的信息补全。
3. 不得回答问题、解释改写过程、添加历史中没有的事实，也不得输出任何标签或引号。
4. 无法可靠补全时，保留原问题。`),
        new HumanMessage(this.buildConversationalPrompt(context)),
      ]);
      const rewritten =
        typeof response.content === 'string' ? response.content.trim() : '';

      if (!rewritten || rewritten.length > 1000) {
        return context.currentQuery;
      }

      return rewritten;
    } catch (error) {
      this.logger.warn(`查询改写失败，将使用原问题: ${error.message}`);
      return context.currentQuery;
    }
  }

  /**
   * 生成对话式 prompt
   */
  buildConversationalPrompt(context: ConversationContext): string {
    const parts: string[] = [];

    // 添加摘要（如果有）
    if (context.summary) {
      parts.push(`## 对话摘要\n${context.summary}`);
    }

    // 添加历史对话
    if (context.history.length > 0) {
      const historyText = context.history
        .map((msg) => {
          const role = msg.role === 'user' ? '用户' : '助手';
          return `${role}: ${msg.content}`;
        })
        .join('\n\n');
      parts.push(`## 历史对话\n${historyText}`);
    }

    // 添加当前问题
    parts.push(`## 当前问题\n${context.currentQuery}`);

    return parts.join('\n\n');
  }

  /**
   * 生成对话摘要
   */
  private async generateSummary(
    history: MessageEntity[],
  ): Promise<string | undefined> {
    try {
      const historyText = history
        .slice(0, -5) // 排除最近的消息
        .map((msg) => {
          const role = msg.role === 'user' ? '用户' : '助手';
          return `${role}: ${msg.content.substring(0, 100)}`;
        })
        .join('\n');

      const response = await this.llm.invoke([
        new SystemMessage(
          '请将以下对话历史压缩为简洁的摘要，保留关键信息和主题。',
        ),
        new HumanMessage(historyText),
      ]);

      return response.content as string;
    } catch (error) {
      this.logger.error(`生成对话摘要失败: ${error.message}`);
      return undefined;
    }
  }
}
