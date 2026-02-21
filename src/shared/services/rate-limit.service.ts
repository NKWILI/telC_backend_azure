import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import NodeCache from 'node-cache';

@Injectable()
export class RateLimitService {
  private readonly cache: NodeCache;
  private readonly maxAttempts: number;
  private readonly windowSeconds: number;

  constructor() {
    this.cache = new NodeCache();
    this.maxAttempts = parseInt(
      process.env.RATE_LIMIT_ACTIVATE_MAX_ATTEMPTS || '5',
      10,
    );
    const windowMinutes = parseInt(
      process.env.RATE_LIMIT_ACTIVATE_WINDOW_MINUTES || '15',
      10,
    );
    this.windowSeconds = windowMinutes * 60;
  }

  checkActivationLimit(ip: string): void {
    const key = `ratelimit:activate:${ip}`;
    const current = this.cache.get<number>(key) || 0;

    if (current >= this.maxAttempts) {
      throw new HttpException(
        'RATE_LIMIT_EXCEEDED',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.cache.set(key, current + 1, this.windowSeconds);
  }
}
