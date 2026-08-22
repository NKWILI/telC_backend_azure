import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { readFileSync } from 'fs';
import { join } from 'path';

@Injectable()
export class EmailService {
  private readonly resend: Resend;

  constructor(private readonly config: ConfigService) {
    this.resend = new Resend(this.config.getOrThrow<string>('RESEND_API_KEY'));
  }

  async sendVerificationEmail(to: string, rawToken: string): Promise<void> {
    const vitrineUrl =
      this.config.get<string>('VITRINE_URL') ||
      this.config.getOrThrow<string>('FRONTEND_URL');
    const emailFrom = this.config.getOrThrow<string>('EMAIL_FROM');
    const verificationLink = `${vitrineUrl}/verify-email?token=${rawToken}`;

    await this.resend.emails.send({
      from: emailFrom,
      to,
      subject: 'Verify your email address',
      html: `<p>Click the link below to verify your email:</p><p><a href="${verificationLink}">${verificationLink}</a></p>`,
    });
  }

  /**
   * Sent when someone registers with an address that already has an
   * unverified account.
   *
   * The HTTP response to `POST /auth/register` is deliberately identical for
   * new and existing addresses so it cannot be used to enumerate accounts.
   * That leaves a returning user with no explanation, which is what this email
   * is for — only the inbox owner sees it, so it can say more than the API can.
   *
   * It must not imply the password was changed. The stored credentials are
   * deliberately left untouched on this path (see `AuthService.register`), so
   * a user who no longer remembers their password is pointed at password reset
   * rather than being silently locked out.
   */
  async sendExistingAccountVerificationEmail(
    to: string,
    rawToken: string,
  ): Promise<void> {
    const vitrineUrl =
      this.config.get<string>('VITRINE_URL') ||
      this.config.getOrThrow<string>('FRONTEND_URL');
    const emailFrom = this.config.getOrThrow<string>('EMAIL_FROM');
    const verificationLink = `${vitrineUrl}/verify-email?token=${rawToken}`;

    await this.resend.emails.send({
      from: emailFrom,
      to,
      subject: 'Finish setting up your account',
      html:
        `<p>You already started creating an account with this email address, ` +
        `but it has not been verified yet.</p>` +
        `<p>Verify it here:</p>` +
        `<p><a href="${verificationLink}">${verificationLink}</a></p>` +
        `<p>Your password has not been changed. If you no longer remember the ` +
        `password you chose, verify your address first, then use ` +
        `&quot;Forgot password&quot; in the app to set a new one.</p>` +
        `<p>If you did not try to create an account, you can ignore this email. ` +
        `Nothing has changed.</p>`,
    });
  }

  async sendCenterVerificationEmail(
    to: string,
    rawToken: string,
  ): Promise<void> {
    const vitrineUrl = this.getVitrineUrl();
    const emailFrom = this.config.getOrThrow<string>('EMAIL_FROM');
    const verificationLink = `${vitrineUrl}/center/verify-email?token=${rawToken}`;

    await this.resend.emails.send({
      from: emailFrom,
      to,
      subject: 'Verify your Lerniqo center account',
      html:
        '<p>Welcome to Lerniqo for language centers.</p>' +
        '<p>Verify your email address to finish creating your center account:</p>' +
        `<p><a href="${verificationLink}">${verificationLink}</a></p>` +
        '<p>If you did not request this account, you can ignore this email.</p>',
    });
  }

  async sendExistingCenterVerificationEmail(
    to: string,
    rawToken: string,
  ): Promise<void> {
    const vitrineUrl = this.getVitrineUrl();
    const emailFrom = this.config.getOrThrow<string>('EMAIL_FROM');
    const verificationLink = `${vitrineUrl}/center/verify-email?token=${rawToken}`;

    await this.resend.emails.send({
      from: emailFrom,
      to,
      subject: 'Finish setting up your Lerniqo center account',
      html:
        '<p>An unverified center account already exists for this email address.</p>' +
        '<p>Use this new link to verify it:</p>' +
        `<p><a href="${verificationLink}">${verificationLink}</a></p>` +
        '<p>Your password has not been changed, and your center details have not been changed.</p>' +
        '<p>If you no longer know that password, verify your email and then use Forgot password to replace it.</p>' +
        '<p>If you did not request this, you can ignore this email.</p>',
    });
  }

  async sendCenterPasswordResetEmail(
    to: string,
    rawCode: string,
  ): Promise<void> {
    const emailFrom = this.config.getOrThrow<string>('EMAIL_FROM');
    const subject = 'Your Lerniqo center password-reset code';
    const text = [
      'Reset your Lerniqo center password',
      '',
      `Your confirmation code: ${rawCode}`,
      '',
      'Enter this code in the Lerniqo center app. It is valid for 10 minutes.',
      'If you did not request this, you can ignore this email.',
    ].join('\n');
    const html =
      '<h1>Reset your center password</h1>' +
      '<p>Enter this confirmation code in the Lerniqo center app:</p>' +
      `<p style="font-size:32px;font-weight:700;letter-spacing:6px">${rawCode}</p>` +
      '<p>The code is valid for 10 minutes.</p>' +
      '<p>If you did not request this, you can ignore this email.</p>';

    await this.resend.emails.send({
      from: emailFrom,
      to,
      subject,
      html,
      text,
    });
  }

  private getVitrineUrl(): string {
    return (
      this.config.get<string>('VITRINE_URL') ||
      this.config.getOrThrow<string>('FRONTEND_URL')
    );
  }

  async sendPasswordResetEmail(to: string, rawCode: string): Promise<void> {
    const emailFrom = this.config.getOrThrow<string>('EMAIL_FROM');
    const logo = readFileSync(
      join(__dirname, '..', '..', '..', 'public', 'logo.png'),
    );

    const subject = 'Dein Lerniqo-Code zum Zurücksetzen des Passworts';

    const text = `
Passwort zurücksetzen

Hallo,

wir haben eine Anfrage erhalten, dein Lerniqo-Passwort zurückzusetzen.

Dein Bestätigungscode: ${rawCode}

Gib diesen Code in der Lerniqo-App ein. Er ist 10 Minuten gültig.

Wenn du diese Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren. Dein Passwort bleibt unverändert.

Lerniqo
Deine KI-gestützte Prüfungsvorbereitung für die telC-Sprachprüfung.
www.lerniqo.tech
    `.trim();

    const html = `
<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light only">
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#172033;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      Mit diesem Code kannst du dein Lerniqo-Passwort zurücksetzen.
    </div>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f3f6fa;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background-color:#ffffff;border:1px solid #dfe7f1;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(15,35,65,0.08);">
            <tr>
              <td align="center" style="padding:28px 36px;background-color:#06285a;">
                <img src="cid:lerniqo-logo" width="150" alt="Lerniqo" style="display:block;width:150px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;">
              </td>
            </tr>

            <tr>
              <td style="padding:38px 36px 34px;">
                <h1 style="margin:0 0 24px;color:#06285a;font-size:26px;line-height:1.25;font-weight:800;text-align:center;">
                  Passwort zurücksetzen
                </h1>

                <p style="margin:0 0 16px;font-size:16px;line-height:1.65;">Hallo,</p>
                <p style="margin:0 0 22px;font-size:16px;line-height:1.65;">
                  wir haben eine Anfrage erhalten, dein Lerniqo-Passwort zurückzusetzen.
                </p>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f7f9fc;border:1px solid #cbd9eb;border-radius:14px;">
                  <tr>
                    <td align="center" style="padding:24px 16px;">
                      <p style="margin:0 0 12px;color:#172033;font-size:15px;line-height:1.4;font-weight:700;">
                        Dein Bestätigungscode:
                      </p>
                      <p style="margin:0;color:#06285a;font-family:'Courier New',Courier,monospace;font-size:38px;line-height:1.2;font-weight:800;letter-spacing:8px;">
                        ${rawCode}
                      </p>
                    </td>
                  </tr>
                </table>

                <p style="margin:24px 0;font-size:16px;line-height:1.65;">
                  Gib diesen Code in der Lerniqo-App ein. Er ist <strong>10 Minuten gültig</strong>.
                </p>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#fff8e8;border:1px solid #f2b441;border-radius:10px;">
                  <tr>
                    <td style="padding:16px;color:#694f00;font-size:14px;line-height:1.6;">
                      <strong>Sicherheitshinweis:</strong> Wenn du diese Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren. Dein Passwort bleibt unverändert.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:24px 36px;background-color:#f9fbfd;border-top:1px solid #dfe7f1;color:#667085;font-size:13px;line-height:1.6;">
                <strong style="color:#172033;font-size:16px;">Lerniqo</strong><br>
                Deine KI-gestützte Prüfungsvorbereitung für die telC-Sprachprüfung.<br>
                <span style="color:#086bd8;">www.lerniqo.tech</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
    `;

    await this.resend.emails.send({
      from: emailFrom,
      to,
      subject,
      html,
      text,
      attachments: [
        {
          filename: 'lerniqo-logo.png',
          content: logo,
          contentId: 'lerniqo-logo',
        },
      ],
    });
  }
}
