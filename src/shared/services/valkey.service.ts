import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';

export interface RateLimitBucket {
  key: string;
  max: number;
  ttlSeconds: number;
}

@Injectable()
export class ValkeyService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ValkeyService.name);
  private readonly client: RedisClientType | null;
  private lastFailureLogAt = 0;

  constructor() {
    const url = process.env.VALKEY_URL;
    this.client = url
      ? createClient({
          url,
          socket: {
            connectTimeout: 5_000,
            reconnectStrategy: (retries) =>
              Math.min(250 * 2 ** Math.min(retries, 4), 5_000),
          },
        })
      : null;
    this.client?.on('error', (error) => this.logDegraded(error));
  }

  onModuleInit(): void {
    if (!this.client) {
      this.logger.warn(
        'VALKEY_URL not configured; rate limits are instance-local',
      );
      return;
    }
    void this.client
      .connect()
      .then(() =>
        this.logger.log('Valkey connected; distributed rate limits enabled'),
      )
      .catch((error: unknown) => this.logDegraded(error));
  }

  async enforce(buckets: RateLimitBucket[]): Promise<boolean | null> {
    if (!this.client?.isReady) return null;

    const script = `
      for i = 1, #KEYS do
        local current = tonumber(redis.call('GET', KEYS[i]) or '0')
        if current >= tonumber(ARGV[(i - 1) * 2 + 1]) then return 0 end
      end
      for i = 1, #KEYS do
        redis.call('INCR', KEYS[i])
        redis.call('EXPIRE', KEYS[i], ARGV[(i - 1) * 2 + 2])
      end
      return 1
    `;

    try {
      const result = await this.client.eval(script, {
        keys: buckets.map((bucket) => bucket.key),
        arguments: buckets.flatMap((bucket) => [
          String(bucket.max),
          String(bucket.ttlSeconds),
        ]),
      });
      return Number(result) === 1;
    } catch {
      this.logDegraded();
      return null;
    }
  }

  async revokeSession(
    sessionId: string,
    ttlSeconds = 86_400,
  ): Promise<boolean> {
    if (!this.client?.isReady) return false;
    try {
      await this.client.set(`revoked:session:${sessionId}`, '1', {
        expiration: { type: 'EX', value: ttlSeconds },
      });
      return true;
    } catch {
      this.logDegraded();
      return false;
    }
  }

  async isSessionRevoked(sessionId: string): Promise<boolean | null> {
    if (!this.client?.isReady) return null;
    try {
      return (await this.client.exists(`revoked:session:${sessionId}`)) === 1;
    } catch (error) {
      this.logDegraded(error);
      return null;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client?.isOpen) await this.client.close();
  }

  private logDegraded(error?: unknown): void {
    const now = Date.now();
    if (now - this.lastFailureLogAt < 60_000) return;
    this.lastFailureLogAt = now;
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : 'UNKNOWN';
    this.logger.error(
      `Valkey unavailable (${code}); using database session verification and instance-local rate limits`,
    );
  }
}
