import { PaymentRepository } from '../repositories/payment.repository.js';
import { RefundRepository } from '../repositories/refund.repository.js';
import { OutboxRepository } from '../repositories/outbox.repository.js';
import { LedgerService } from './ledger.service.js';
import { NotFoundError, AppError } from '@urbanfleet/common';
import { EventTopics } from '@urbanfleet/contracts';
import { razorpayClient } from '../config/razorpay.config.js';
import crypto from 'crypto';

export class PaymentService {
  constructor(
    private paymentRepo: PaymentRepository,
    private refundRepo: RefundRepository,
    private ledgerService: LedgerService,
    private outboxRepo: OutboxRepository
  ) {}

  async createOrder(
    rideIdOrInput: string | { ride?: string; rider?: string; rideId?: string; riderId?: string; idempotencyKey?: string },
    riderIdParam?: string,
    amountPaiseParam?: number,
    driverIdParam?: string
  ) {
    let rideId: string;
    let riderId: string;
    let amountPaise: number = amountPaiseParam || 0;
    let driverId: string | undefined = driverIdParam;

    if (typeof rideIdOrInput === 'object' && rideIdOrInput !== null) {
      rideId = (rideIdOrInput.ride || rideIdOrInput.rideId)!;
      riderId = (rideIdOrInput.rider || rideIdOrInput.riderId)!;
    } else {
      rideId = rideIdOrInput;
      riderId = riderIdParam!;
    }

    const existing = await this.paymentRepo.findByRideId(rideId);
    if (existing) return existing;

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
    } catch (err: any) {
      throw new AppError(`Gateway order creation failed: ${err.message}`, 502, 'GATEWAY_ERROR');
    }

    return this.paymentRepo.create({
      rideId,
      riderId,
      driverId,
      amountPaise,
      gatewayOrderId,
      status: 'PENDING',
      paymentSequence: 1
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
        } catch (err: any) {
          throw new AppError(`Razorpay refund failed: ${err.message}`, 502, 'GATEWAY_ERROR');
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
