import { PaymentRepository } from '../repositories/payment.repository.js';
import { RefundRepository } from '../repositories/refund.repository.js';
import { OutboxRepository } from '../repositories/outbox.repository.js';
import { LedgerService } from './ledger.service.js';
import { NotFoundError, AppError } from '@urbanfleet/common';
import { EventTopics } from '@urbanfleet/contracts';
import { razorpayClient } from '../config/razorpay.config.js';
import type { Prisma } from '../db/client.js';
import crypto from 'crypto';

export class PaymentService {
  private paymentRepo: PaymentRepository;
  private refundRepo: RefundRepository;
  private ledgerService: LedgerService;
  private outboxRepo: OutboxRepository;

  constructor(
    paymentRepo: PaymentRepository,
    refundRepo: RefundRepository,
    ledgerService: LedgerService,
    outboxRepo: OutboxRepository
  ) {
    this.paymentRepo = paymentRepo;
    this.refundRepo = refundRepo;
    this.ledgerService = ledgerService;
    this.outboxRepo = outboxRepo;
  }

  async createOrder(
    input: { rideId: string; riderId: string; amountPaise?: number; driverId?: string; idempotencyKey?: string; fareBreakdown?: Record<string, unknown> }
  ) {
    const { rideId, riderId, amountPaise = 0, driverId, fareBreakdown } = input;

    const existing = await this.paymentRepo.findByRideId(rideId);
    if (existing) {
      if (!existing.fareBreakdown && fareBreakdown) {
        await this.paymentRepo.update(existing.id, {
          fareBreakdown: fareBreakdown as unknown as Prisma.InputJsonValue,
        });
      }
      return existing;
    }

    let finalFareBreakdown = fareBreakdown;
    if (!finalFareBreakdown && rideId) {
      try {
        const { rideClient } = await import('../clients/ride.client.js');
        const rideDetails = await rideClient.getRideById(rideId);
        if (rideDetails?.fare?.breakdown) {
          finalFareBreakdown = rideDetails.fare.breakdown as unknown as Record<string, unknown>;
        }
      } catch {
        // Fallback to standard platform/driver split below
      }
    }

    if (!finalFareBreakdown) {
      const platform = Math.round(amountPaise * 0.2);
      const driver = amountPaise - platform;
      finalFareBreakdown = {
        baseFarePaise: 0,
        distanceFarePaise: 0,
        timeFarePaise: 0,
        surgePaise: 0,
        platformCommissionPaise: platform,
        driverEarningPaise: driver,
        totalPaise: amountPaise,
      };
    }

    let gatewayOrderId: string;
    try {
      const order = await razorpayClient.orders.create({
        amount: amountPaise,
        currency: 'INR',
        receipt: rideId,
        payment_capture: true,
        notes: {
          rideId,
          riderId,
          ...(driverId ? { driverId } : {})
        }
      });
      gatewayOrderId = order.id;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AppError(`Gateway order creation failed: ${message}`, 502, 'GATEWAY_ERROR');
    }

    return this.paymentRepo.create({
      rideId,
      riderId,
      driverId,
      amountPaise,
      gatewayOrderId,
      status: 'PENDING',
      paymentSequence: 1,
      fareBreakdown: finalFareBreakdown as unknown as Prisma.InputJsonValue,
    });
  }

  async verifyPaymentSignature(paymentId: string, gatewayPaymentId: string, signature: string, orderId?: string) {
    const payment = await this.paymentRepo.findById(paymentId);
    if (!payment) throw new NotFoundError('Payment not found');

    const gatewayOrderId = orderId || payment.gatewayOrderId;
    if (!gatewayOrderId) throw new AppError('No gateway order ID associated with payment', 400);

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) throw new AppError('RAZORPAY_KEY_SECRET is not configured', 500);

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${gatewayOrderId}|${gatewayPaymentId}`)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const actualBuffer = Buffer.from(signature, 'hex');

    if (
      expectedBuffer.length !== actualBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
    ) {
      throw new AppError('Invalid payment signature', 400, 'INVALID_SIGNATURE');
    }

    return true;
  }

  async processWebhook(rawBody: string | Buffer, signature: string) {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new AppError('RAZORPAY_WEBHOOK_SECRET is not configured', 500);
    }

    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(bodyStr)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const actualBuffer = Buffer.from(signature, 'hex');

    if (
      expectedBuffer.length !== actualBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
    ) {
      throw new AppError('Invalid webhook signature', 400, 'INVALID_SIGNATURE');
    }

    const payload = JSON.parse(bodyStr);
    return { received: true, event: payload.event };
  }

  async getPaymentDetails(rideId: string) {
    const payment = await this.paymentRepo.findByRideId(rideId);
    if (!payment) throw new NotFoundError('Payment record not found for ride');
    return payment;
  }

  /**
   * Atomic Payment Capture + Balanced Ledger + Outbox Staging
   */
  async capturePaymentWithOutbox(paymentId: string, gatewayPaymentId: string, method = 'UPI') {
    return this.paymentRepo.executeTransaction(async (tx) => {
      const payment = await this.paymentRepo.findById(paymentId, tx);
      if (!payment) throw new NotFoundError('Payment not found');
      if (payment.status === 'CAPTURED') return payment; // Idempotent

      const nextSequence = payment.paymentSequence + 1;

      // 1. Update Payment Status
      const updated = await this.paymentRepo.update(paymentId, {
        status: 'CAPTURED',
        gatewayPaymentId,
        method,
        capturedAt: new Date(),
        paymentSequence: nextSequence
      }, tx);

      // 2. Post balanced ledger entries in SAME transaction
      await this.ledgerService.recordPaymentCapture(tx, updated);

      // 3. Stage Outbox Event in payment database
      await this.outboxRepo.stageEvent(tx, {
        topic: EventTopics.PAYMENT_EVENTS,
        partitionKey: updated.rideId,
        eventType: 'PAYMENT_CAPTURED',
        aggregateType: 'PAYMENT',
        aggregateId: updated.id,
        aggregateSequence: nextSequence,
        payload: {
          paymentId: updated.id,
          rideId: updated.rideId,
          riderId: updated.riderId,
          driverId: updated.driverId,
          amountPaise: updated.amountPaise,
          gatewayPaymentId: updated.gatewayPaymentId,
          capturedAt: updated.capturedAt
        }
      });

      return updated;
    });
  }

  /**
   * Compensating Refund Saga
   */
  async issueRefund(paymentId: string, amountPaise: number, reason?: string) {
    return this.paymentRepo.executeTransaction(async (tx) => {
      const payment = await this.paymentRepo.findById(paymentId, tx);
      if (!payment) throw new NotFoundError('Payment not found');

      let gatewayRefundId: string;
      if (payment.gatewayPaymentId) {
        try {
          const refundResult = await razorpayClient.payments.refund(payment.gatewayPaymentId, {
            amount: amountPaise,
            notes: { reason: reason || 'Ride refund' }
          });
          gatewayRefundId = refundResult.id;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          throw new AppError(`Razorpay refund failed: ${message}`, 502, 'GATEWAY_ERROR');
        }
      } else {
        throw new AppError('Payment has no gateway payment ID to refund', 400);
      }

      const refundTransactionId = crypto.randomUUID();
      const refund = await this.refundRepo.create(tx, {
        paymentId,
        amountPaise,
        reason,
        gatewayRefundId,
        ledgerTransactionId: refundTransactionId,
        status: 'PROCESSED'
      });

      const newRefundedAmount = payment.refundedAmountPaise + amountPaise;
      const isFullRefund = newRefundedAmount >= payment.amountPaise;
      await this.paymentRepo.update(paymentId, {
        status: isFullRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
        refundedAmountPaise: newRefundedAmount,
        refundedAt: new Date()
      }, tx);

      // Stage PaymentRefunded Outbox Event
      await this.outboxRepo.stageEvent(tx, {
        topic: EventTopics.PAYMENT_EVENTS,
        partitionKey: payment.rideId,
        eventType: 'PAYMENT_REFUNDED',
        aggregateType: 'PAYMENT',
        aggregateId: payment.id,
        aggregateSequence: payment.paymentSequence + 1,
        payload: {
          refundId: refund.id,
          paymentId: payment.id,
          rideId: payment.rideId,
          amountPaise,
          reason,
          refundedAt: refund.createdAt
        }
      });

      return refund;
    });
  }
}
