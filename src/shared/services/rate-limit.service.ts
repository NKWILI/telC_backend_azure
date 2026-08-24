import {
  Injectable,
  HttpException,
  HttpStatus,
  Optional,
} from '@nestjs/common';
import NodeCache from 'node-cache';
import { ValkeyService, type RateLimitBucket } from './valkey.service';

@Injectable()
export class RateLimitService {
  private readonly cache: NodeCache;

  private readonly writingMaxAttempts: number;
  private readonly writingWindowSeconds: number;
  private readonly forgotPasswordMaxAttempts: number;
  private readonly forgotPasswordWindowSeconds: number;
  private readonly loginIpMaxAttempts: number;
  private readonly loginEmailMaxAttempts: number;
  private readonly loginWindowSeconds: number;
  private readonly verifyEmailPublicMaxAttempts: number;
  private readonly verifyEmailPublicWindowSeconds: number;
  private readonly resetPasswordMaxAttempts: number;
  private readonly resetPasswordWindowSeconds: number;
  private readonly newsletterIpMaxAttempts: number;
  private readonly newsletterIpWindowSeconds: number;
  private readonly newsletterEmailMaxAttempts: number;
  private readonly newsletterEmailWindowSeconds: number;
  private readonly guestSessionMaxAttempts: number;
  private readonly guestSessionWindowSeconds: number;
  private readonly writingGuestSubmitMaxAttempts: number;
  private readonly writingGuestSubmitWindowSeconds: number;
  private readonly registerIpMaxAttempts: number;
  private readonly registerIpWindowSeconds: number;
  private readonly registerEmailMaxAttempts: number;
  private readonly registerEmailWindowSeconds: number;

  constructor(@Optional() private readonly valkeyService?: ValkeyService) {
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

    this.loginIpMaxAttempts = parseInt(
      process.env.RATE_LIMIT_LOGIN_IP_MAX_ATTEMPTS || '20',
      10,
    );
    this.loginEmailMaxAttempts = parseInt(
      process.env.RATE_LIMIT_LOGIN_EMAIL_MAX_ATTEMPTS || '10',
      10,
    );
    this.loginWindowSeconds =
      parseInt(process.env.RATE_LIMIT_LOGIN_WINDOW_MINUTES || '15', 10) * 60;

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

    this.guestSessionMaxAttempts = parseInt(
      process.env.RATE_LIMIT_GUEST_SESSION_MAX_ATTEMPTS || '10',
      10,
    );
    const guestSessionWindowMinutes = parseInt(
      process.env.RATE_LIMIT_GUEST_SESSION_WINDOW_MINUTES || '60',
      10,
    );
    this.guestSessionWindowSeconds = guestSessionWindowMinutes * 60;

    this.writingGuestSubmitMaxAttempts = parseInt(
      process.env.RATE_LIMIT_WRITING_GUEST_SUBMIT_MAX_ATTEMPTS || '3',
      10,
    );
    const writingGuestSubmitWindowMinutes = parseInt(
      process.env.RATE_LIMIT_WRITING_GUEST_SUBMIT_WINDOW_MINUTES || '60',
      10,
    );
    this.writingGuestSubmitWindowSeconds = writingGuestSubmitWindowMinutes * 60;

    // Deliberately looser than the per-email cap. A class of students signing
    // up together share one NAT address, so a tight IP cap would lock out
    // legitimate users. The per-email bucket does the security work.
    this.registerIpMaxAttempts = parseInt(
      process.env.RATE_LIMIT_REGISTER_IP_MAX_ATTEMPTS || '20',
      10,
    );
    const registerIpWindowMinutes = parseInt(
      process.env.RATE_LIMIT_REGISTER_IP_WINDOW_MINUTES || '60',
      10,
    );
    this.registerIpWindowSeconds = registerIpWindowMinutes * 60;

    this.registerEmailMaxAttempts = parseInt(
      process.env.RATE_LIMIT_REGISTER_EMAIL_MAX_ATTEMPTS || '5',
      10,
    );
    const registerEmailWindowMinutes = parseInt(
      process.env.RATE_LIMIT_REGISTER_EMAIL_WINDOW_MINUTES || '60',
      10,
    );
    this.registerEmailWindowSeconds = registerEmailWindowMinutes * 60;
  }

  /**
   * Read the current counter for a key and throw 429 if it has reached `max`.
   * Returns the current count so the caller can increment it via {@link record}.
   * Split from `record` so multi-bucket limits (newsletter) can assert ALL
   * buckets before incrementing ANY — preserving all-or-nothing semantics.
   */
  private assertUnderLimit(cacheKey: string, max: number): number {
    const current = this.cache.get<number>(cacheKey) || 0;
    if (current >= max) {
      throw new HttpException(
        'RATE_LIMIT_EXCEEDED',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return current;
  }

  /** Increment a key's counter, (re)setting its TTL window. */
  private record(
    cacheKey: string,
    current: number,
    windowSeconds: number,
  ): void {
    this.cache.set(cacheKey, current + 1, windowSeconds);
  }

  /** Single-bucket limit: assert under `max`, then increment. */
  private enforce(cacheKey: string, max: number, windowSeconds: number): void {
    const current = this.assertUnderLimit(cacheKey, max);
    this.record(cacheKey, current, windowSeconds);
  }

  private enforceDistributed(buckets: RateLimitBucket[]): void | Promise<void> {
    if (!this.valkeyService) {
      for (const bucket of buckets) {
        this.enforce(bucket.key, bucket.max, bucket.ttlSeconds);
      }
      return;
    }

    return this.valkeyService.enforce(buckets).then((allowed) => {
      if (allowed === false) {
        throw new HttpException(
          'RATE_LIMIT_EXCEEDED',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (allowed === null) {
        for (const bucket of buckets) {
          this.enforce(bucket.key, bucket.max, bucket.ttlSeconds);
        }
      }
    });
  }

  /**
   * Rate limit for POST /api/writing/submit per student.
   * Throws 429 when exceeded.
   */
  checkWritingSubmitLimit(studentId: string): void | Promise<void> {
    return this.enforceDistributed([
      {
        key: `ratelimit:writing:submit:${studentId}`,
        max: this.writingMaxAttempts,
        ttlSeconds: this.writingWindowSeconds,
      },
    ]);
  }

  /**
   * Rate limit for POST /api/auth/forgot-password. Throws 429 when exceeded.
   * Key is typically the requester's IP address.
   */
  checkForgotPasswordLimit(key: string): void | Promise<void> {
    return this.enforceDistributed([
      {
        key: `ratelimit:auth:forgot-password:${key}`,
        max: this.forgotPasswordMaxAttempts,
        ttlSeconds: this.forgotPasswordWindowSeconds,
      },
    ]);
  }

  checkLoginLimit(ip: string, email: string): void | Promise<void> {
    return this.enforceDistributed([
      {
        key: `ratelimit:auth:login:ip:${ip}`,
        max: this.loginIpMaxAttempts,
        ttlSeconds: this.loginWindowSeconds,
      },
      {
        key: `ratelimit:auth:login:email:${email.trim().toLowerCase()}`,
        max: this.loginEmailMaxAttempts,
        ttlSeconds: this.loginWindowSeconds,
      },
    ]);
  }

  /**
   * Center login uses the student login policy values but isolated keys.
   * Neither product can consume the other's IP or email budget.
   */
  checkCenterLoginLimit(ip: string, email: string): void | Promise<void> {
    return this.enforceDistributed([
      {
        key: `ratelimit:centers:login:ip:${ip}`,
        max: this.loginIpMaxAttempts,
        ttlSeconds: this.loginWindowSeconds,
      },
      {
        key: `ratelimit:centers:login:email:${email.trim().toLowerCase()}`,
        max: this.loginEmailMaxAttempts,
        ttlSeconds: this.loginWindowSeconds,
      },
    ]);
  }

  /**
   * Rate limit for POST /api/auth/verify-email-public. Throws 429 when exceeded.
   * Key is typically the requester's IP address.
   */
  checkVerifyEmailPublicLimit(key: string): void | Promise<void> {
    return this.enforceDistributed([
      {
        key: `ratelimit:auth:verify-email-public:${key}`,
        max: this.verifyEmailPublicMaxAttempts,
        ttlSeconds: this.verifyEmailPublicWindowSeconds,
      },
    ]);
  }

  /**
   * Rate limit for POST /api/student-activations.
   *
   * The only public endpoint where guessing a value yields an account, so it
   * gets the tighter reset-password budget rather than a generous one. Keys
   * carry 32 bytes of entropy, which makes brute force impractical on its own;
   * this bounds the attempt rate anyway.
   */
  checkStudentActivationLimit(ip: string): void | Promise<void> {
    return this.enforceDistributed([
      {
        key: `ratelimit:students:activation:ip:${ip}`,
        max: this.resetPasswordMaxAttempts,
        ttlSeconds: this.resetPasswordWindowSeconds,
      },
    ]);
  }

  /** Center recovery reuses the student policy values under isolated keys. */
  checkCenterForgotPasswordLimit(ip: string): void | Promise<void> {
    return this.enforceDistributed([
      {
        key: `ratelimit:centers:forgot-password:ip:${ip}`,
        max: this.forgotPasswordMaxAttempts,
        ttlSeconds: this.forgotPasswordWindowSeconds,
      },
    ]);
  }

  /** Caps random-spray guessing against the six-digit center reset code. */
  checkCenterResetPasswordLimit(ip: string): void | Promise<void> {
    return this.enforceDistributed([
      {
        key: `ratelimit:centers:reset-password:ip:${ip}`,
        max: this.resetPasswordMaxAttempts,
        ttlSeconds: this.resetPasswordWindowSeconds,
      },
    ]);
  }

  /** Center verification is isolated from student verification traffic. */
  checkCenterVerifyEmailLimit(ip: string): void | Promise<void> {
    return this.enforceDistributed([
      {
        key: `ratelimit:centers:verify-email:ip:${ip}`,
        max: this.verifyEmailPublicMaxAttempts,
        ttlSeconds: this.verifyEmailPublicWindowSeconds,
      },
    ]);
  }

  /**
   * Rate limit for POST /api/auth/reset-password. Throws 429 when exceeded.
   * Key is typically the requester's IP address. Defends against random-spray
   * brute-force against the 6-digit reset-code space.
   */
  checkResetPasswordLimit(key: string): void | Promise<void> {
    return this.enforceDistributed([
      {
        key: `ratelimit:auth:reset-password:${key}`,
        max: this.resetPasswordMaxAttempts,
        ttlSeconds: this.resetPasswordWindowSeconds,
      },
    ]);
  }

  /**
   * Rate limit for POST /api/newsletter/subscribe. Throws 429 when exceeded.
   * Enforces both per-IP and per-email caps. Per-email defends against
   * targeted spam from rotating IPs; per-IP defends against bursts.
   * Both buckets are asserted before either is incremented.
   */
  checkNewsletterSubscribeLimit(
    ipKey: string,
    emailKey: string,
  ): void | Promise<void> {
    const emailCacheKey = `ratelimit:newsletter:subscribe:email:${emailKey}`;
    const ipCacheKey = `ratelimit:newsletter:subscribe:ip:${ipKey}`;

    return this.enforceDistributed([
      {
        key: emailCacheKey,
        max: this.newsletterEmailMaxAttempts,
        ttlSeconds: this.newsletterEmailWindowSeconds,
      },
      {
        key: ipCacheKey,
        max: this.newsletterIpMaxAttempts,
        ttlSeconds: this.newsletterIpWindowSeconds,
      },
    ]);
  }

  /**
   * Rate limit for POST /api/auth/guest. Caps how many guest JWTs a single IP
   * can mint per window. Throws 429 when exceeded.
   */
  checkGuestSessionLimit(ip: string): void | Promise<void> {
    return this.enforceDistributed([
      {
        key: `ratelimit:guest:session:${ip}`,
        max: this.guestSessionMaxAttempts,
        ttlSeconds: this.guestSessionWindowSeconds,
      },
    ]);
  }

  /**
   * Rate limit for POST /api/auth/register. Throws 429 when exceeded.
   *
   * The per-email cap is the one that matters. Registering an address that
   * already has an unverified account overwrites its verification token, so
   * without a cap anyone who knows the address can loop on it: the real
   * owner's link dies before they can click it and they can never finish
   * signing up. The 2-minute resend cooldown throttles the rate but places no
   * ceiling on the total, so the loop can run indefinitely.
   *
   * Per-IP is the looser anti-bulk cap. Both buckets are asserted before
   * either is incremented, so a rejected request costs nothing on the other.
   *
   * Neither bucket depends on whether an account exists, so a 429 reveals
   * nothing an attacker could use to enumerate accounts — the endpoint's
   * generic response stays generic.
   */
  checkRegisterLimit(ipKey: string, emailKey: string): void | Promise<void> {
    return this.enforceDistributed([
      {
        key: `ratelimit:auth:register:email:${emailKey.trim().toLowerCase()}`,
        max: this.registerEmailMaxAttempts,
        ttlSeconds: this.registerEmailWindowSeconds,
      },
      {
        key: `ratelimit:auth:register:ip:${ipKey}`,
        max: this.registerIpMaxAttempts,
        ttlSeconds: this.registerIpWindowSeconds,
      },
    ]);
  }

  /**
   * Rate limit for POST /api/centers/register.
   *
   * The limits intentionally use the same policy values as student
   * registration but a different namespace. A student-registration request
   * must never consume a language center's registration budget, or vice versa.
   */
  checkCenterRegisterLimit(
    ipKey: string,
    emailKey: string,
  ): void | Promise<void> {
    return this.enforceDistributed([
      {
        key: `ratelimit:centers:register:email:${emailKey.trim().toLowerCase()}`,
        max: this.registerEmailMaxAttempts,
        ttlSeconds: this.registerEmailWindowSeconds,
      },
      {
        key: `ratelimit:centers:register:ip:${ipKey}`,
        max: this.registerIpMaxAttempts,
        ttlSeconds: this.registerIpWindowSeconds,
      },
    ]);
  }

  /**
   * Rate limit for POST /api/writing/submit when the caller is a guest.
   * Capped per IP (default 3/hour) — much tighter than the per-student limit
   * for logged-in users. Protects the free-tier Gemini quota from scripted abuse.
   */
  checkWritingGuestSubmitLimit(ip: string): void | Promise<void> {
    return this.enforceDistributed([
      {
        key: `ratelimit:writing:submit:guest:${ip}`,
        max: this.writingGuestSubmitMaxAttempts,
        ttlSeconds: this.writingGuestSubmitWindowSeconds,
      },
    ]);
  }

  /**
   * Rate limit for POST /api/payments.
   *
   * Keyed on the center rather than the IP, because the caller is
   * authenticated and the resource being protected is that center's own row
   * count. Every payment creates a durable record, and a new idempotency key
   * makes a new one, so without a ceiling a signed-in center can grow the
   * table without bound — the idempotency index prevents duplicates of one
   * intent, not a flood of distinct ones.
   *
   * Twenty an hour is far above any honest use. A center pays monthly, and
   * even a person clicking through several failed attempts stays well inside
   * it.
   */
  checkPaymentCreateLimit(centerId: string): void | Promise<void> {
    return this.enforceDistributed([
      {
        key: `ratelimit:payments:create:center:${centerId}`,
        max: 20,
        ttlSeconds: 60 * 60,
      },
    ]);
  }
}
