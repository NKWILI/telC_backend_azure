import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

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

  async sendPasswordResetEmail(to: string, rawCode: string): Promise<void> {
    const emailFrom = this.config.getOrThrow<string>('EMAIL_FROM');

    const html = `
      <p>Guten Tag,</p>
      <p>Sie haben das Zurücksetzen Ihres Passworts angefordert. Ihr Bestätigungscode lautet:</p>
      <p style="font-size: 32px; letter-spacing: 0.25em; font-weight: 700; text-align: center; margin: 24px 0; font-family: 'Courier New', monospace;">${rawCode}</p>
      <p>Geben Sie diesen Code in der App ein, um ein neues Passwort festzulegen. Der Code ist <strong>10 Minuten</strong> gültig.</p>
      <p>Falls Sie keine Zurücksetzung angefordert haben, ignorieren Sie diese E-Mail. Ihr Passwort bleibt unverändert.</p>
    `;

    await this.resend.emails.send({
      from: emailFrom,
      to,
      subject: 'Ihr Passwort-Bestätigungscode',
      html,
    });
  }
}