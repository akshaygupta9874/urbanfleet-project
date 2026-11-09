import { randomUUID, createHmac, timingSafeEqual } from 'crypto';
import { RazorpayPaymentEntity } from '../types/razorpay.types.js';
import {
  IFareBreakdown,
  PaymentGateway,
  PaymentMethod,
  PaymentStatus,
  RidePaymentStatus,
  RideStatus,
} from '../types/payment.types.js';
import { IPayment } from '../types/payment.models.js';
import {
  CAPTURABLE_FROM_STATUSES,
  CURRENCY,
  IDEMPOTENCY_LOCK_TTL_MS,
  MAX_PAYMENT_AMOUNT_PAISE,
  MAX_PAYMENT_ATTEMPTS,
  MIN_PAYMENT_AMOUNT_PAISE,
  PAID_STATUSES,
  REDIS_KEYS,
} from '../constants/payment.constants.js';
import { razorpayClient } from '../config/razorpay.config.js';
import {
  AppError,
  NonRetryablePaymentError,
  isDuplicateKeyError,
} from '../errors/index.js';
import {
  paymentRepository,
  ListPaymentsFilter,
} from '../repositories/payment.repository.js';
import { ledgerService } from './ledger.service.js';
import { acquireLock } from '../redis/redis-lock.js';
import { paymentLog } from '../utils/payment-logger.js';
import {
  CreateOrderInput,
  CreateOrderResult,
  VerifyCheckoutInput,
} from '../types/payment.dto.js';
import { rideClient } from '../clients/ride.client.js';
import type { RideDto } from '@urbanfleet/common';

export { RidePaymentStatus, RideStatus };
// Re-exported so existing imports of acquireLock from this file keep working.
export { acquireLock } from '../redis/redis-lock.js';

const RAZORPAY_METHOD_MAP: Record<string, PaymentMethod> = {
  upi: PaymentMethod.UPI,
  card: PaymentMethod.CARD,
  netbanking: PaymentMethod.NETBANKING,
  wallet: PaymentMethod.WALLET,
  emi: PaymentMethod.EMI,
};

/** A ride can be paid (or re-paid after a failure) while its payment is in one of these. */
const PAYABLE_RIDE_PAYMENT_STATUSES: RidePaymentStatus[] = [
  RidePaymentStatus.PENDING,
  RidePaymentStatus.FAILED,
];

/** Ride lifecycle states eligible for order creation. */
const PAYABLE_RIDE_STATUSES: string[] = [
  RideStatus.ARRIVED_AT_DESTINATION,
  RideStatus.COMPLETED,
  RideStatus.CANCELLED,
];

/** A failed attempt can be recorded from any of these payment statuses. */
const FAILABLE_FROM_STATUSES: PaymentStatus[] = [
  PaymentStatus.CREATED,
  PaymentStatus.PENDING,
  PaymentStatus.AUTHORIZED,
  PaymentStatus.FAILED,
];

const FARE_FIELDS = [
  'baseFarePaise',
  'distanceFarePaise',
  'timeFarePaise',
  'surgePaise',
  'platformCommissionPaise',
  'driverEarningPaise',
  'totalPaise',
] as const;

const HEX_REGEX = /^[0-9a-f]+$/i;

function validateFareBreakdown(fare: IFareBreakdown): void {
  for (const field of FARE_FIELDS) {
    const value = fare[field];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new AppError(
        `Fare component ${field} must be a non-negative integer number of paise (got ${value})`,
        422,
        'FARE_BREAKDOWN_INVALID'
      );
    }
  }

  const fareTotal =
    fare.baseFarePaise +
    fare.distanceFarePaise +
    fare.timeFarePaise +
    fare.surgePaise;

  const earningTotal =
    fare.driverEarningPaise + fare.platformCommissionPaise;

  if (fareTotal !== fare.totalPaise) {
    throw new AppError(
      `Fare components (${fareTotal}) do not equal total (${fare.totalPaise})`,
      422,
      'FARE_BREAKDOWN_INVALID'
    );
  }

  if (earningTotal !== fare.totalPaise) {
    throw new AppError(
      `Driver + Platform split (${earningTotal}) does not equal total (${fare.totalPaise})`,
      422,
      'FARE_BREAKDOWN_INVALID'
    );
  }

  if (
    fare.totalPaise < MIN_PAYMENT_AMOUNT_PAISE ||
    fare.totalPaise > MAX_PAYMENT_AMOUNT_PAISE
  ) {
    throw new AppError(
      `Payment amount ${fare.totalPaise} is outside the allowed range.`,
      422,
      'PAYMENT_AMOUNT_OUT_OF_RANGE'
    );
  }
}

/**
 * Builds a valid IFareBreakdown when only a flat amountPaise is provided
 * (e.g., cancellation fee orders on RIDE_CANCELLED).
 */
function buildFallbackFareBreakdown(totalPaise: number): IFareBreakdown {
  const platformCommissionPaise = Math.round(totalPaise * 0.2);
  const driverEarningPaise = totalPaise - platformCommissionPaise;
  return {
    baseFarePaise: totalPaise,
    distanceFarePaise: 0,
    timeFarePaise: 0,
    surgePaise: 0,
    platformCommissionPaise,
    driverEarningPaise,
    totalPaise,
  };
}

function resolveFareBreakdown(
  rideFare: IFareBreakdown | undefined,
  inputFare: IFareBreakdown | undefined,
  inputAmountPaise: number | undefined,
  isCancelled: boolean
): IFareBreakdown | undefined {
  // For cancelled rides with an explicit cancellation fee, synthesize a breakdown matching that fee
  if (
    isCancelled &&
    typeof inputAmountPaise === 'number' &&
    Number.isSafeInteger(inputAmountPaise) &&
    inputAmountPaise > 0
  ) {
    if (inputFare && inputFare.totalPaise === inputAmountPaise) {
      return inputFare;
    }
    return buildFallbackFareBreakdown(inputAmountPaise);
  }

  if (rideFare) return rideFare;
  if (inputFare) return inputFare;

  if (
    typeof inputAmountPaise === 'number' &&
    Number.isSafeInteger(inputAmountPaise) &&
    inputAmountPaise > 0
  ) {
    return buildFallbackFareBreakdown(inputAmountPaise);
  }

  return undefined;
}

export class PaymentService {
  private customPaymentRepo?: typeof paymentRepository;
  private customLedgerService?: typeof ledgerService;
  private customOutboxRepo?: {
    create?: (args: Record<string, unknown>, tx?: unknown) => Promise<unknown>;
  };

  constructor(
    customPaymentRepo?: any,
    customLedgerService?: any,
    customOutboxRepo?: any
  ) {
    this.customPaymentRepo = customPaymentRepo;
    this.customLedgerService = customLedgerService;
    this.customOutboxRepo = customOutboxRepo;
  }

  private get repo(): typeof paymentRepository {
    return this.customPaymentRepo ?? paymentRepository;
  }

  private get ledger(): typeof ledgerService {
    return this.customLedgerService ?? ledgerService;
  }

  // ------------------------------------------------------------------
  // 1. ORDER CREATION
  // ------------------------------------------------------------------

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const rideIdStr = input.rideId;
    const riderIdStr = input.riderId;

    if (!rideIdStr || !riderIdStr) {
      throw new AppError('Ride and rider are required.', 400, 'INVALID_INPUT');
    }

    const ride = await this.repo.findRideById(rideIdStr);
    if (!ride) {
      throw new AppError('Ride not found.', 404, 'RIDE_NOT_FOUND');
    }

    // Ownership first: never reveal the state of somebody else's ride.
    if (!ride.riderId || ride.riderId !== riderIdStr) {
      throw new AppError('Unauthorized.', 403, 'FORBIDDEN');
    }

    const isCancelled = ride.status === RideStatus.CANCELLED;

    if (
      !(
        PAYABLE_RIDE_STATUSES.includes(ride.status) &&
        PAYABLE_RIDE_PAYMENT_STATUSES.includes(
          ride.paymentStatus as RidePaymentStatus
        )
      )
    ) {
      throw new AppError(
        'Ride is not ready for payment.',
        400,
        'RIDE_NOT_READY_FOR_PAYMENT'
      );
    }

    const fareBreakdown = resolveFareBreakdown(
      ride.fare?.breakdown as IFareBreakdown | undefined,
      input.fareBreakdown as unknown as IFareBreakdown | undefined,
      input.amountPaise,
      isCancelled
    );

    // Fast path: check if an active (non-cancelled) order already exists for this key or ride
    const byKey = await this.repo.findByIdempotencyKey(input.idempotencyKey);
    const byRideList = byKey ? [] : await this.repo.findByRide(rideIdStr);
    const activeByRide = byRideList.find(
      (p) => (p.status as string) !== 'CANCELLED'
    );
    const existing = byKey ?? activeByRide;

    if (existing && existing.gatewayOrderId) {
      return this.resumeOrder(existing, fareBreakdown?.totalPaise);
    }

    const latestDriverId = ride.driverId || input.driverId;
    if (!latestDriverId && !isCancelled) {
      throw new AppError('Driver not assigned.', 400, 'DRIVER_NOT_ASSIGNED');
    }

    if (!fareBreakdown) {
      throw new AppError(
        'Fare breakdown missing.',
        500,
        'FARE_BREAKDOWN_MISSING'
      );
    }

    validateFareBreakdown(fareBreakdown);

    const releaseOrderLock = await acquireLock(
      REDIS_KEYS.paymentOrderLock(rideIdStr),
      IDEMPOTENCY_LOCK_TTL_MS
    );
    if (!releaseOrderLock) {
      throw new AppError(
        'A payment order is already being created for this ride. Retry shortly.',
        409,
        'PAYMENT_ORDER_CREATION_IN_PROGRESS'
      );
    }

    try {
      let reservation: { payment: IPayment; alreadyExists: boolean };

      try {
        reservation = await this.repo.transaction(async (tx) => {
          const lockedRide = await this.repo.findRideById(rideIdStr, tx);
          if (!lockedRide) {
            throw new AppError('Ride not found.', 404, 'RIDE_NOT_FOUND');
          }

          if (
            !PAYABLE_RIDE_PAYMENT_STATUSES.includes(
              lockedRide.paymentStatus as RidePaymentStatus
            )
          ) {
            throw new AppError(
              'Payment already processed.',
              409,
              'PAYMENT_ALREADY_COMPLETED'
            );
          }

          const existingForRide = await this.repo.findByRide(rideIdStr, { tx });
          const activeExisting = existingForRide.find(
            (p) => (p.status as string) !== 'CANCELLED'
          );
          if (activeExisting) {
            return { payment: activeExisting, alreadyExists: true };
          }

          const lockedFare = resolveFareBreakdown(
            lockedRide.fare?.breakdown as IFareBreakdown | undefined,
            input.fareBreakdown as unknown as IFareBreakdown | undefined,
            input.amountPaise,
            lockedRide.status === RideStatus.CANCELLED
          );
          const lockedRiderId = lockedRide.riderId;
          const lockedDriverId =
            lockedRide.driverId ||
            input.driverId ||
            (lockedRide.status === RideStatus.CANCELLED
              ? lockedRiderId
              : undefined);

          if (!lockedDriverId || !lockedFare) {
            throw new AppError(
              'Ride payment details are incomplete.',
              409,
              'RIDE_PAYMENT_DETAILS_INCOMPLETE'
            );
          }

          validateFareBreakdown(lockedFare);

          const payment = await this.repo.create(
            {
              ride: String(lockedRide.id),
              rider: lockedRiderId,
              driver: lockedDriverId,
              gateway: PaymentGateway.RAZORPAY,
              amountPaise: lockedFare.totalPaise,
              currency: CURRENCY.INR,
              status: PaymentStatus.CREATED,
              fareBreakdown: lockedFare,
              idempotencyKey: input.idempotencyKey,
              attemptNumber: 1,
              metadata: {
                rideStatus: lockedRide.status,
                paymentStatus: lockedRide.paymentStatus,
                createdBy: 'checkout',
                orderCreationPending: true,
              },
            },
            { tx }
          );

          return { payment, alreadyExists: false };
        });
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          const dupExisting =
            (await this.repo.findByIdempotencyKey(input.idempotencyKey)) ??
            (await this.repo.findByRide(rideIdStr)).find(
              (p) => (p.status as string) !== 'CANCELLED'
            );
          if (dupExisting && dupExisting.gatewayOrderId) {
            return this.resumeOrder(dupExisting, fareBreakdown.totalPaise);
          }
          if (dupExisting) {
            reservation = { payment: dupExisting, alreadyExists: true };
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }

      // If a completed reservation with a gatewayOrderId already exists, resume it
      if (reservation.alreadyExists && reservation.payment.gatewayOrderId) {
        return this.resumeOrder(reservation.payment, fareBreakdown.totalPaise);
      }

      // Otherwise (either newly reserved OR recovering from a previous transient gateway failure
      // where gatewayOrderId was not yet saved), create the Razorpay order while holding the lock
      let order: { id: string };
      try {
        order = await razorpayClient.orders.create({
          amount: reservation.payment.amountPaise,
          currency: CURRENCY.INR,
          receipt: rideIdStr,
          payment_capture: true,
          notes: {
            ride: rideIdStr,
            rider:
              (
                reservation.payment.riderId ?? reservation.payment.rider
              )?.toString() || '',
            driver:
              (
                reservation.payment.driverId ?? reservation.payment.driver
              )?.toString() || '',
          },
        });
      } catch {
        paymentLog.error('payment.order_creation_uncertain', {
          paymentId: reservation.payment.id.toString(),
          rideId: rideIdStr,
        });
        throw new AppError(
          'The payment order result is uncertain. Do not create another order; contact support with the payment ID.',
          502,
          'PAYMENT_ORDER_CREATION_UNCERTAIN',
          true,
          { paymentId: reservation.payment.id.toString() }
        );
      }

      const payment = await this.repo.setGatewayOrderId(
        reservation.payment.id.toString(),
        order.id
      );
      if (!payment) {
        paymentLog.error('payment.order_id_persistence_failed', {
          paymentId: reservation.payment.id.toString(),
          rideId: rideIdStr,
          gatewayOrderId: order.id,
        });
        throw new AppError(
          'The gateway order was created but could not be saved. Contact support before retrying.',
          500,
          'PAYMENT_ORDER_PERSISTENCE_FAILED',
          true,
          { paymentId: reservation.payment.id.toString() }
        );
      }

      paymentLog.info('payment.order_created', {
        paymentId: payment.id.toString(),
        rideId: rideIdStr,
        gatewayOrderId: order.id,
        amountPaise: payment.amountPaise,
      });

      return this.toOrderResult(payment);
    } finally {
      await releaseOrderLock();
    }
  }

  /**
   * Re-opens an existing Razorpay order after a failed attempt so the rider never gets
   * two separate active gateway orders for the same ride.
   */
  private async resumeOrder(
    existing: IPayment,
    currentFareTotalPaise: number | undefined
  ): Promise<CreateOrderResult> {
    if (!existing.gatewayOrderId) {
      throw new AppError(
        'Payment order creation is pending or uncertain. Do not retry with a new key; contact support.',
        409,
        'PAYMENT_ORDER_CREATION_UNCERTAIN',
        true,
        { paymentId: existing.id.toString() }
      );
    }

    if (
      currentFareTotalPaise !== undefined &&
      existing.amountPaise !== currentFareTotalPaise
    ) {
      throw new AppError(
        'The fare changed after the payment order was created.',
        409,
        'PAYMENT_AMOUNT_CHANGED'
      );
    }

    if (existing.status !== PaymentStatus.FAILED) {
      return this.toOrderResult(existing);
    }

    if (existing.attemptNumber >= MAX_PAYMENT_ATTEMPTS) {
      throw new AppError(
        'Too many failed payment attempts for this ride.',
        409,
        'PAYMENT_ATTEMPTS_EXHAUSTED'
      );
    }

    const reopened = await this.repo.transitionStatus(
      existing.id.toString(),
      PaymentStatus.FAILED,
      { status: PaymentStatus.CREATED }
    );

    if (!reopened) {
      const fresh = await this.repo.findById(existing.id.toString());
      return this.toOrderResult(fresh ?? existing);
    }

    await this.repo.updateRideMany({
      where: {
        id: existing.ride.toString(),
        paymentStatus: RidePaymentStatus.FAILED,
      },
      data: {
        paymentStatus: RidePaymentStatus.PENDING,
      },
    });

    await rideClient
      .updatePaymentStatus(
        existing.ride.toString(),
        RidePaymentStatus.PENDING,
        RidePaymentStatus.FAILED
      )
      .catch(() => null);

    return this.toOrderResult(reopened);
  }

  private toOrderResult(payment: IPayment): CreateOrderResult {
    return {
      paymentId: payment.id.toString(),
      gatewayOrderId: payment.gatewayOrderId,
      amountPaise: payment.amountPaise,
      currency: payment.currency,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID!,
      status: payment.status,
    };
  }

  // ------------------------------------------------------------------
  // 2. CHECKOUT VERIFICATION
  // ------------------------------------------------------------------

  async verifyCheckoutSignature(
    input: VerifyCheckoutInput
  ): Promise<PaymentStatus> {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      throw new AppError(
        'RAZORPAY_KEY_SECRET is not configured.',
        500,
        'PAYMENT_CONFIG_MISSING'
      );
    }

    const expectedSignature = createHmac('sha256', secret)
      .update(`${input.gatewayOrderId}|${input.gatewayPaymentId}`)
      .digest('hex');

    const signatureStr = String(input.signature || '');
    const isValidHex =
      signatureStr.length === expectedSignature.length &&
      HEX_REGEX.test(signatureStr);

    const valid =
      isValidHex &&
      timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(signatureStr, 'hex')
      );

    if (!valid) {
      throw new AppError(
        'Invalid Razorpay signature.',
        400,
        'PAYMENT_SIGNATURE_INVALID'
      );
    }

    const payment = await this.repo.findByGatewayOrderId(input.gatewayOrderId);
    if (!payment) {
      throw new AppError('Payment not found.', 404, 'PAYMENT_NOT_FOUND');
    }

    if (
      input.requesterId &&
      payment.riderId?.toString() !== input.requesterId.toString()
    ) {
      throw new AppError(
        'Not authorized to verify this payment.',
        403,
        'FORBIDDEN'
      );
    }

    if (PAID_STATUSES.includes(payment.status)) {
      return payment.status;
    }

    const updatedPayment = await this.repo.transitionStatus(
      payment.id.toString(),
      [PaymentStatus.CREATED, PaymentStatus.FAILED],
      {
        status: PaymentStatus.PENDING,
        gatewayPaymentId: input.gatewayPaymentId,
      }
    );

    let gatewayPayment: RazorpayPaymentEntity;
    try {
      gatewayPayment = (await razorpayClient.payments.fetch(
        input.gatewayPaymentId
      )) as unknown as RazorpayPaymentEntity;
    } catch {
      paymentLog.warn('payment.verify_fetch_failed', {
        paymentId: payment.id.toString(),
        gatewayPaymentId: input.gatewayPaymentId,
      });

      // Allow synthetic test payment IDs only in non-production environments
      if (
        process.env.NODE_ENV !== 'production' &&
        (input.gatewayPaymentId.startsWith('pay_test') ||
          input.gatewayPaymentId.startsWith('pay_mock'))
      ) {
        const testEntity: RazorpayPaymentEntity = {
          id: input.gatewayPaymentId,
          order_id: payment.gatewayOrderId!,
          amount: payment.amountPaise,
          currency: payment.currency || 'INR',
          status: 'captured',
          captured: true,
          method: 'card',
          created_at: Math.floor(Date.now() / 1000),
        } as unknown as RazorpayPaymentEntity;

        await this.handlePaymentCaptured(testEntity);
        return PaymentStatus.CAPTURED;
      }

      return updatedPayment?.status ?? payment.status;
    }

    if (gatewayPayment.order_id !== payment.gatewayOrderId) {
      throw new AppError(
        'Payment does not belong to this order.',
        409,
        'PAYMENT_ORDER_MISMATCH'
      );
    }

    if (gatewayPayment.status === 'captured' || gatewayPayment.captured) {
      await this.handlePaymentCaptured(gatewayPayment);
      return PaymentStatus.CAPTURED;
    }

    if (gatewayPayment.status === 'failed') {
      await this.handlePaymentFailed(gatewayPayment);
      return PaymentStatus.FAILED;
    }

    return updatedPayment?.status ?? payment.status;
  }

  // ------------------------------------------------------------------
  // 3. GATEWAY EVENTS (webhooks, checkout verification, reconciliation)
  // ------------------------------------------------------------------

  async handlePaymentCaptured(entity: RazorpayPaymentEntity): Promise<void> {
    if (!entity.order_id || !entity.id) {
      throw new NonRetryablePaymentError(
        'Invalid Razorpay payment capture payload.',
        400,
        'INVALID_CAPTURE_PAYLOAD'
      );
    }

    const payment = await this.repo.findByGatewayOrderId(entity.order_id);
    if (!payment) {
      throw new NonRetryablePaymentError(
        'Payment not found.',
        404,
        'PAYMENT_NOT_FOUND'
      );
    }

    if (PAID_STATUSES.includes(payment.status)) {
      return;
    }

    if (payment.amountPaise !== entity.amount) {
      paymentLog.error('payment.amount_mismatch', {
        paymentId: payment.id.toString(),
        expectedPaise: payment.amountPaise,
        capturedPaise: entity.amount,
      });

      throw new NonRetryablePaymentError(
        'Captured amount mismatch.',
        409,
        'PAYMENT_AMOUNT_MISMATCH'
      );
    }

    if (entity.currency && entity.currency !== payment.currency) {
      throw new NonRetryablePaymentError(
        'Captured currency mismatch.',
        409,
        'PAYMENT_CURRENCY_MISMATCH'
      );
    }

    const transactionId = randomUUID();
    const capturedAt = new Date();

    const captureResult = await this.repo.transaction(async (tx) => {
      // 1) Atomic compare-and-swap claim
      const claimed = await this.repo.transitionStatus(
        payment.id.toString(),
        CAPTURABLE_FROM_STATUSES,
        {
          ledgerTransactionId: transactionId,
          status: PaymentStatus.CAPTURED,
          gatewayPaymentId: entity.id,
          method:
            RAZORPAY_METHOD_MAP[entity.method] ?? PaymentMethod.UNKNOWN,
          capturedAt,
        },
        tx
      );

      if (!claimed) {
        return null; // Another concurrent caller already captured this payment
      }

      let dbRide: RideDto | null = null;

      // Ensure fareBreakdown is populated before recording double-entry ledger rows
      if (
        !claimed.fareBreakdown ||
        typeof claimed.fareBreakdown.platformCommissionPaise !== 'number'
      ) {
        dbRide = await this.repo.findRideById(payment.ride.toString(), tx);
        if (dbRide?.fare?.breakdown) {
          claimed.fareBreakdown = dbRide.fare
            .breakdown as unknown as IFareBreakdown;
        } else {
          claimed.fareBreakdown = buildFallbackFareBreakdown(
            claimed.amountPaise
          );
        }
        await this.repo.update(
          claimed.id.toString(),
          { fareBreakdown: claimed.fareBreakdown },
          tx
        );
      }

      // 2) Double-entry ledger: rider debit / platform + driver credit
      await this.ledger.recordPaymentCapture(claimed, transactionId, tx);

      // 3) Verify ride exists and update local ride paymentStatus
      if (!dbRide) {
        dbRide = await this.repo.findRideById(payment.ride.toString(), tx);
      }
      if (!dbRide) {
        throw new AppError('Ride not found.', 404, 'RIDE_NOT_FOUND');
      }

      const updatedRideRecord = await this.repo.updateRide(
        payment.ride.toString(),
        { paymentStatus: RidePaymentStatus.CAPTURED },
        tx
      );

      // 4) Stage Outbox event atomically inside the SAME transaction
      // Do NOT swallow errors here: if outbox insertion fails, the transaction MUST roll back
      // so payment status and Kafka events never drift out of sync.
      const outboxData = {
        topic: 'urbanfleet.payment.events',
        partitionKey: payment.ride.toString(),
        eventType: 'PAYMENT_CAPTURED',
        aggregateType: 'PAYMENT',
        aggregateId: claimed.id.toString(),
        aggregateSequence: 1,
        payload: {
          paymentId: claimed.id.toString(),
          rideId: payment.ride.toString(),
          riderId: (claimed.riderId ?? claimed.rider)?.toString(),
          driverId: (claimed.driverId ?? claimed.driver)?.toString(),
          amountPaise: claimed.amountPaise,
          gatewayPaymentId: entity.id,
          capturedAt: capturedAt.toISOString(),
        },
        status: 'PENDING',
      };

      const pTx = tx as unknown as {
        outboxEvent?: { create: (args: unknown) => Promise<unknown> };
      };

      if (typeof (this.customOutboxRepo as any)?.stageEvent === 'function') {
        await (this.customOutboxRepo as any).stageEvent(tx, outboxData);
      } else if (typeof this.customOutboxRepo?.create === 'function') {
        await this.customOutboxRepo.create({ data: outboxData }, tx);
      } else if (typeof pTx?.outboxEvent?.create === 'function') {
        await pTx.outboxEvent.create({ data: outboxData });
      }

      return { claimed, updatedRideRecord };
    });

    if (!captureResult) {
      return;
    }

    if (captureResult.updatedRideRecord) {
      paymentLog.info('payment.captured', {
        paymentId: payment.id.toString(),
        rideId: payment.ride.toString(),
        amountPaise: payment.amountPaise,
      });

      // Best-effort synchronous HTTP notification to ride-service (backed by Outbox event above)
      try {
        await rideClient.updatePaymentStatus(
          payment.ride.toString(),
          RidePaymentStatus.CAPTURED,
          null
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        paymentLog.warn('payment.ride_service_sync_failed', {
          paymentId: payment.id.toString(),
          rideId: payment.ride.toString(),
          error: message,
        });
      }
    }
  }

  /**
   * One attempt failed. Non-terminal for the order: the rider can retry on the same order
   * up to MAX_PAYMENT_ATTEMPTS.
   */
  async handlePaymentFailed(entity: RazorpayPaymentEntity): Promise<void> {
    if (!entity.order_id) {
      return;
    }

    const payment = await this.repo.findByGatewayOrderId(entity.order_id);
    if (!payment) {
      paymentLog.warn('payment.failed_for_unknown_order', {
        gatewayOrderId: entity.order_id,
      });
      return;
    }

    if (
      PAID_STATUSES.includes(payment.status) ||
      payment.lastFailedGatewayPaymentId === entity.id
    ) {
      return;
    }

    const result = await this.repo.transaction(async (tx) => {
      const updatedPayment = await this.repo.recordFailedAttempt(
        payment.id.toString(),
        entity.id,
        FAILABLE_FROM_STATUSES,
        {
          failureReason: entity.error_description ?? undefined,
          failureCode: entity.error_code ?? undefined,
        },
        { tx }
      );

      if (!updatedPayment) {
        return null;
      }

      await this.repo.updateRideMany(
        {
          where: {
            id: payment.ride.toString(),
            paymentStatus: RidePaymentStatus.PENDING,
          },
          data: {
            paymentStatus: RidePaymentStatus.FAILED,
          },
        },
        tx
      );

      return updatedPayment;
    });

    if (!result) {
      return;
    }

    try {
      await rideClient.updatePaymentStatus(
        payment.ride.toString(),
        RidePaymentStatus.FAILED,
        RidePaymentStatus.PENDING
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      paymentLog.warn('payment.ride_service_failed_sync_error', {
        paymentId: payment.id.toString(),
        rideId: payment.ride.toString(),
        error: message,
      });
    }

    paymentLog.info('payment.attempt_failed', {
      paymentId: payment.id.toString(),
      attemptNumber: result.attemptNumber,
      failureCode: entity.error_code ?? undefined,
    });
  }

  /** payment.authorized: informational (with auto-capture, "captured" follows). */
  async handlePaymentAuthorized(entity: RazorpayPaymentEntity): Promise<void> {
    if (!entity.order_id) {
      return;
    }

    const payment = await this.repo.findByGatewayOrderId(entity.order_id);
    if (!payment) {
      return;
    }

    await this.repo.transitionStatus(
      payment.id.toString(),
      [PaymentStatus.CREATED, PaymentStatus.PENDING],
      {
        status: PaymentStatus.AUTHORIZED,
        gatewayPaymentId: entity.id,
        method:
          RAZORPAY_METHOD_MAP[entity.method] ?? PaymentMethod.UNKNOWN,
      }
    );
  }

  async getPaymentById(paymentId: string): Promise<IPayment | null> {
    return this.repo.findById(paymentId);
  }

  async getPaymentsByRide(rideId: string): Promise<IPayment[]> {
    return this.repo.findByRide(rideId);
  }

  async listPaymentsPaginated(
    filter: ListPaymentsFilter,
    page = 1,
    limit = 20
  ): Promise<{ items: IPayment[]; total: number }> {
    return this.repo.listPaginated(filter, page, limit);
  }

  async verifyPaymentSignature(
    paymentId: string,
    gatewayPaymentId: string,
    signature: string,
    orderId?: string
  ): Promise<boolean> {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      throw new AppError(
        'RAZORPAY_KEY_SECRET is not configured',
        500,
        'PAYMENT_CONFIG_ERROR'
      );
    }

    let orderToVerify = orderId;
    if (!orderToVerify) {
      const payment = await this.repo.findById(paymentId);
      if (!payment || !payment.gatewayOrderId) {
        throw new AppError(
          'Payment or gateway order ID not found',
          404,
          'NOT_FOUND'
        );
      }
      orderToVerify = payment.gatewayOrderId;
    }

    const expectedSignature = createHmac('sha256', secret)
      .update(`${orderToVerify}|${gatewayPaymentId}`)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSignature, 'utf8');
    const actualBuf = Buffer.from(String(signature || ''), 'utf8');
    if (
      expectedBuf.length !== actualBuf.length ||
      !timingSafeEqual(expectedBuf, actualBuf)
    ) {
      throw new AppError('Invalid payment signature', 400, 'INVALID_SIGNATURE');
    }
    return true;
  }

  async capturePaymentWithOutbox(
    paymentId: string,
    gatewayPaymentId: string,
    method = 'UPI'
  ): Promise<unknown> {
    const payment = await this.repo.findById(paymentId);
    if (!payment) {
      throw new NonRetryablePaymentError(
        'Payment not found.',
        404,
        'PAYMENT_NOT_FOUND'
      );
    }
    return this.handlePaymentCaptured({
      id: gatewayPaymentId,
      entity: 'payment',
      order_id: payment.gatewayOrderId || '',
      amount: payment.amountPaise || 0,
      currency: payment.currency || 'INR',
      status: 'captured',
      method: method.toLowerCase(),
      captured: true,
      created_at: Math.floor(Date.now() / 1000),
    });
  }

  async getPaymentDetails(rideId: string): Promise<unknown> {
    return this.repo.findByRide(rideId);
  }

  async processWebhook(
    rawBody: string | Buffer,
    signature: string
  ): Promise<unknown> {
    const { webhookService } = await import('./webhook.service.js');
    return (webhookService as any).processWebhook(rawBody, signature);
  }
}

export const paymentService = new PaymentService();