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

  async sendPasswordResetEmail(to: string, rawToken: string): Promise<void> {
    const frontendUrl = this.config.getOrThrow<string>('FRONTEND_URL');
    const emailFrom = this.config.getOrThrow<string>('EMAIL_FROM');
    const resetLink = `${frontendUrl}/reset-password?token=${rawToken}`;

    await this.resend.emails.send({
      from: emailFrom,
      to,
      subject: 'Reset your password',
      html: `<p>Click the link below to reset your password:</p><p><a href="${resetLink}">${resetLink}</a></p>`,
    });
  }
}