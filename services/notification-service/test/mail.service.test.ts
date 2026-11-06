import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import nodemailer from 'nodemailer';
import { getMailTransporter, sendMail, verifyMailConnection, setMailTransporter, closeMailTransporter } from '../src/config/mail.config.js';
import { sendOtpEmail, sendVerifyEmail, sendResetPasswordEmail } from '../src/services/email.service.js';

describe('Nodemailer Email Integration Suite', () => {
  let mockTransporter: any;

  beforeEach(() => {
    mockTransporter = {
      sendMail: vi.fn().mockResolvedValue({
        messageId: '<test-msg-id-123@urbanfleet.com>',
        accepted: ['rider@example.com'],
        rejected: [],
        response: '250 2.0.0 OK',
      }),
      verify: vi.fn().mockResolvedValue(true),
      close: vi.fn(),
    };
    setMailTransporter(mockTransporter);
  });

  afterEach(() => {
    closeMailTransporter();
  });

  it('should send email using configured Nodemailer transporter', async () => {
    const result = await sendMail({
      to: 'rider@example.com',
      subject: 'Welcome to UrbanFleet',
      html: '<h1>Welcome!</h1>',
    });

    expect(result.messageId).toBe('<test-msg-id-123@urbanfleet.com>');
    expect(mockTransporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'rider@example.com',
        subject: 'Welcome to UrbanFleet',
        html: '<h1>Welcome!</h1>',
      })
    );
  });

  it('should verify mail connection successfully', async () => {
    const isConnected = await verifyMailConnection();
    expect(isConnected).toBe(true);
    expect(mockTransporter.verify).toHaveBeenCalled();
  });

  it('should send OTP email using sendOtpEmail', async () => {
    await sendOtpEmail({
      email: 'rider@example.com',
      otp: '987654',
    });

    expect(mockTransporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'rider@example.com',
        subject: expect.stringContaining('987654'),
        html: expect.stringContaining('987654'),
      })
    );
  });

  it('should send email verification link via sendVerifyEmail', async () => {
    await sendVerifyEmail({
      email: 'user@example.com',
      token: 'tok-verify-xyz',
    });

    expect(mockTransporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: expect.stringContaining('Verify your'),
        html: expect.stringContaining('tok-verify-xyz'),
      })
    );
  });

  it('should send password reset email via sendResetPasswordEmail', async () => {
    await sendResetPasswordEmail({
      email: 'user@example.com',
      token: 'tok-reset-xyz',
    });

    expect(mockTransporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: expect.stringContaining('Reset your'),
        html: expect.stringContaining('tok-reset-xyz'),
      })
    );
  });
});
