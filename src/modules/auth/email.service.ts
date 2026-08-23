import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import {
  LERNIQO_LOGO_ATTACHMENT,
  readLerniqoLogo,
  renderLerniqoEmail,
  type EmailContent,
} from './email.template';

@Injectable()
export class EmailService {
  private readonly resend: Resend;

  constructor(private readonly config: ConfigService) {
    this.resend = new Resend(this.config.getOrThrow<string>('RESEND_API_KEY'));
  }

  /**
   * Every transactional email leaves through here, so the branded shell, the
   * CID logo attachment and the plain-text alternative cannot be forgotten on
   * a new message — which is how five of the six ended up unbranded before.
   */
  private async send(to: string, content: EmailContent): Promise<void> {
    await this.resend.emails.send({
      from: this.config.getOrThrow<string>('EMAIL_FROM'),
      to,
      subject: content.subject,
      html: renderLerniqoEmail(content),
      text: content.text,
      attachments: [{ ...LERNIQO_LOGO_ATTACHMENT, content: readLerniqoLogo() }],
    });
  }

  /**
   * Trailing slashes are stripped here rather than trusted to whoever edits
   * the environment. `https://www.lerniqo.tech/` would otherwise build
   * `...tech//verify-email`, which some routers answer with a 404 — and the
   * failure would only ever be visible in a real inbox.
   */
  private getVitrineUrl(): string {
    const configured =
      this.config.get<string>('VITRINE_URL') ||
      this.config.getOrThrow<string>('FRONTEND_URL');

    return configured.trim().replace(/\/+$/, '');
  }

  /**
   * Both audiences verify on the same website page. The `type` parameter is
   * what tells that page which endpoint to call, so a center token is never
   * sent to the student verifier.
   */
  private verificationLink(rawToken: string, isCenter: boolean): string {
    const suffix = isCenter ? '&type=center' : '';
    return `${this.getVitrineUrl()}/verify-email?token=${rawToken}${suffix}`;
  }

  async sendVerificationEmail(to: string, rawToken: string): Promise<void> {
    const link = this.verificationLink(rawToken, false);

    await this.send(to, {
      subject: 'Bestätige deine E-Mail-Adresse',
      preheader: 'Nur noch ein Schritt bis zu deinem Lerniqo-Konto.',
      heading: 'E-Mail-Adresse bestätigen',
      paragraphs: [
        'Willkommen bei Lerniqo.',
        'Bestätige deine E-Mail-Adresse, um dein Konto zu aktivieren:',
      ],
      action: { label: 'E-Mail bestätigen', url: link },
      notice:
        'Wenn du kein Konto erstellt hast, kannst du diese E-Mail ignorieren.',
      text: [
        'E-Mail-Adresse bestätigen',
        '',
        'Willkommen bei Lerniqo.',
        'Bestätige deine E-Mail-Adresse, um dein Konto zu aktivieren:',
        link,
        '',
        'Wenn du kein Konto erstellt hast, kannst du diese E-Mail ignorieren.',
      ].join('\n'),
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
    const link = this.verificationLink(rawToken, false);

    await this.send(to, {
      subject: 'Schließe die Einrichtung deines Kontos ab',
      preheader: 'Für diese Adresse gibt es bereits ein unbestätigtes Konto.',
      heading: 'Konto noch nicht bestätigt',
      paragraphs: [
        'Für diese E-Mail-Adresse wurde bereits ein Konto angelegt, das noch nicht bestätigt ist.',
        'Bestätige es mit diesem neuen Link:',
      ],
      action: { label: 'E-Mail bestätigen', url: link },
      notice:
        'Dein Passwort wurde nicht geändert. Wenn du es nicht mehr weißt, bestätige zuerst deine Adresse und nutze dann die Funktion &bdquo;Passwort vergessen&ldquo;. Wenn du kein Konto erstellen wolltest, kannst du diese E-Mail ignorieren &mdash; es hat sich nichts geändert.',
      text: [
        'Konto noch nicht bestätigt',
        '',
        'Für diese E-Mail-Adresse wurde bereits ein Konto angelegt, das noch nicht bestätigt ist.',
        'Bestätige es mit diesem neuen Link:',
        link,
        '',
        'Dein Passwort wurde nicht geändert.',
      ].join('\n'),
    });
  }

  async sendCenterVerificationEmail(
    to: string,
    rawToken: string,
  ): Promise<void> {
    const link = this.verificationLink(rawToken, true);

    await this.send(to, {
      subject: 'Bestätigen Sie Ihr Lerniqo-Sprachschulkonto',
      preheader: 'Nur noch ein Schritt bis zu Ihrem Sprachschulkonto.',
      heading: 'Sprachschulkonto bestätigen',
      paragraphs: [
        'Willkommen bei Lerniqo für Sprachschulen.',
        'Bestätigen Sie Ihre E-Mail-Adresse, um die Einrichtung Ihres Sprachschulkontos abzuschließen:',
      ],
      action: { label: 'E-Mail bestätigen', url: link },
      notice:
        'Wenn Sie dieses Konto nicht angefordert haben, können Sie diese E-Mail ignorieren.',
      text: [
        'Sprachschulkonto bestätigen',
        '',
        'Willkommen bei Lerniqo für Sprachschulen.',
        'Bestätigen Sie Ihre E-Mail-Adresse, um die Einrichtung abzuschließen:',
        link,
        '',
        'Wenn Sie dieses Konto nicht angefordert haben, können Sie diese E-Mail ignorieren.',
      ].join('\n'),
    });
  }

  async sendExistingCenterVerificationEmail(
    to: string,
    rawToken: string,
  ): Promise<void> {
    const link = this.verificationLink(rawToken, true);

    await this.send(to, {
      subject: 'Schließen Sie die Einrichtung Ihres Sprachschulkontos ab',
      preheader:
        'Für diese Adresse besteht bereits ein unbestätigtes Sprachschulkonto.',
      heading: 'Konto noch nicht bestätigt',
      paragraphs: [
        'Für diese E-Mail-Adresse besteht bereits ein unbestätigtes Sprachschulkonto.',
        'Bestätigen Sie es mit diesem neuen Link:',
      ],
      action: { label: 'E-Mail bestätigen', url: link },
      notice:
        'Ihr Passwort und Ihre Sprachschuldaten wurden nicht geändert. Wenn Sie das Passwort nicht mehr kennen, bestätigen Sie zuerst Ihre E-Mail-Adresse und nutzen Sie dann die Funktion &bdquo;Passwort vergessen&ldquo;. Wenn Sie dies nicht angefordert haben, können Sie diese E-Mail ignorieren.',
      text: [
        'Konto noch nicht bestätigt',
        '',
        'Für diese E-Mail-Adresse besteht bereits ein unbestätigtes Sprachschulkonto.',
        'Bestätigen Sie es mit diesem neuen Link:',
        link,
        '',
        'Ihr Passwort wurde nicht geändert.',
      ].join('\n'),
    });
  }

  async sendCenterPasswordResetEmail(
    to: string,
    rawCode: string,
  ): Promise<void> {
    await this.send(to, {
      subject: 'Ihr Lerniqo-Code zum Zurücksetzen des Passworts',
      preheader:
        'Mit diesem Code setzen Sie das Passwort Ihres Sprachschulkontos zurück.',
      heading: 'Passwort zurücksetzen',
      paragraphs: [
        'Wir haben eine Anfrage erhalten, das Passwort Ihres Lerniqo-Sprachschulkontos zurückzusetzen.',
      ],
      code: { label: 'Ihr Bestätigungscode:', value: rawCode },
      notice:
        '<strong>Sicherheitshinweis:</strong> Der Code ist 10 Minuten gültig. Beim Zurücksetzen werden alle angemeldeten Geräte abgemeldet. Wenn Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren &mdash; Ihr Passwort bleibt unverändert.',
      text: [
        'Passwort zurücksetzen',
        '',
        'Wir haben eine Anfrage erhalten, das Passwort Ihres Lerniqo-Sprachschulkontos zurückzusetzen.',
        '',
        `Ihr Bestätigungscode: ${rawCode}`,
        '',
        'Der Code ist 10 Minuten gültig. Beim Zurücksetzen werden alle angemeldeten Geräte abgemeldet.',
        'Wenn Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.',
      ].join('\n'),
    });
  }

  async sendPasswordResetEmail(to: string, rawCode: string): Promise<void> {
    await this.send(to, {
      subject: 'Dein Lerniqo-Code zum Zurücksetzen des Passworts',
      preheader:
        'Mit diesem Code kannst du dein Lerniqo-Passwort zurücksetzen.',
      heading: 'Passwort zurücksetzen',
      paragraphs: [
        'Hallo,',
        'wir haben eine Anfrage erhalten, dein Lerniqo-Passwort zurückzusetzen.',
      ],
      code: { label: 'Dein Bestätigungscode:', value: rawCode },
      notice:
        '<strong>Sicherheitshinweis:</strong> Gib diesen Code in der Lerniqo-App ein. Er ist 10 Minuten gültig. Wenn du diese Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren &mdash; dein Passwort bleibt unverändert.',
      text: [
        'Passwort zurücksetzen',
        '',
        'Hallo,',
        '',
        'wir haben eine Anfrage erhalten, dein Lerniqo-Passwort zurückzusetzen.',
        '',
        `Dein Bestätigungscode: ${rawCode}`,
        '',
        'Gib diesen Code in der Lerniqo-App ein. Er ist 10 Minuten gültig.',
        '',
        'Wenn du diese Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren.',
      ].join('\n'),
    });
  }
}
