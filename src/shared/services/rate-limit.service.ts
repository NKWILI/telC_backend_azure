import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import NodeCache from 'node-cache';

@Injectable()
export class RateLimitService {
  private readonly cache: NodeCache;

  private readonly writingMaxAttempts: number;
  private readonly writingWindowSeconds: number;
  private readonly forgotPasswordMaxAttempts: number;
  private readonly forgotPasswordWindowSeconds: number;
  private readonly verifyEmailPublicMaxAttempts: number;
  private readonly verifyEmailPublicWindowSeconds: number;
  private readonly resetPasswordMaxAttempts: number;
  private readonly resetPasswordWindowSeconds: number;
  private readonly newsletterIpMaxAttempts: number;
  private readonly newsletterIpWindowSeconds: number;
  private readonly newsletterEmailMaxAttempts: number;
  private readonly newsletterEmailWindowSeconds: number;

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

    this.verifyEmailPublicMaxAttempts = parseInt(
      process.env.RATE_LIMIT_VERIFY_EMAIL_PUBLIC_MAX_ATTEMPTS || '10',
      10,
    );
    const verifyEmailPublicWindowMinutes = parseInt(
      process.env.RATE_LIMIT_VERIFY_EMAIL_PUBLIC_WINDOW_MINUTES || '15',
      10,
    );
    this.verifyEmailPublicWindowSeconds = verifyEmailPublicWindowMinutes * 60;

    this.resetPasswordMaxAttempts = parseInt(
      process.env.RATE_LIMIT_RESET_PASSWORD_MAX_ATTEMPTS || '20',
      10,
    );
    const resetPasswordWindowMinutes = parseInt(
      process.env.RATE_LIMIT_RESET_PASSWORD_WINDOW_MINUTES || '15',
      10,
    );
    this.resetPasswordWindowSeconds = resetPasswordWindowMinutes * 60;

    this.newsletterIpMaxAttempts = parseInt(
      process.env.RATE_LIMIT_NEWSLETTER_IP_MAX_ATTEMPTS || '5',
      10,
    );
    const newsletterIpWindowMinutes = parseInt(
      process.env.RATE_LIMIT_NEWSLETTER_IP_WINDOW_MINUTES || '15',
      10,
    );
    this.newsletterIpWindowSeconds = newsletterIpWindowMinutes * 60;

    this.newsletterEmailMaxAttempts = parseInt(
      process.env.RATE_LIMIT_NEWSLETTER_EMAIL_MAX_ATTEMPTS || '2',
      10,
    );
    const newsletterEmailWindowMinutes = parseInt(
      process.env.RATE_LIMIT_NEWSLETTER_EMAIL_WINDOW_MINUTES || '15',
      10,
    );
    this.newsletterEmailWindowSeconds = newsletterEmailWindowMinutes * 60;
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

  /**
   * Rate limit for POST /api/auth/verify-email-public. Throws 429 when exceeded.
   * Key is typically the requester's IP address.
   */
  checkVerifyEmailPublicLimit(key: string): void {
    const cacheKey = `ratelimit:auth:verify-email-public:${key}`;
    const current = this.cache.get<number>(cacheKey) || 0;

    if (current >= this.verifyEmailPublicMaxAttempts) {
      throw new HttpException(
        'RATE_LIMIT_EXCEEDED',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.cache.set(cacheKey, current + 1, this.verifyEmailPublicWindowSeconds);
  }

  /**
   * Rate limit for POST /api/auth/reset-password. Throws 429 when exceeded.
   * Key is typically the requester's IP address. Defends against random-spray
   * brute-force against the 6-digit reset-code space.
   */
  checkResetPasswordLimit(key: string): void {
    const cacheKey = `ratelimit:auth:reset-password:${key}`;
    const current = this.cache.get<number>(cacheKey) || 0;

    if (current >= this.resetPasswordMaxAttempts) {
      throw new HttpException(
        'RATE_LIMIT_EXCEEDED',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.cache.set(cacheKey, current + 1, this.resetPasswordWindowSeconds);
  }

  /**
   * Rate limit for POST /api/newsletter/subscribe. Throws 429 when exceeded.
   * Enforces both per-IP and per-email caps. Per-email defends against
   * targeted spam from rotating IPs; per-IP defends against bursts.
   */
  checkNewsletterSubscribeLimit(ipKey: string, emailKey: string): void {
    const emailCacheKey = `ratelimit:newsletter:subscribe:email:${emailKey}`;
    const emailCurrent = this.cache.get<number>(emailCacheKey) || 0;
    if (emailCurrent >= this.newsletterEmailMaxAttempts) {
      throw new HttpException(
        'RATE_LIMIT_EXCEEDED',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const ipCacheKey = `ratelimit:newsletter:subscribe:ip:${ipKey}`;
    const ipCurrent = this.cache.get<number>(ipCacheKey) || 0;
    if (ipCurrent >= this.newsletterIpMaxAttempts) {
      throw new HttpException(
        'RATE_LIMIT_EXCEEDED',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.cache.set(emailCacheKey, emailCurrent + 1, this.newsletterEmailWindowSeconds);
    this.cache.set(ipCacheKey, ipCurrent + 1, this.newsletterIpWindowSeconds);
  }
}
