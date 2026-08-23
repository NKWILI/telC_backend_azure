/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
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
      // Both audiences verify on the same website page; `type=center` is what
      // tells it to call the center endpoint rather than the student one.
      // The HTML href is escaped, so the plain-text part carries the raw URL.
      expect(arg.text).toContain(
        'https://www.lerniqo.example/verify-email?token=center-token&type=center',
      );
      expect(arg.html).toContain('token=center-token');
      expect(arg.html).toContain('type=center');
    });

    it('explains that repeat registration did not replace center credentials', async () => {
      const service = new EmailService(makeConfig(baseConfig));
      const send = (service as any).resend.emails.send as jest.Mock;

      await service.sendExistingCenterVerificationEmail(
        'manager@example.com',
        'replacement-token',
      );

      const arg = send.mock.calls[0][0];
      expect(arg.text).toContain(
        'https://www.lerniqo.example/verify-email?token=replacement-token&type=center',
      );
      expect(arg.html).toMatch(/Passwort .*nicht geändert/i);
      expect(arg.html).toMatch(/Sprachschuldaten wurden nicht geändert/i);
      expect(arg.html).toMatch(/Passwort vergessen/i);
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
  /**
   * Five of the six emails were plain unstyled HTML while only the student
   * password reset was branded. These assertions apply to every message, so a
   * new email cannot quietly ship without the shell, the logo or a text part.
   */
  describe('every transactional email', () => {
    const config = {
      RESEND_API_KEY: 'key',
      EMAIL_FROM: 'noreply@lerniqo.tech',
      FRONTEND_URL: 'https://www.lerniqo.example',
      VITRINE_URL: 'https://www.lerniqo.example',
    };
    const cases: Array<[string, (s: EmailService) => Promise<void>]> = [
      ['student verification', (s) => s.sendVerificationEmail('a@b.co', 'tok')],
      [
        'student existing account',
        (s) => s.sendExistingAccountVerificationEmail('a@b.co', 'tok'),
      ],
      [
        'student password reset',
        (s) => s.sendPasswordResetEmail('a@b.co', '123456'),
      ],
      [
        'center verification',
        (s) => s.sendCenterVerificationEmail('a@b.co', 'tok'),
      ],
      [
        'center existing account',
        (s) => s.sendExistingCenterVerificationEmail('a@b.co', 'tok'),
      ],
      [
        'center password reset',
        (s) => s.sendCenterPasswordResetEmail('a@b.co', '123456'),
      ],
    ];

    it.each(cases)('%s is branded and complete', async (_name, sendIt) => {
      const service = new EmailService(makeConfig(config));
      const send = (service as any).resend.emails.send as jest.Mock;

      await sendIt(service);
      const arg = send.mock.calls[0][0];

      // The shell
      expect(arg.html).toContain('<!doctype html>');
      expect(arg.html).toContain('cid:lerniqo-logo');
      expect(arg.html).toContain('www.lerniqo.tech');

      // The logo actually travels with the message, so it renders even when
      // the client blocks remote images.
      expect(arg.attachments?.[0]?.contentId).toBe('lerniqo-logo');
      expect(Buffer.isBuffer(arg.attachments?.[0]?.content)).toBe(true);

      // A text/plain part: better deliverability, and some clients show
      // nothing without one.
      expect(typeof arg.text).toBe('string');
      expect(arg.text.length).toBeGreaterThan(40);

      expect(arg.subject).toBeTruthy();
    });

    it.each(cases)(
      '%s never leaks an unsubstituted placeholder',
      async (_n, sendIt) => {
        const service = new EmailService(makeConfig(config));
        const send = (service as any).resend.emails.send as jest.Mock;

        await sendIt(service);
        const arg = send.mock.calls[0][0];

        // FRONTEND_URL was once literally "http://localhost:PORT", which shipped
        // a dead link to real inboxes.
        expect(`${arg.html}${arg.text}`).not.toMatch(
          /localhost:PORT|\{\{|undefined/,
        );
      },
    );
  });
});
