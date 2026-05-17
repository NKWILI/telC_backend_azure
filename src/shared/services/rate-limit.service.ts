import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import NodeCache from 'node-cache';

@Injectable()
export class RateLimitService {
  private readonly cache: NodeCache;

  private readonly writingMaxAttempts: number;
  private readonly writingWindowSeconds: number;
  private readonly forgotPasswordMaxAttempts: number;
  private readonly forgotPasswordWindowSeconds: number;

  constructor() {
    this.cache = new NodeCache();
    this.writingMaxAttempts = parseInt(
      process.env.RATE_LIMIT_WRITING_SUBMIT_MAX_ATTEMPTS || '10',
      10,
    );
    const writingWindowMinutes = parseInt(
      process.env.RATE_LIMIT_WRITING_SUBMIT_WINDOW_MINUTES || '60',
      10,
    );
    this.writingWindowSeconds = writingWindowMinutes * 60;

    this.forgotPasswordMaxAttempts = parseInt(
      process.env.RATE_LIMIT_FORGOT_PASSWORD_MAX_ATTEMPTS || '5',
      10,
    );
    const forgotPasswordWindowMinutes = parseInt(
      process.env.RATE_LIMIT_FORGOT_PASSWORD_WINDOW_MINUTES || '15',
      10,
    );
    this.forgotPasswordWindowSeconds = forgotPasswordWindowMinutes * 60;
  }

  /**
   * Rate limit for POST /api/writing/submit per student.
   * Throws 429 when exceeded.
   */
  checkWritingSubmitLimit(studentId: string): void {
    const key = `ratelimit:writing:submit:${studentId}`;
    const current = this.cache.get<number>(key) || 0;

    if (current >= this.writingMaxAttempts) {
      throw new HttpException(
        'RATE_LIMIT_EXCEEDED',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.cache.set(key, current + 1, this.writingWindowSeconds);
  }

  /**
   * Rate limit for POST /api/auth/forgot-password. Throws 429 when exceeded.
   * Key is typically the requester's IP address.
   */
  checkForgotPasswordLimit(key: string): void {
    const cacheKey = `ratelimit:auth:forgot-password:${key}`;
    const current = this.cache.get<number>(cacheKey) || 0;

    if (current >= this.forgotPasswordMaxAttempts) {
      throw new HttpException(
        'RATE_LIMIT_EXCEEDED',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.cache.set(cacheKey, current + 1, this.forgotPasswordWindowSeconds);
  }
}
