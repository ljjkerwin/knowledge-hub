import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RoleCode } from './entities/role.entity';

export interface AuthorizationSnapshot {
  id: string;
  username: string;
  roles: RoleCode[];
}

/**
 * 用户授权快照的两级缓存。
 *
 * L1 为单个 Node 进程内存，L2 为 Redis。Redis Pub/Sub 只用于尽快清理
 * 各实例的 L1；即使通知遗漏，L1 TTL 到期后仍会从 L2 / PostgreSQL 恢复。
 */
@Injectable()
export class AuthorizationCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthorizationCacheService.name);
  private readonly l1 = new Map<
    string,
    { value: AuthorizationSnapshot; expiresAt: number }
  >();
  private readonly inFlight = new Map<string, Promise<AuthorizationSnapshot | null>>();
  private readonly enabled: boolean;
  private readonly l1TtlMs: number;
  private readonly l2TtlSeconds: number;
  private readonly keyPrefix: string;
  private readonly invalidateChannel: string;
  private client: Redis | null = null;
  private subscriber: Redis | null = null;
  private redisReady = false;
  private redisUnavailableLogged = false;

  constructor(private readonly config: ConfigService) {
    this.enabled = config.get<string>('AUTHZ_CACHE_ENABLED', 'true') !== 'false';
    this.l1TtlMs = Math.max(
      1_000,
      Number(config.get<string>('AUTHZ_L1_TTL_MS', '60000')),
    );
    this.l2TtlSeconds = Math.max(
      1,
      Number(config.get<string>('AUTHZ_L2_TTL_SECONDS', '600')),
    );
    this.keyPrefix = config.get<string>('AUTHZ_CACHE_KEY_PREFIX', 'kh:authz:');
    this.invalidateChannel = config.get<string>(
      'AUTHZ_INVALIDATE_CHANNEL',
      'kh:authz:invalidate',
    );
  }

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.log('授权缓存已禁用（AUTHZ_CACHE_ENABLED=false）');
      return;
    }

    const options = {
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: Number(this.config.get<string>('REDIS_PORT', '6379')),
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
      db: Number(this.config.get<string>('REDIS_DB', '0')),
      connectTimeout: Number(
        this.config.get<string>('REDIS_CONNECT_TIMEOUT_MS', '3000'),
      ),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    };

    this.client = new Redis(options);
    this.subscriber = new Redis(options);
    const onError = (error: Error) => this.markRedisUnavailable(error);
    this.client.on('error', onError);
    this.subscriber.on('error', onError);

    try {
      await Promise.all([this.client.connect(), this.subscriber.connect()]);
      await this.subscriber.subscribe(this.invalidateChannel);
      this.subscriber.on('message', (channel, message) => {
        if (channel !== this.invalidateChannel) return;
        const userId = this.parseInvalidationMessage(message);
        if (userId) this.l1.delete(userId);
      });
      this.redisReady = true;
      this.logger.log('授权缓存 Redis L2 与失效订阅已就绪');
    } catch (error) {
      this.markRedisUnavailable(error);
      await this.closeRedisClients();
    }
  }

  async onModuleDestroy() {
    await this.closeRedisClients();
  }

  async get(
    userId: string,
    loader: () => Promise<AuthorizationSnapshot | null>,
  ): Promise<AuthorizationSnapshot | null> {
    const l1Hit = this.l1.get(userId);
    if (l1Hit && l1Hit.expiresAt > Date.now()) return l1Hit.value;
    this.l1.delete(userId);

    const pending = this.inFlight.get(userId);
    if (pending) return pending;

    const load = this.load(userId, loader).finally(() => this.inFlight.delete(userId));
    this.inFlight.set(userId, load);
    return load;
  }

  /** 角色、用户状态或授权版本变更后的统一失效入口。 */
  async invalidate(userId: string): Promise<void> {
    this.l1.delete(userId);
    if (!this.redisReady || !this.client) return;

    try {
      await this.client.del(this.key(userId));
      await this.client.publish(this.invalidateChannel, JSON.stringify({ userId }));
    } catch (error) {
      this.markRedisUnavailable(error);
    }
  }

  private async load(
    userId: string,
    loader: () => Promise<AuthorizationSnapshot | null>,
  ): Promise<AuthorizationSnapshot | null> {
    const cached = await this.getFromRedis(userId);
    if (cached) return this.putL1(cached);

    const snapshot = await loader();
    if (!snapshot) return null;
    this.putL1(snapshot);
    await this.putRedis(snapshot);
    return snapshot;
  }

  private async getFromRedis(userId: string): Promise<AuthorizationSnapshot | null> {
    if (!this.redisReady || !this.client) return null;
    try {
      const raw = await this.client.get(this.key(userId));
      if (!raw) return null;
      const value: unknown = JSON.parse(raw);
      if (!this.isSnapshot(value) || value.id !== userId) return null;
      return value;
    } catch (error) {
      this.markRedisUnavailable(error);
      return null;
    }
  }

  private async putRedis(snapshot: AuthorizationSnapshot): Promise<void> {
    if (!this.redisReady || !this.client) return;
    try {
      await this.client.set(
        this.key(snapshot.id),
        JSON.stringify(snapshot),
        'EX',
        this.l2TtlSeconds,
      );
    } catch (error) {
      this.markRedisUnavailable(error);
    }
  }

  private putL1(snapshot: AuthorizationSnapshot): AuthorizationSnapshot {
    this.l1.set(snapshot.id, {
      value: snapshot,
      expiresAt: Date.now() + this.l1TtlMs,
    });
    return snapshot;
  }

  private key(userId: string) {
    return `${this.keyPrefix}${userId}`;
  }

  private parseInvalidationMessage(message: string): string | null {
    try {
      const payload: unknown = JSON.parse(message);
      if (
        payload &&
        typeof payload === 'object' &&
        'userId' in payload &&
        typeof payload.userId === 'string'
      ) {
        return payload.userId;
      }
    } catch {
      // 非法消息不影响订阅循环。
    }
    return null;
  }

  private isSnapshot(value: unknown): value is AuthorizationSnapshot {
    return Boolean(
      value &&
        typeof value === 'object' &&
        'id' in value &&
        typeof value.id === 'string' &&
        'username' in value &&
        typeof value.username === 'string' &&
        'roles' in value &&
        Array.isArray(value.roles) &&
        value.roles.every((role) => typeof role === 'string'),
    );
  }

  private markRedisUnavailable(error: unknown) {
    this.redisReady = false;
    if (!this.redisUnavailableLogged) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`授权缓存 Redis 不可用，已回退 PostgreSQL：${message}`);
      this.redisUnavailableLogged = true;
    }
  }

  private async closeRedisClients() {
    const clients = [this.client, this.subscriber].filter(
      (client): client is Redis => client !== null,
    );
    this.client = null;
    this.subscriber = null;
    this.redisReady = false;
    await Promise.all(clients.map((client) => client.quit().catch(() => client.disconnect())));
  }
}
