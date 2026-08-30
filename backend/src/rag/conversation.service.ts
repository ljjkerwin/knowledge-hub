import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import SnowflakeId from 'snowflake-id';
import { ConversationEntity } from './entities/conversation.entity';
import { MessageEntity } from './entities/message.entity';
import { Citation } from './types/rag.types';

// 对话列表响应
export interface ConversationList {
  items: ConversationEntity[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);
  /**
   * Snowflake 的序列号状态必须在进程内共享。若每次创建会话/消息都新建实例，
   * 并发请求可能在同一毫秒得到相同 ID，触发数据库主键冲突。
   */
  private readonly snowflake = new SnowflakeId();

  constructor(
    @InjectEntityManager()
    private readonly em: EntityManager,
  ) {}

  /**
   * 创建对话
   */
  async create(userId: string, title?: string): Promise<ConversationEntity> {
    const conversation = this.em.create(ConversationEntity, {
      id: this.generateId(),
      userId,
      title: title || '新对话',
    });

    await this.em.save(conversation);
    this.logger.log(`创建对话: ${conversation.id}`);
    return conversation;
  }

  /**
   * 获取对话列表
   */
  async list(
    userId: string,
    page = 1,
    pageSize = 20,
  ): Promise<ConversationList> {
    const qb = this.em
      .createQueryBuilder(ConversationEntity, 'c')
      .where('c.deleted = :deleted', { deleted: false })
      .orderBy('c.updated_at', 'DESC');

    qb.andWhere('c.user_id = :userId', { userId });

    const [items, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return { items, total, page, pageSize };
  }

  /**
   * 获取单个对话
   */
  async findOne(id: string): Promise<ConversationEntity> {
    const conversation = await this.em.findOne(ConversationEntity, {
      where: { id, deleted: false },
    });

    if (!conversation) {
      throw new NotFoundException(`对话 ${id} 不存在`);
    }

    return conversation;
  }

  /**
   * 获取当前用户拥有的会话，避免通过猜测会话 ID 访问他人记录。
   */
  async findOneForUser(
    id: string,
    userId: string,
  ): Promise<ConversationEntity> {
    const conversation = await this.em.findOne(ConversationEntity, {
      where: { id, userId, deleted: false },
    });

    if (!conversation) {
      throw new NotFoundException(`对话 ${id} 不存在`);
    }

    return conversation;
  }

  /**
   * 获取对话历史
   */
  async getHistory(
    conversationId: string,
    limit = 50,
  ): Promise<MessageEntity[]> {
    return this.em.find(MessageEntity, {
      where: { conversationId },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  /**
   * 获取尚未进入长期摘要的消息。消息 ID 为 Snowflake ID，按其递增顺序即消息顺序。
   */
  async getHistoryAfter(
    conversationId: string,
    afterMessageId?: string | null,
  ): Promise<MessageEntity[]> {
    const qb = this.em
      .createQueryBuilder(MessageEntity, 'message')
      .where('message.conversation_id = :conversationId', { conversationId });

    if (afterMessageId) {
      qb.andWhere('message.id > :afterMessageId', { afterMessageId });
    }

    return qb.orderBy('message.id', 'ASC').getMany();
  }

  /** 保存滚动摘要及其已覆盖的消息边界。 */
  async updateContextSummary(
    conversationId: string,
    contextSummary: string,
    summaryUntilMessageId: string,
  ): Promise<void> {
    await this.em.update(ConversationEntity, conversationId, {
      contextSummary,
      summaryUntilMessageId,
    });
  }

  /**
   * 添加消息
   */
  async addMessage(
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    metadata?: {
      citations?: Citation[];
      queryId?: string;
    },
  ): Promise<MessageEntity> {
    const message = this.em.create(MessageEntity, {
      id: this.generateId(),
      conversationId,
      role,
      content,
      citations: metadata?.citations,
      queryId: metadata?.queryId,
    });

    await this.em.save(message);

    // 更新对话的更新时间
    await this.em.update(ConversationEntity, conversationId, {
      updatedAt: new Date(),
    });

    // 如果是用户消息且对话标题是默认值，自动生成标题
    if (role === 'user') {
      const conversation = await this.findOne(conversationId);
      if (conversation.title === '新对话') {
        const title =
          content.length > 20 ? content.substring(0, 20) + '...' : content;
        await this.em.update(ConversationEntity, conversationId, { title });
      }
    }

    return message;
  }

  /**
   * 删除对话（软删除）
   */
  async delete(id: string, userId: string): Promise<void> {
    const conversation = await this.findOneForUser(id, userId);
    conversation.deleted = true;
    await this.em.save(conversation);
    this.logger.log(`删除对话: ${id}`);
  }

  /**
   * 生成对话 ID
   */
  generateId(): string {
    return this.snowflake.generate().toString();
  }
}
