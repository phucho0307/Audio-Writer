import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  /** Plain text first: it is what spam filters and screen readers trust. */
  text: string;
  html: string;
}

/**
 * Outgoing email, through SMTP (SMTP_URL, e.g. a Gmail app password) or
 * Resend's HTTP API.
 *
 * SMTP comes first because it needs no domain of our own: Resend delivers to
 * strangers only from a verified domain, and a free subdomain (DuckDNS) cannot
 * be verified. Gmail sends about 500 a day from a normal account, far more
 * than sign-ups will need before there is a real domain.
 *
 * One fetch, no SDK: the API is a single POST, and a dependency for it would
 * be more code to keep current than the call itself.
 *
 * With no RESEND_API_KEY the message is written to the log instead of sent,
 * so sign-up, verification and password reset all work on a laptop with no
 * account anywhere - the link is in the API's output. In production a missing
 * key is a configuration error and is logged as one.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly key: string;
  private readonly from: string;
  private readonly production: boolean;
  private readonly smtp: Transporter | null;

  constructor(config: ConfigService) {
    const smtpUrl = config.get<string>('SMTP_URL', '');
    this.smtp = smtpUrl ? createTransport(smtpUrl) : null;
    this.key = config.get<string>('RESEND_API_KEY', '');
    // Resend's shared sender works with no domain of our own, but only to
    // the address that owns the Resend account.
    this.from = config.get<string>('MAIL_FROM', 'Nhịp Bút <onboarding@resend.dev>');
    this.production = config.get<string>('NODE_ENV') === 'production';
    if (!this.key && !this.smtp) {
      const say = this.production ? this.logger.error.bind(this.logger) : this.logger.log.bind(this.logger);
      say('Neither SMTP_URL nor RESEND_API_KEY is set: emails are written to this log, not sent');
    }
  }

  /** Resolves false when the provider refused it; callers decide whether that matters. */
  async send(mail: Mail): Promise<boolean> {
    if (this.smtp) {
      try {
        await this.smtp.sendMail({ from: this.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
        return true;
      } catch (err) {
        this.logger.warn(`SMTP refused mail to ${mask(mail.to)}: ${(err as Error).message}`);
        return false;
      }
    }
    if (!this.key) {
      this.logger.log(`[mail not sent] to ${mail.to}: ${mail.subject}\n${mail.text}`);
      return true;
    }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ from: this.from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
      });
      if (!res.ok) {
        this.logger.warn(`Resend refused mail to ${mask(mail.to)}: ${res.status} ${(await res.text()).slice(0, 200)}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(`Resend unreachable: ${(err as Error).message}`);
      return false;
    }
  }
}

/** a***@gmail.com - enough to find it in the log, not enough to harvest. */
export function mask(email: string): string {
  const [user, domain] = email.split('@');
  return `${user.slice(0, 1)}***@${domain ?? ''}`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** One plain, readable layout for every message: a line, a button, the link spelled out. */
export function actionMail(opts: {
  to: string;
  subject: string;
  greeting: string;
  body: string;
  button: string;
  url: string;
  footnote: string;
}): Mail {
  const text = `${opts.greeting}\n\n${opts.body}\n\n${opts.url}\n\n${opts.footnote}\n\n— Nhịp Bút`;
  const html = `<!doctype html><html lang="vi"><body style="margin:0;background:#f4f1ec;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d1a16">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:10px;border:1px solid #e6e0d6">
<tr><td style="padding:28px 28px 8px;font-family:Georgia,serif;font-size:22px">Nhịp Bút</td></tr>
<tr><td style="padding:8px 28px;font-size:15px;line-height:1.6">${esc(opts.greeting)}<br><br>${esc(opts.body)}</td></tr>
<tr><td style="padding:16px 28px"><a href="${esc(opts.url)}" style="display:inline-block;background:#b8862f;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:15px">${esc(opts.button)}</a></td></tr>
<tr><td style="padding:4px 28px 8px;font-size:12.5px;color:#6b6358;line-height:1.5">Nếu nút không bấm được, mở liên kết này:<br><a href="${esc(opts.url)}" style="color:#8a6420;word-break:break-all">${esc(opts.url)}</a></td></tr>
<tr><td style="padding:12px 28px 28px;font-size:12.5px;color:#6b6358;line-height:1.5">${esc(opts.footnote)}</td></tr>
</table></td></tr></table></body></html>`;
  return { to: opts.to, subject: opts.subject, text, html };
}
