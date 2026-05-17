jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({}) },
  })),
}));

import { ConfigService } from '@nestjs/config';
import { EmailService } from '../src/modules/auth/email.service';

describe('EmailService', () => {
  const makeConfig = (values: Record<string, string>) =>
    ({
      getOrThrow: (key: string) => {
        if (key in values) return values[key];
        throw new Error(`missing config: ${key}`);
      },
      get: (key: string) => values[key],
    } as unknown as ConfigService);

  describe('sendVerificationEmail', () => {
    it('uses VITRINE_URL when set', async () => {
      const service = new EmailService(
        makeConfig({
          RESEND_API_KEY: 'key',
          EMAIL_FROM: 'noreply@example.com',
          FRONTEND_URL: 'https://app.example.com',
          VITRINE_URL: 'https://sprach-tau.vercel.app',
        }),
      );
      const send = (service as any).resend.emails.send as jest.Mock;

      await service.sendVerificationEmail('user@example.com', 'rawtoken');

      const arg = send.mock.calls[0][0];
      expect(arg.html).toContain(
        'https://sprach-tau.vercel.app/verify-email?token=rawtoken',
      );
      expect(arg.html).not.toContain('app.example.com');
    });

    it('falls back to FRONTEND_URL when VITRINE_URL is unset', async () => {
      const service = new EmailService(
        makeConfig({
          RESEND_API_KEY: 'key',
          EMAIL_FROM: 'noreply@example.com',
          FRONTEND_URL: 'https://app.example.com',
        }),
      );
      const send = (service as any).resend.emails.send as jest.Mock;

      await service.sendVerificationEmail('user@example.com', 'rawtoken');

      const arg = send.mock.calls[0][0];
      expect(arg.html).toContain(
        'https://app.example.com/verify-email?token=rawtoken',
      );
    });
  });

  describe('sendPasswordResetEmail', () => {
    const baseConfig = {
      RESEND_API_KEY: 'key',
      EMAIL_FROM: 'noreply@example.com',
      FRONTEND_URL: 'https://app.example.com',
      VITRINE_URL: 'https://sprach-tau.vercel.app',
    };

    it('renders the 6-digit code prominently in the HTML body', async () => {
      const service = new EmailService(makeConfig(baseConfig));
      const send = (service as any).resend.emails.send as jest.Mock;

      await service.sendPasswordResetEmail('user@example.com', '042713');

      const arg = send.mock.calls[0][0];
      expect(arg.html).toContain('042713');
    });

    it('does NOT include a /reset-password URL link', async () => {
      const service = new EmailService(makeConfig(baseConfig));
      const send = (service as any).resend.emails.send as jest.Mock;

      await service.sendPasswordResetEmail('user@example.com', '042713');

      const arg = send.mock.calls[0][0];
      expect(arg.html).not.toMatch(/reset-password\?token=/);
      expect(arg.html).not.toContain('https://');
    });

    it('uses German copy (Code, Minuten)', async () => {
      const service = new EmailService(makeConfig(baseConfig));
      const send = (service as any).resend.emails.send as jest.Mock;

      await service.sendPasswordResetEmail('user@example.com', '042713');

      const arg = send.mock.calls[0][0];
      expect(arg.html).toMatch(/Code/i);
      expect(arg.html).toMatch(/Minuten/i);
    });

    it('subject line is German', async () => {
      const service = new EmailService(makeConfig(baseConfig));
      const send = (service as any).resend.emails.send as jest.Mock;

      await service.sendPasswordResetEmail('user@example.com', '042713');

      const arg = send.mock.calls[0][0];
      expect(arg.subject).toMatch(/Passwort/i);
    });
  });
});
