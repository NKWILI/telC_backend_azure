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
    }) as unknown as ConfigService;

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

  describe('center emails', () => {
    const baseConfig = {
      RESEND_API_KEY: 'key',
      EMAIL_FROM: 'noreply@example.com',
      FRONTEND_URL: 'https://app.example.com',
      VITRINE_URL: 'https://www.lerniqo.example',
    };

    it('sends center verification to the center-specific route', async () => {
      const service = new EmailService(makeConfig(baseConfig));
      const send = (service as any).resend.emails.send as jest.Mock;

      await service.sendCenterVerificationEmail(
        'manager@example.com',
        'center-token',
      );

      const arg = send.mock.calls[0][0];
      expect(arg.to).toBe('manager@example.com');
      expect(arg.html).toContain(
        'https://www.lerniqo.example/center/verify-email?token=center-token',
      );
      expect(arg.html).not.toContain('/verify-email?token=student');
    });

    it('explains that repeat registration did not replace center credentials', async () => {
      const service = new EmailService(makeConfig(baseConfig));
      const send = (service as any).resend.emails.send as jest.Mock;

      await service.sendExistingCenterVerificationEmail(
        'manager@example.com',
        'replacement-token',
      );

      const arg = send.mock.calls[0][0];
      expect(arg.html).toContain(
        'https://www.lerniqo.example/center/verify-email?token=replacement-token',
      );
      expect(arg.html).toMatch(/password has not been changed/i);
      expect(arg.html).toMatch(/center details have not been changed/i);
      expect(arg.html).toMatch(/forgot password/i);
    });

    it('sends the center password-reset code without a reset link', async () => {
      const service = new EmailService(makeConfig(baseConfig));
      const send = (service as any).resend.emails.send as jest.Mock;

      await service.sendCenterPasswordResetEmail(
        'manager@example.com',
        '907314',
      );

      const arg = send.mock.calls[0][0];
      expect(arg.to).toBe('manager@example.com');
      expect(arg.html).toContain('907314');
      expect(arg.text).toContain('907314');
      expect(arg.html).not.toMatch(/reset-password\?token=/);
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

    it('uses the Lerniqo branding and embeds the official logo', async () => {
      const service = new EmailService(makeConfig(baseConfig));
      const send = (service as any).resend.emails.send as jest.Mock;

      await service.sendPasswordResetEmail('user@example.com', '042713');

      const arg = send.mock.calls[0][0];
      expect(arg.subject).toBe(
        'Dein Lerniqo-Code zum Zurücksetzen des Passworts',
      );
      expect(arg.html).toContain('cid:lerniqo-logo');
      expect(arg.html).toContain('www.lerniqo.tech');
      expect(arg.text).toContain('Dein Bestätigungscode: 042713');
      expect(arg.attachments).toEqual([
        expect.objectContaining({
          filename: 'lerniqo-logo.png',
          contentId: 'lerniqo-logo',
        }),
      ]);
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
