import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ConversationService } from './conversation.service';
import { MessageEntity } from './entities/message.entity';

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
  ) {
    this.maxHistoryLength = Number(this.config.get('CONVERSATION_MAX_HISTORY', 20));
    this.llm = new ChatOpenAI({
      apiKey: this.config.get('LLM_API_KEY'),
      modelName: this.config.get('LLM_MODEL_NAME', 'deepseek-chat'),
      temperature: 0.3,
      maxTokens: 500,
      configuration: {
        baseURL: this.config.get('LLM_BASE_URL'),
      },
    });
  }

  /**
   * 构建对话上下文
   */
  async buildContext(conversationId: string, currentQuery: string): Promise<ConversationContext> {
    // 获取历史消息
    let history = await this.conversationService.getHistory(
      conversationId,
      this.maxHistoryLength,
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
        .map(msg => {
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
   * 检测是否是追问
   */
  isFollowUpQuestion(query: string, history: MessageEntity[]): boolean {
    if (history.length === 0) return false;

    // 追问的特征
    const followUpPatterns = [
      /^(能|可以|请)?(再|更|详细|具体)(说说|解释|说明|展开)/,
      /^(那|那这|这)(个|些|方面)/,
      /^(继续|接着|然后)/,
      /^(为什么|怎么|如何)/,
      /^(还有|还有什么|其他的)/,
      /^(上面|刚才|之前)(提到|说的)/,
      /^[它他她这那](们)?(的|是|指)/,
    ];

    return followUpPatterns.some(pattern => pattern.test(query));
  }

  /**
   * 生成对话摘要
   */
  private async generateSummary(history: MessageEntity[]): Promise<string | undefined> {
    try {
      const historyText = history
        .slice(0, -5) // 排除最近的消息
        .map(msg => {
          const role = msg.role === 'user' ? '用户' : '助手';
          return `${role}: ${msg.content.substring(0, 100)}`;
        })
        .join('\n');

      const response = await this.llm.invoke([
        new SystemMessage('请将以下对话历史压缩为简洁的摘要，保留关键信息和主题。'),
        new HumanMessage(historyText),
      ]);

      return response.content as string;
    } catch (error) {
      this.logger.error(`生成对话摘要失败: ${error.message}`);
      return undefined;
    }
  }

  /**
   * 从历史中提取相关上下文
   */
  extractRelevantContext(query: string, history: MessageEntity[]): string {
    // 提取最近的用户问题和助手答案作为上下文
    const recentHistory = history.slice(-4);
    return recentHistory
      .map(msg => {
        const role = msg.role === 'user' ? '用户' : '助手';
        return `${role}: ${msg.content}`;
      })
      .join('\n');
  }
}
