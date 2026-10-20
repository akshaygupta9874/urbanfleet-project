import { NotificationRepository } from '../repositories/notification.repository.js';
import { createLogger } from '@urbanfleet/common';
import { Prisma } from '../db/client.js';

const logger = createLogger('notification-service');

export interface RideReceiptPayload {
  rideId: string;
  paymentId: string;
  amountPaise?: number | bigint;
  totalFarePaise?: number | bigint;
  pickupAddress?: string;
  dropoffAddress?: string;
  driverName?: string;
  [key: string]: unknown;
}

export class NotificationService {
  private notifRepo: NotificationRepository;

  constructor(notifRepo: NotificationRepository) {
    this.notifRepo = notifRepo;
  }

  async sendEmail(to: string, subject: string, html: string, idempotencyKey: string) {
    logger.info(`Staging email to ${to}: ${subject} [Key: ${idempotencyKey}]`);
    return this.notifRepo.create({
      recipient: to,
      channel: 'EMAIL',
      template: 'GENERIC',
      idempotencyKey,
      payload: { subject, html },
      status: 'PENDING'
    });
  }

  async sendRideReceipt(to: string, rideDetails: RideReceiptPayload) {
    const idempotencyKey = `receipt_${rideDetails.rideId}_${rideDetails.paymentId}`;
    return this.notifRepo.create({
      recipient: to,
      channel: 'EMAIL',
      template: 'RIDE_RECEIPT',
      idempotencyKey,
      payload: rideDetails as unknown as Prisma.InputJsonValue,
      status: 'PENDING'
    });
  }

  async sendVerificationEmail(to: string, token: string) {
    const idempotencyKey = `verify_${to}_${token}`;
    return this.notifRepo.create({
      recipient: to,
      channel: 'EMAIL',
      template: 'EMAIL_VERIFICATION',
      idempotencyKey,
      payload: { token },
      status: 'PENDING'
    });
  }
}
