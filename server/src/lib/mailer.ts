import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Mail delivery.
 *
 * With no SMTP host configured the transport logs the message (including the
 * verification/reset link) instead of sending it, so the whole auth flow is
 * exercisable in development without a mail account. That fallback is explicitly
 * refused in production — silently swallowing a password-reset email would be a
 * lockout waiting to happen.
 */
let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;
  if (!env.SMTP_HOST) return null;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transporter;
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendMail(message: MailMessage): Promise<void> {
  const transport = getTransporter();

  if (!transport) {
    if (env.isProduction) {
      throw new Error('SMTP is not configured — refusing to drop outbound mail in production.');
    }
    logger.info(
      { to: message.to, subject: message.subject, text: message.text },
      '📧 Email (SMTP not configured — logged instead of sent)',
    );
    return;
  }

  try {
    await transport.sendMail({ from: env.MAIL_FROM, ...message });
    logger.info({ to: message.to, subject: message.subject }, 'Email sent');
  } catch (err) {
    logger.error({ err, to: message.to }, 'Failed to send email');
    throw err;
  }
}

// ─────────────────────────────────────────────── Templates

const BRAND = {
  ink: '#16150F',
  paper: '#FBFAF7',
  gold: '#B08D4F',
  muted: '#6F6B60',
  line: '#E6E2D8',
};

function layout(heading: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:${BRAND.paper};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${BRAND.ink}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid ${BRAND.line};border-radius:16px;overflow:hidden">
        <tr><td style="padding:32px 32px 0">
          <div style="font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:${BRAND.gold};font-weight:600">Khata</div>
          <h1 style="margin:16px 0 0;font-size:24px;line-height:1.3;font-weight:600">${heading}</h1>
        </td></tr>
        <tr><td style="padding:16px 32px 0;font-size:15px;line-height:1.65;color:${BRAND.muted}">${bodyHtml}</td></tr>
        ${
          cta
            ? `<tr><td style="padding:28px 32px 0">
                 <a href="${cta.url}" style="display:inline-block;background:${BRAND.ink};color:#fff;text-decoration:none;padding:13px 26px;border-radius:10px;font-size:15px;font-weight:500">${cta.label}</a>
                 <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:${BRAND.muted}">If the button doesn't work, paste this link into your browser:<br><span style="color:${BRAND.gold};word-break:break-all">${cta.url}</span></p>
               </td></tr>`
            : ''
        }
        <tr><td style="padding:32px">
          <hr style="border:none;border-top:1px solid ${BRAND.line};margin:0 0 16px">
          <p style="margin:0;font-size:12px;line-height:1.6;color:${BRAND.muted}">You received this because someone used this address to sign in to Khata. If it wasn't you, you can safely ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function verificationEmail(name: string, url: string): Omit<MailMessage, 'to'> {
  return {
    subject: 'Confirm your email address',
    html: layout(
      `Welcome, ${escapeHtml(name)}`,
      '<p style="margin:0">Confirm your email address to finish setting up your account and secure password recovery.</p>',
      { label: 'Confirm email', url },
    ),
    text: `Welcome, ${name}.\n\nConfirm your email address to finish setting up your Khata account:\n${url}\n\nThis link expires in 1 hour.`,
  };
}

export function passwordResetEmail(name: string, url: string): Omit<MailMessage, 'to'> {
  return {
    subject: 'Reset your password',
    html: layout(
      'Reset your password',
      `<p style="margin:0">Hello ${escapeHtml(name)}, use the button below to choose a new password. This link expires in 1 hour and can be used once.</p>`,
      { label: 'Reset password', url },
    ),
    text: `Hello ${name},\n\nUse this link to choose a new password:\n${url}\n\nIt expires in 1 hour and can be used once. If you didn't request this, ignore this email — your password will not change.`,
  };
}

export function passwordChangedEmail(name: string): Omit<MailMessage, 'to'> {
  return {
    subject: 'Your password was changed',
    html: layout(
      'Your password was changed',
      `<p style="margin:0">Hello ${escapeHtml(name)}, the password for your Khata account was just changed and all other sessions were signed out.</p>
       <p style="margin:12px 0 0">If this wasn't you, reset your password immediately.</p>`,
    ),
    text: `Hello ${name},\n\nThe password for your Khata account was just changed and all other sessions were signed out.\n\nIf this wasn't you, reset your password immediately.`,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
