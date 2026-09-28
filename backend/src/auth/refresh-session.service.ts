import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import Redis from 'ioredis';

interface RefreshSession {
  userId: string;
  createdAt: string;
  persistent: boolean;
}

/**
 * Refresh token 会话仅保存在 Redis。令牌本身是随机值，Redis 只保存其 SHA-256
 * 哈希并依靠 TTL 自动过期；Redis 不可用时刷新失败而非降级为不可撤销的令牌。
 */
@Injectable()
export class RefreshSessionService implements OnModuleInit, OnModuleDestroy {
  private readonly ttlSeconds: number;
  private readonly keyPrefix: string;
  private client: Redis | null = null;
  private ready = false;

  constructor(private readonly config: ConfigService) {
    this.ttlSeconds = this.positiveNumber('REFRESH_TOKEN_TTL_SECONDS', 604_800);
    this.keyPrefix = config.get<string>('REFRESH_TOKEN_KEY_PREFIX', 'kh:refresh:');
  }

  async onModuleInit() {
    this.client = new Redis({
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: Number(this.config.get<string>('REDIS_PORT', '6379')),
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
      db: Number(this.config.get<string>('REDIS_DB', '0')),
      connectTimeout: Number(this.config.get<string>('REDIS_CONNECT_TIMEOUT_MS', '3000')),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    this.client.on('error', () => {
      this.ready = false;
    });

    try {
      await this.client.connect();
      this.ready = true;
    } catch {
      this.client.disconnect();
      this.client = null;
    }
  }

  async onModuleDestroy() {
    const client = this.client;
    this.client = null;
    this.ready = false;
    if (client) await client.quit().catch(() => client.disconnect());
  }

  async create(userId: string, persistent: boolean): Promise<string> {
    const token = randomBytes(48).toString('base64url');
    await this.redis().set(
      this.key(token),
      JSON.stringify({ userId, createdAt: new Date().toISOString(), persistent } satisfies RefreshSession),
      'EX',
      this.ttlSeconds,
    );
    return token;
  }

  /** 原子消费旧 token，防止同一个 refresh token 被并发重放。 */
  async consume(token: string): Promise<RefreshSession> {
    let raw: string | null;
    try {
      raw = await this.redis().getdel(this.key(token));
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('登录会话暂不可用');
    }
    if (!raw) throw new UnauthorizedException('登录已过期，请重新登录');

    try {
      const session: unknown = JSON.parse(raw);
      if (
        !session ||
        typeof session !== 'object' ||
        !('userId' in session) ||
        typeof session.userId !== 'string' ||
        !('createdAt' in session) ||
        typeof session.createdAt !== 'string' ||
        ('persistent' in session && typeof session.persistent !== 'boolean')
      ) {
        throw new Error('invalid refresh session');
      }
      return {
        userId: session.userId,
        createdAt: session.createdAt,
        // 兼容升级前已签发的 refresh session：它们原本就是持久会话。
        persistent: !('persistent' in session) || session.persistent !== false,
      };
    } catch {
      throw new UnauthorizedException('登录会话无效，请重新登录');
    }
  }

  async revoke(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.redis().del(this.key(token));
  }

  getTtlSeconds() {
    return this.ttlSeconds;
  }

  private redis(): Redis {
    if (!this.ready || !this.client) {
      throw new ServiceUnavailableException('登录会话暂不可用');
    }
    return this.client;
  }

  private key(token: string) {
    return `${this.keyPrefix}${createHash('sha256').update(token).digest('hex')}`;
  }

  private positiveNumber(name: string, fallback: number) {
    const value = Number(this.config.get<string>(name, String(fallback)));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}
