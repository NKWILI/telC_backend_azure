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

  /**
   * Admission control for a pool of concurrent, self-expiring slots.
   *
   * Used by the Elena live sessions, where the browser talks to Gemini directly
   * and the backend therefore never learns that a session ended. Decrementing on
   * release would leak a slot every time a tab closed, so slots are stored with
   * their start time and anything older than `ttlSeconds` is evicted on read.
   * A crashed or abandoned session frees itself.
   *
   * Returns true when the slot was granted, false when the pool is full, and
   * null when Valkey is unavailable so the caller can fall back to a local count.
   */
  async trackConcurrent(
    key: string,
    member: string,
    max: number,
    ttlSeconds: number,
  ): Promise<boolean | null> {
    if (!this.client?.isReady) return null;

    const script = `
      local now = tonumber(ARGV[1])
      redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - tonumber(ARGV[2]))
      if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
      redis.call('ZADD', KEYS[1], now, ARGV[4])
      redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
      return 1
    `;

    try {
      const result = await this.client.eval(script, {
        keys: [key],
        arguments: [
          String(Math.floor(Date.now() / 1000)),
          String(ttlSeconds),
          String(max),
          member,
        ],
      });
      return Number(result) === 1;
    } catch {
      this.logDegraded();
      return null;
    }
  }

  /**
   * Reads how many {@link trackConcurrent} slots are currently held, evicting
   * expired ones first. Takes no slot itself.
   *
   * Exists so a caller can refuse a request on a full pool without touching any
   * shared counter. Admission still goes through `trackConcurrent`, which is
   * atomic; this is only the cheap look before that.
   */
  async countConcurrent(
    key: string,
    ttlSeconds: number,
  ): Promise<number | null> {
    if (!this.client?.isReady) return null;
    try {
      const cutoff = Math.floor(Date.now() / 1000) - ttlSeconds;
      await this.client.zRemRangeByScore(key, '-inf', cutoff);
      return await this.client.zCard(key);
    } catch {
      this.logDegraded();
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
