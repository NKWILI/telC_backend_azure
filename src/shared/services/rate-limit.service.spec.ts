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
    service = new RateLimitService();
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
});
