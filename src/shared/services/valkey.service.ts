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
              retries >= 5 ? false : Math.min(100 * 2 ** retries, 3_000),
          },
        })
      : null;
    this.client?.on('error', () => this.logDegraded());
  }

  async onModuleInit(): Promise<void> {
    if (!this.client) {
      this.logger.warn(
        'VALKEY_URL not configured; rate limits are instance-local',
      );
      return;
    }
    try {
      await this.client.connect();
      this.logger.log('Valkey connected; distributed rate limits enabled');
    } catch {
      this.logDegraded();
    }
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

  async isSessionRevoked(sessionId: string): Promise<boolean> {
    if (!this.client?.isReady) return false;
    try {
      return (await this.client.exists(`revoked:session:${sessionId}`)) === 1;
    } catch {
      this.logDegraded();
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client?.isOpen) await this.client.close();
  }

  private logDegraded(): void {
    const now = Date.now();
    if (now - this.lastFailureLogAt < 60_000) return;
    this.lastFailureLogAt = now;
    this.logger.warn('Valkey unavailable; using instance-local rate limits');
  }
}
