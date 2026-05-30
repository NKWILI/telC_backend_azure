import { HttpException, HttpStatus } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';

describe('RateLimitService', () => {
  let service: RateLimitService;

  beforeEach(() => {
    delete process.env.RATE_LIMIT_FORGOT_PASSWORD_MAX_ATTEMPTS;
    delete process.env.RATE_LIMIT_FORGOT_PASSWORD_WINDOW_MINUTES;
    delete process.env.RATE_LIMIT_VERIFY_EMAIL_PUBLIC_MAX_ATTEMPTS;
    delete process.env.RATE_LIMIT_VERIFY_EMAIL_PUBLIC_WINDOW_MINUTES;
    delete process.env.RATE_LIMIT_RESET_PASSWORD_MAX_ATTEMPTS;
    delete process.env.RATE_LIMIT_RESET_PASSWORD_WINDOW_MINUTES;
    delete process.env.RATE_LIMIT_NEWSLETTER_IP_MAX_ATTEMPTS;
    delete process.env.RATE_LIMIT_NEWSLETTER_IP_WINDOW_MINUTES;
    delete process.env.RATE_LIMIT_NEWSLETTER_EMAIL_MAX_ATTEMPTS;
    delete process.env.RATE_LIMIT_NEWSLETTER_EMAIL_WINDOW_MINUTES;
    delete process.env.RATE_LIMIT_GUEST_SESSION_MAX_ATTEMPTS;
    delete process.env.RATE_LIMIT_GUEST_SESSION_WINDOW_MINUTES;
    delete process.env.RATE_LIMIT_WRITING_GUEST_SUBMIT_MAX_ATTEMPTS;
    delete process.env.RATE_LIMIT_WRITING_GUEST_SUBMIT_WINDOW_MINUTES;
    service = new RateLimitService();
  });

  describe('checkGuestSessionLimit', () => {
    it('allows requests up to the default limit (10) from one IP', () => {
      for (let i = 0; i < 10; i++) {
        expect(() => service.checkGuestSessionLimit('1.2.3.4')).not.toThrow();
      }
    });

    it('throws 429 on the 11th request from the same IP', () => {
      for (let i = 0; i < 10; i++) {
        service.checkGuestSessionLimit('1.2.3.4');
      }
      try {
        service.checkGuestSessionLimit('1.2.3.4');
        fail('expected HttpException');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect((err as HttpException).message).toBe('RATE_LIMIT_EXCEEDED');
      }
    });

    it('isolates limits per IP', () => {
      for (let i = 0; i < 10; i++) {
        service.checkGuestSessionLimit('1.1.1.1');
      }
      expect(() => service.checkGuestSessionLimit('2.2.2.2')).not.toThrow();
    });
  });

  describe('checkWritingGuestSubmitLimit', () => {
    it('allows up to the default limit (3) from one IP', () => {
      for (let i = 0; i < 3; i++) {
        expect(() =>
          service.checkWritingGuestSubmitLimit('1.2.3.4'),
        ).not.toThrow();
      }
    });

    it('throws 429 on the 4th request from the same IP', () => {
      for (let i = 0; i < 3; i++) {
        service.checkWritingGuestSubmitLimit('1.2.3.4');
      }
      try {
        service.checkWritingGuestSubmitLimit('1.2.3.4');
        fail('expected HttpException');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    });

    it('isolates limits per IP', () => {
      for (let i = 0; i < 3; i++) {
        service.checkWritingGuestSubmitLimit('1.1.1.1');
      }
      expect(() =>
        service.checkWritingGuestSubmitLimit('2.2.2.2'),
      ).not.toThrow();
    });

    it('uses a different cache namespace than checkWritingSubmitLimit', () => {
      for (let i = 0; i < 3; i++) {
        service.checkWritingGuestSubmitLimit('shared-key');
      }
      // The studentId-based limit (default 10) should NOT be touched by the IP-based one
      expect(() => service.checkWritingSubmitLimit('shared-key')).not.toThrow();
    });
  });

  describe('checkForgotPasswordLimit', () => {
    it('allows requests up to the default limit (5)', () => {
      for (let i = 0; i < 5; i++) {
        expect(() => service.checkForgotPasswordLimit('1.2.3.4')).not.toThrow();
      }
    });

    it('throws 429 RATE_LIMIT_EXCEEDED on the 6th request from the same key', () => {
      for (let i = 0; i < 5; i++) {
        service.checkForgotPasswordLimit('1.2.3.4');
      }

      try {
        service.checkForgotPasswordLimit('1.2.3.4');
        fail('expected HttpException');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect((err as HttpException).message).toBe('RATE_LIMIT_EXCEEDED');
      }
    });

    it('isolates limits per key', () => {
      for (let i = 0; i < 5; i++) {
        service.checkForgotPasswordLimit('1.1.1.1');
      }
      expect(() =>
        service.checkForgotPasswordLimit('2.2.2.2'),
      ).not.toThrow();
    });
  });

  describe('checkVerifyEmailPublicLimit', () => {
    it('allows requests up to the default limit (10)', () => {
      for (let i = 0; i < 10; i++) {
        expect(() =>
          service.checkVerifyEmailPublicLimit('1.2.3.4'),
        ).not.toThrow();
      }
    });

    it('throws 429 RATE_LIMIT_EXCEEDED on the 11th request from the same key', () => {
      for (let i = 0; i < 10; i++) {
        service.checkVerifyEmailPublicLimit('1.2.3.4');
      }

      try {
        service.checkVerifyEmailPublicLimit('1.2.3.4');
        fail('expected HttpException');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect((err as HttpException).message).toBe('RATE_LIMIT_EXCEEDED');
      }
    });

    it('uses a different cache namespace than checkForgotPasswordLimit', () => {
      for (let i = 0; i < 5; i++) {
        service.checkForgotPasswordLimit('1.2.3.4');
      }
      // forgot-password is now exhausted for this IP, but verify-email-public
      // tracks a separate counter and should still allow requests.
      expect(() =>
        service.checkVerifyEmailPublicLimit('1.2.3.4'),
      ).not.toThrow();
    });
  });

  describe('checkResetPasswordLimit', () => {
    it('allows requests up to the default limit (20)', () => {
      for (let i = 0; i < 20; i++) {
        expect(() => service.checkResetPasswordLimit('1.2.3.4')).not.toThrow();
      }
    });

    it('throws 429 RATE_LIMIT_EXCEEDED on the 21st request from the same key', () => {
      for (let i = 0; i < 20; i++) {
        service.checkResetPasswordLimit('1.2.3.4');
      }

      try {
        service.checkResetPasswordLimit('1.2.3.4');
        fail('expected HttpException');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect((err as HttpException).message).toBe('RATE_LIMIT_EXCEEDED');
      }
    });

    it('isolates limits per key', () => {
      for (let i = 0; i < 20; i++) {
        service.checkResetPasswordLimit('1.1.1.1');
      }
      expect(() =>
        service.checkResetPasswordLimit('2.2.2.2'),
      ).not.toThrow();
    });

    it('uses a different cache namespace than checkForgotPasswordLimit', () => {
      for (let i = 0; i < 5; i++) {
        service.checkForgotPasswordLimit('1.2.3.4');
      }
      // forgot-password exhausted; reset-password still has its own budget.
      expect(() => service.checkResetPasswordLimit('1.2.3.4')).not.toThrow();
    });
  });

  describe('checkNewsletterSubscribeLimit', () => {
    it('allows 2 calls with the same email (per-email cap)', () => {
      for (let i = 0; i < 2; i++) {
        expect(() =>
          service.checkNewsletterSubscribeLimit('1.2.3.4', 'a@b.com'),
        ).not.toThrow();
      }
    });

    it('throws 429 on the 3rd call with the same email', () => {
      service.checkNewsletterSubscribeLimit('1.2.3.4', 'a@b.com');
      service.checkNewsletterSubscribeLimit('1.2.3.4', 'a@b.com');

      try {
        service.checkNewsletterSubscribeLimit('1.2.3.4', 'a@b.com');
        fail('expected HttpException');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect((err as HttpException).message).toBe('RATE_LIMIT_EXCEEDED');
      }
    });

    it('allows 5 calls with different emails from the same IP', () => {
      for (let i = 0; i < 5; i++) {
        expect(() =>
          service.checkNewsletterSubscribeLimit('1.2.3.4', `user${i}@example.com`),
        ).not.toThrow();
      }
    });

    it('throws 429 on the 6th call from the same IP even with a new email', () => {
      for (let i = 0; i < 5; i++) {
        service.checkNewsletterSubscribeLimit('1.2.3.4', `user${i}@example.com`);
      }

      expect(() =>
        service.checkNewsletterSubscribeLimit('1.2.3.4', 'fresh@example.com'),
      ).toThrow(HttpException);
    });

    it('isolates limits per IP', () => {
      for (let i = 0; i < 5; i++) {
        service.checkNewsletterSubscribeLimit('1.1.1.1', `user${i}@example.com`);
      }
      expect(() =>
        service.checkNewsletterSubscribeLimit('2.2.2.2', 'fresh@example.com'),
      ).not.toThrow();
    });

    it('uses a separate cache namespace from forgot-password and reset-password', () => {
      for (let i = 0; i < 5; i++) {
        service.checkForgotPasswordLimit('1.2.3.4');
      }
      // forgot-password is exhausted; newsletter has its own counter.
      expect(() =>
        service.checkNewsletterSubscribeLimit('1.2.3.4', 'fresh@example.com'),
      ).not.toThrow();
    });
  });
});
