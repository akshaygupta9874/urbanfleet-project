import 'dotenv/config';
import nodemailer, { type Transporter, type SentMessageInfo } from 'nodemailer';
import { createLogger } from '@urbanfleet/common';

const logger = createLogger('mail-service');

export const APP_NAME = process.env.APP_NAME || 'UrbanFleet';
export const FRONTEND_URL = process.env.FRONTEND_URL || 'https://urbanfleet.duckdns.org';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
}

export interface SendMailResult {
  messageId: string;
  accepted?: (string | unknown)[];
  rejected?: (string | unknown)[];
  response?: string;
}

let transporterInstance: Transporter | null = null;

/**
 * Returns a singleton Nodemailer transporter configured with environment variables.
 */
export function getMailTransporter(): Transporter {
  if (transporterInstance) {
    return transporterInstance;
  }

  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  transporterInstance = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    socketTimeout: 10000,
  });

  return transporterInstance;
}

/**
 * Allows injecting a custom or mock transporter (e.g. for testing).
 */
export function setMailTransporter(transporter: Transporter | null): void {
  transporterInstance = transporter;
}

/**
 * Sends an email using Nodemailer and SMTP details configured in .env.
 */
export async function sendMail(options: SendEmailOptions): Promise<SendMailResult> {
  const transporter = getMailTransporter();
  const defaultFrom =
    process.env.MAIL_FROM ||
    (process.env.SMTP_USER
      ? `"${APP_NAME}" <${process.env.SMTP_USER}>`
      : `"${APP_NAME}" <no-reply@urbanfleet.com>`);

  const mailOptions = {
    from: options.from || defaultFrom,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
    replyTo: options.replyTo,
  };

  try {
    const info: SentMessageInfo = await transporter.sendMail(mailOptions);
    const messageId = info.messageId || `mail_${Date.now()}`;
    logger.info(`Email successfully sent to ${options.to} (Message-ID: ${messageId})`);
    return {
      messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      response: typeof info.response === 'string' ? info.response : undefined,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to send email to ${options.to}:`, {
      error: errorMessage,
      to: options.to,
      subject: options.subject,
    });
    throw error;
  }
}

/**
 * Verifies that the mail server is accessible with the provided SMTP configuration.
 */
export async function verifyMailConnection(): Promise<boolean> {
  try {
    const transporter = getMailTransporter();
    await transporter.verify();
    logger.info('SMTP connection successfully verified with mail server.');
    return true;
  } catch (error: unknown) {
    logger.warn('SMTP connection verification failed:', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Closes the active transporter connection pool.
 */
export function closeMailTransporter(): void {
  if (transporterInstance) {
    transporterInstance.close();
    transporterInstance = null;
  }
}
