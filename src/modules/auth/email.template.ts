import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The Lerniqo transactional email shell.
 *
 * Extracted from the password-reset email, which was the only branded message
 * of the six. Table-based layout with inline styles because that is what mail
 * clients render reliably — Outlook in particular ignores most of a stylesheet
 * and much of flexbox. The logo travels as a CID attachment rather than a
 * hosted image so it survives the remote-image blocking most clients apply by
 * default.
 */

const NAVY = '#06285a';
const INK = '#172033';
const PAGE_BG = '#f3f6fa';

export interface EmailContent {
  /** Subject line, also used as the document title. */
  subject: string;
  /** Hidden preview line shown in the inbox list before the body. */
  preheader: string;
  heading: string;
  /** Paragraphs of body copy, rendered above any callout. */
  paragraphs: string[];
  /** A prominent monospace code, for the reset-code emails. */
  code?: { label: string; value: string };
  /** A primary call-to-action button. */
  action?: { label: string; url: string };
  /** Amber security note at the foot of the body. */
  notice?: string;
  /** Plain-text alternative. Required: a text/plain part improves both
   *  deliverability and accessibility, and some clients show nothing without it. */
  text: string;
}

export function readLerniqoLogo(): Buffer {
  return readFileSync(join(__dirname, '..', '..', '..', 'public', 'logo.png'));
}

export const LERNIQO_LOGO_ATTACHMENT = {
  filename: 'lerniqo-logo.png',
  contentId: 'lerniqo-logo',
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function renderLerniqoEmail(content: EmailContent): string {
  const paragraphs = content.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 18px;font-size:16px;line-height:1.65;">${p}</p>`,
    )
    .join('\n');

  const codeBlock = content.code
    ? `
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f7f9fc;border:1px solid #cbd9eb;border-radius:14px;">
                  <tr>
                    <td align="center" style="padding:24px 16px;">
                      <p style="margin:0 0 12px;color:${INK};font-size:15px;line-height:1.4;font-weight:700;">${content.code.label}</p>
                      <p style="margin:0;color:${NAVY};font-family:'Courier New',Courier,monospace;font-size:38px;line-height:1.2;font-weight:800;letter-spacing:8px;">${content.code.value}</p>
                    </td>
                  </tr>
                </table>`
    : '';

  // The URL is also rendered as text: some clients strip or rewrite buttons,
  // and a visible link means the recipient can always copy it by hand.
  const actionBlock = content.action
    ? `
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px auto 20px;">
                  <tr>
                    <td align="center" bgcolor="${NAVY}" style="border-radius:10px;">
                      <a href="${escapeHtml(content.action.url)}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;border-radius:10px;">${content.action.label}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 18px;font-size:13px;line-height:1.6;color:#667085;word-break:break-all;">
                  ${escapeHtml(content.action.url)}
                </p>`
    : '';

  const noticeBlock = content.notice
    ? `
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#fff8e8;border:1px solid #f2b441;border-radius:10px;">
                  <tr>
                    <td style="padding:16px;color:#694f00;font-size:14px;line-height:1.6;">${content.notice}</td>
                  </tr>
                </table>`
    : '';

  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light only">
    <title>${escapeHtml(content.subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${PAGE_BG};font-family:Arial,Helvetica,sans-serif;color:${INK};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(content.preheader)}</div>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:${PAGE_BG};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background-color:#ffffff;border:1px solid #dfe7f1;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(15,35,65,0.08);">
            <tr>
              <td align="center" style="padding:28px 36px;background-color:${NAVY};">
                <img src="cid:lerniqo-logo" width="150" alt="Lerniqo" style="display:block;width:150px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;">
              </td>
            </tr>

            <tr>
              <td style="padding:38px 36px 34px;">
                <h1 style="margin:0 0 24px;color:${NAVY};font-size:26px;line-height:1.25;font-weight:800;text-align:center;">${escapeHtml(content.heading)}</h1>
${paragraphs}
${actionBlock}
${codeBlock}
${noticeBlock}
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:24px 36px;background-color:#f9fbfd;border-top:1px solid #dfe7f1;color:#667085;font-size:13px;line-height:1.6;">
                <strong style="color:${INK};font-size:16px;">Lerniqo</strong><br>
                Deine KI-gestützte Prüfungsvorbereitung für die telC-Sprachprüfung.<br>
                <span style="color:#086bd8;">www.lerniqo.tech</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
