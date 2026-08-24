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
