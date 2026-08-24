import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import amqp, {
  AmqpConnectionManager,
  ChannelWrapper,
} from 'amqp-connection-manager';
import { ConfirmChannel, ConsumeMessage } from 'amqplib';
import {
  KG_GRAPH_EXCHANGE,
  KG_GRAPH_QUEUE,
  KG_RK_BUILD_BY_IDS,
  KG_RK_DELETE,
  RAG_REINDEX_EXCHANGE,
  RAG_REINDEX_QUEUE,
  RAG_RK_BY_IDS,
  RAG_RK_DELETE,
  SEARCH_INDEX_EXCHANGE,
  SEARCH_INDEX_QUEUE,
  SEARCH_RK_DELETE,
  SEARCH_RK_INDEX,
} from './mq.constants';

export type MessageHandler = (msg: ConsumeMessage) => Promise<void> | void;

@Injectable()
export class RabbitMqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqService.name);
  private readonly maxRetryCount = 1;
  private connection: AmqpConnectionManager | null = null;
  private channel: ChannelWrapper | null = null;
  private readonly enabled: boolean;
  private readonly handlers = new Map<string, MessageHandler>();

  constructor(private readonly config: ConfigService) {
    this.enabled =
      this.config.get<string>('RABBITMQ_ENABLED', 'true') !== 'false';
  }

  get isEnabled() {
    return this.enabled;
  }

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.warn('RabbitMQ 已禁用（RABBITMQ_ENABLED=false）');
      return;
    }

    const url = this.config.get<string>(
      'RABBITMQ_URL',
      'amqp://guest:guest@localhost:5672',
    );
    const safeUrl = this.redactAmqpUrl(url);
    const timeoutMs = Number(
      this.config.get<string>('RABBITMQ_CONNECT_TIMEOUT_MS', '15000'),
    );

    this.logger.log(`正在连接 RabbitMQ：${safeUrl}（超时 ${timeoutMs}ms）`);

    this.connection = amqp.connect([url]);
    this.connection.on('connect', (arg) => {
      const connectedUrl =
        typeof arg === 'object' && arg && 'url' in arg
          ? String((arg as { url?: string }).url ?? url)
          : url;
      this.logger.log(`RabbitMQ 已连接：${this.redactAmqpUrl(connectedUrl)}`);
    });
    this.connection.on('disconnect', (err) =>
      this.logger.warn(`RabbitMQ 断开：${this.errorMessage(err?.err ?? err)}`),
    );
    this.connection.on('connectFailed', (err) =>
      this.logger.error(
        `RabbitMQ 连接失败：${this.errorMessage(err?.err ?? err)}（url=${safeUrl}）`,
      ),
    );

    this.channel = this.connection.createChannel({
      json: true,
      setup: async (ch: ConfirmChannel) => {
        this.logger.log('RabbitMQ channel setup：声明拓扑并绑定消费者');
        // 初始化mq的交换机、对列
        await this.assertTopology(ch);
        // 绑定消费者
        await this.bindConsumers(ch);
      },
    });

    try {
      await Promise.race([
        this.channel.waitForConnect(),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(
              new Error(
                `RabbitMQ 连接超时（${timeoutMs}ms）：${safeUrl}。请检查服务是否启动、5672 是否被其他容器占用、账号密码是否正确`,
              ),
            );
          }, timeoutMs);
        }),
      ]);
      this.logger.log('RabbitMQ channel 就绪');
    } catch (error) {
      const message = this.errorMessage(error);
      this.logger.error(`RabbitMQ 初始化失败：${message}`);
      await this.connection.close().catch(() => undefined);
      this.connection = null;
      this.channel = null;
      throw error;
    }
  }

  /** 日志里隐藏 AMQP 密码 */
  private redactAmqpUrl(url: string) {
    return url.replace(/\/\/([^:/@]+):([^@]+)@/, '//$1:***@');
  }

  private errorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (
      typeof error === 'object' &&
      error &&
      'message' in error &&
      typeof error.message === 'string'
    ) {
      return (error as { message: string }).message;
    }
    return String(error ?? 'unknown');
  }

  async onModuleDestroy() {
    await this.channel?.close();
    await this.connection?.close();
  }

  /** 注册队列消费者（在模块 init 前/后均可；连接就绪后生效） */
  registerHandler(queue: string, handler: MessageHandler) {
    this.handlers.set(queue, handler);
  }

  async publish(
    exchange: string,
    routingKey: string,
    payload: unknown,
  ): Promise<boolean> {
    if (!this.enabled || !this.channel) {
      this.logger.warn(
        `跳过发消息（MQ 不可用）：exchange=${exchange}, rk=${routingKey}`,
      );
      return false;
    }

    try {
      await this.channel.publish(exchange, routingKey, payload, {
        contentType: 'application/json',
        persistent: true,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `发消息失败：exchange=${exchange}, rk=${routingKey}, error=${message}`,
      );
      return false;
    }
  }

  private async assertTopology(ch: ConfirmChannel) {
    await ch.assertExchange(RAG_REINDEX_EXCHANGE, 'topic', { durable: true });
    await ch.assertQueue(RAG_REINDEX_QUEUE, { durable: true });
    await ch.bindQueue(RAG_REINDEX_QUEUE, RAG_REINDEX_EXCHANGE, RAG_RK_BY_IDS);
    await ch.bindQueue(RAG_REINDEX_QUEUE, RAG_REINDEX_EXCHANGE, RAG_RK_DELETE);

    await ch.assertExchange(SEARCH_INDEX_EXCHANGE, 'topic', { durable: true });
    await ch.assertQueue(SEARCH_INDEX_QUEUE, { durable: true });
    await ch.bindQueue(
      SEARCH_INDEX_QUEUE,
      SEARCH_INDEX_EXCHANGE,
      SEARCH_RK_INDEX,
    );
    await ch.bindQueue(
      SEARCH_INDEX_QUEUE,
      SEARCH_INDEX_EXCHANGE,
      SEARCH_RK_DELETE,
    );

    await ch.assertExchange(KG_GRAPH_EXCHANGE, 'topic', { durable: true });
    await ch.assertQueue(KG_GRAPH_QUEUE, { durable: true });
    await ch.bindQueue(KG_GRAPH_QUEUE, KG_GRAPH_EXCHANGE, KG_RK_BUILD_BY_IDS);
    await ch.bindQueue(KG_GRAPH_QUEUE, KG_GRAPH_EXCHANGE, KG_RK_DELETE);

    this.logger.log('RabbitMQ 拓扑已声明（RAG + Search + KG）');
  }

  private async bindConsumers(ch: ConfirmChannel) {
    // 每个队列的 consumer 各自最多保留一条未确认消息。handler 完成并 ACK/NACK
    // 前，该队列不会再投递下一条；不同队列仍可并行处理。
    await ch.prefetch(1);

    for (const [queue, handler] of this.handlers.entries()) {
      await ch.consume(queue, async (msg) => {
        if (!msg) return;
        // console.log('consume',msg)
        try {
          await handler(msg);
          ch.ack(msg);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          const retryCount = Number(
            msg.properties.headers?.['x-retry-count'] ?? 0,
          );
          if (retryCount < this.maxRetryCount) {
            this.logger.warn(
              `消费失败，准备第 ${retryCount + 1}/${this.maxRetryCount} 次重试 queue=${queue}: ${message}`,
            );
            // 显式记录重试次数，避免只用 redelivered 标记时无法区分第 2、3 次投递。
            try {
              await new Promise<void>((resolve, reject) => {
                ch.sendToQueue(
                  queue,
                  msg.content,
                  {
                    ...msg.properties,
                    headers: {
                      ...msg.properties.headers,
                      'x-retry-count': retryCount + 1,
                    },
                  },
                  (publishError) => {
                    if (publishError) reject(publishError);
                    else resolve();
                  },
                );
              });
              ch.ack(msg);
            } catch (publishError) {
              this.logger.error(
                `重试消息发布失败，原消息重新入队 queue=${queue}: ${this.errorMessage(publishError)}`,
              );
              ch.nack(msg, false, true);
            }
            return;
          }

          this.logger.error(
            `消费第 ${retryCount + 1} 次失败，拒绝消息 queue=${queue}: ${message}`,
          );
          // 已达到重试上限，不再重新入队，避免异常消息无限循环。
          ch.nack(msg, false, false);
        }
      });
      this.logger.log(`已注册消费者：${queue}`);
    }
  }
}
