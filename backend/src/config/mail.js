// Configurable email sending. With no SMTP_HOST the message is logged to the console so the
// verification and password-reset flows are fully usable in local development.

import nodemailer from 'nodemailer';
import { env } from './env.js';
import logger from '../utils/logger.js';

const transport = env.smtp.host
  ? nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    })
  : null;

/**
 * @returns {Promise<{delivered: boolean}>} delivered=false means it was only logged.
 * Callers on user-facing paths should catch errors: a mail outage must not fail a request.
 */
export async function sendMail({ to, subject, text, html }) {
  if (!transport) {
    logger.info(`[mail:console] to=${to} subject="${subject}"\n${text}`);
    return { delivered: false };
  }
  await transport.sendMail({ from: env.mailFrom, to, subject, text, html });
  return { delivered: true };
}
