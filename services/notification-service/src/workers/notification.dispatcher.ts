import { NotificationRepository } from '../repositories/notification.repository.js';
import { createLogger } from '@urbanfleet/common';
import { sendSendGridEmail } from '../config/sendgrid.config.js';
import {
  getOtpHtml,
  getVerifyEmailHtml,
  getResetPasswordHtml,
  getRideReceiptHtml,
} from '../services/email.service.js';

const logger = createLogger('notification-dispatcher');

interface NotificationPayload {
  subject?: string;
  html?: string;
  token?: string;
  otp?: string;
  rideId?: string;
  paymentId?: string;
  amountPaise?: number | bigint;
  totalFarePaise?: number | bigint;
  pickupAddress?: string;
  dropoffAddress?: string;
  destinationAddress?: string;
  driverName?: string;
  message?: string;
}

export class NotificationDispatcher {
  private isRunning = false;
  private notifRepo: NotificationRepository;

  constructor(notifRepo: NotificationRepository) {
    this.notifRepo = notifRepo;
  }

  start() {
    this.isRunning = true;
    logger.info('Notification Dispatcher started.');
    this.runLoop();
  }

  private async runLoop() {
    while (this.isRunning) {
      try {
        const pending = await this.notifRepo.findPending();
        for (const item of pending) {
          try {
            const payload = (item.payload || {}) as NotificationPayload;
            let subject = payload.subject || 'UrbanFleet Notification';
            let html = payload.html;

            if (item.template === 'EMAIL_VERIFICATION' && payload.token) {
              subject = 'Verify your UrbanFleet account';
              html = getVerifyEmailHtml({ email: item.recipient, token: payload.token });
            } else if (item.template === 'OTP' && payload.otp) {
              subject = `${payload.otp} is your UrbanFleet verification code`;
              html = getOtpHtml({ email: item.recipient, otp: payload.otp });
            } else if (item.template === 'PASSWORD_RESET' && payload.token) {
              subject = 'Reset your UrbanFleet password';
              html = getResetPasswordHtml({ email: item.recipient, token: payload.token });
            } else if (item.template === 'RIDE_RECEIPT') {
              subject = `Your UrbanFleet Ride Receipt - Ride #${payload.rideId || item.id}`;
              html = getRideReceiptHtml({
                email: item.recipient,
                rideId: payload.rideId || 'ride-unknown',
                paymentId: payload.paymentId,
                totalFarePaise: Number(payload.totalFarePaise || 0),
                pickupAddress: payload.pickupAddress,
                dropoffAddress: payload.dropoffAddress,
                driverName: payload.driverName,
              });
            } else if (!html) {
              html = `<p>${payload.message || 'You have a new update on your UrbanFleet account.'}</p>`;
            }

            const response = await sendSendGridEmail({
              to: item.recipient,
              subject,
              html,
            });

            const responseHeaders = (response && 'headers' in response && response.headers)
              ? (response.headers as Record<string, unknown>)
              : {};
            const rawHeader = responseHeaders['x-message-id'];
            const messageId = typeof rawHeader === 'string' ? rawHeader : `sg_${item.id}`;
            logger.info(`Dispatched notification ${item.id} [${item.template}] to ${item.recipient} via SendGrid (${messageId})`);
            await this.notifRepo.markDispatched(item.id, messageId);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`Failed to dispatch notification ${item.id}:`, err);
            await this.notifRepo.recordFailure(item.id, message);
          }
        }
      } catch (err) {
        logger.error('Error in dispatch loop:', err);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  stop() {
    this.isRunning = false;
  }

  isHealthy(): boolean {
    return this.isRunning;
  }
}
