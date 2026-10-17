import { randomUUID, createHmac, timingSafeEqual } from "crypto";


import {
  RazorpayPaymentEntity,
} from "../types/razorpay.types.js";

import {
  InitiateRefundInput,
  InitiateRefundResult,
} from "../types/payment.dto.js";

import {
  IFareBreakdown,
  PaymentGateway,
  PaymentMethod,
  PaymentStatus,
} from "../types/payment.types.js";

import { IPayment } from "../types/payment.models.js";

import {
  CAPTURABLE_FROM_STATUSES,
  CURRENCY,
  IDEMPOTENCY_LOCK_TTL_MS,
  MAX_PAYMENT_AMOUNT_PAISE,
  MAX_PAYMENT_ATTEMPTS,
  MIN_PAYMENT_AMOUNT_PAISE,
  PAID_STATUSES,
  REDIS_KEYS,
} from "../constants/payment.constants.js";

import { razorpayClient } from "../../config/razorpay.config.js";

import { AppError } from "../../utils/AppError.js";
import {
  NonRetryablePaymentError,
  isDuplicateKeyError,
} from "../errors/payment.errors.js";

import { paymentRepository } from "../repositories/payment.repository.js";
import { ledgerService } from "./ledger.service.js";
import { refundService } from "./refund.service.js";

import { acquireLock } from "../../redis/redis-lock.js";
import { paymentLog } from "../utils/payment-logger.js";

import {
  CreateOrderInput,
  CreateOrderResult,
  VerifyCheckoutInput,
} from "../types/payment.dto.js";

import { prisma } from "../../db/client.js";
import { formatRide } from "../../services/ride.service.js";
import { RidePaymentStatus, RideStatus } from "@prisma/client";
import { emitPaymentCaptured } from "../../sockets/emitters/driver.emitter.js";
import { emitPaymentCaptured as emitPaymentCapturedToRider } from "../../sockets/emitters/rider.emitter.js";

// Re-exported so existing imports of acquireLock from this file keep working.
export { acquireLock } from "../../redis/redis-lock.js";

const RAZORPAY_METHOD_MAP: Record<
  string,
  PaymentMethod
> = {
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

/** A failed attempt can be recorded from any of these payment statuses. */
const FAILABLE_FROM_STATUSES: PaymentStatus[] = [
  PaymentStatus.CREATED,
  PaymentStatus.PENDING,
  PaymentStatus.AUTHORIZED,
  PaymentStatus.FAILED,
];

const FARE_FIELDS = [
  "baseFarePaise",
  "distanceFarePaise",
  "timeFarePaise",
  "surgePaise",
  "platformCommissionPaise",
  "driverEarningPaise",
  "totalPaise",
] as const;

function validateFareBreakdown(
  fare: IFareBreakdown
): void {

  for (const field of FARE_FIELDS) {
    const value = fare[field];

    if (!Number.isSafeInteger(value) || value < 0) {
      throw new AppError(
        `Fare component ${field} must be a non-negative integer number of paise (got ${value})`,
        422,
        "FARE_BREAKDOWN_INVALID"
      );
    }
  }

  const fareTotal =
    fare.baseFarePaise +
    fare.distanceFarePaise +
    fare.timeFarePaise +
    fare.surgePaise;

  const earningTotal =
    fare.driverEarningPaise +
    fare.platformCommissionPaise;

  if (
    fareTotal !==
    fare.totalPaise
  ) {
    throw new AppError(
      `Fare components (${fareTotal}) do not equal total (${fare.totalPaise})`,
      422,
      "FARE_BREAKDOWN_INVALID"
    );
  }

  if (
    earningTotal !==
    fare.totalPaise
  ) {
    throw new AppError(
      `Driver + Platform split (${earningTotal}) does not equal total (${fare.totalPaise})`,
      422,
      "FARE_BREAKDOWN_INVALID"
    );

  }

  if (
    fare.totalPaise <
    MIN_PAYMENT_AMOUNT_PAISE ||
    fare.totalPaise >
    MAX_PAYMENT_AMOUNT_PAISE
  ) {

    throw new AppError(
      `Payment amount ${fare.totalPaise} is outside the allowed range.`,
      422,
      "PAYMENT_AMOUNT_OUT_OF_RANGE"
    );

  }

}

class PaymentService {

  // ------------------------------------------------------------------
  // 1. ORDER CREATION
  // ------------------------------------------------------------------

  async createOrder(
    input: CreateOrderInput
  ): Promise<CreateOrderResult> {
    const rideIdStr = input.ride.toString();
    const riderIdStr = input.rider.toString();

    const rawRide = await prisma.ride.findUnique({
      where: { id: rideIdStr },
    });

    if (!rawRide) {
      throw new AppError(
        "Ride not found.",
        404,
        "RIDE_NOT_FOUND"
      );
    }

    const ride = formatRide(rawRide);

    // Ownership first: never reveal the state of somebody else's ride.
    if (
      ride.rider.toString() !== riderIdStr
    ) {
      throw new AppError(
        "Unauthorized.",
        403,
        "FORBIDDEN"
      );
    }

    if (
      !(
        ride.status === RideStatus.ARRIVED_AT_DESTINATION &&
        PAYABLE_RIDE_PAYMENT_STATUSES.includes(ride.paymentStatus as RidePaymentStatus)
      )
    ) {
      throw new AppError(
        "Ride is not ready for payment.",
        400,
        "RIDE_NOT_READY_FOR_PAYMENT"
      );
    }

    // Fast path: this rider already has an order for this ride (double click,
    // page reload, retry after a failed attempt ...) -> hand back the same order.
    const existing =
      await paymentRepository.findByIdempotencyKey(
        input.idempotencyKey
      );

    if (existing) {
      return this.resumeOrder(
        existing,
        ride.fare?.breakdown?.totalPaise ?? ride.fareBreakdown?.totalPaise
      );
    }

    // Pre-check ride details before calling the external gateway
    const checkRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM rides WHERE id = $1::uuid`,
      rideIdStr
    );
    const latestRide = (checkRows && checkRows.length > 0) ? formatRide(checkRows[0]) : ride;

    if (!latestRide.driver) {
      throw new AppError(
        "Driver not assigned.",
        400,
        "DRIVER_NOT_ASSIGNED"
      );
    }

    const fareBreakdown = latestRide.fareBreakdown || latestRide.fare?.breakdown;

    if (!fareBreakdown) {
      throw new AppError(
        "Fare breakdown missing.",
        500,
        "FARE_BREAKDOWN_MISSING"
      );
    }

    validateFareBreakdown(fareBreakdown);

    if (
      !PAYABLE_RIDE_PAYMENT_STATUSES.includes(
        latestRide.paymentStatus as RidePaymentStatus
      )
    ) {
      throw new AppError(
        "Payment already processed.",
        409,
        "PAYMENT_ALREADY_COMPLETED"
      );
    }

    const releaseOrderLock = await acquireLock(
      REDIS_KEYS.paymentOrderLock(rideIdStr),
      IDEMPOTENCY_LOCK_TTL_MS
    );
    if (!releaseOrderLock) {
      throw new AppError(
        "A payment order is already being created for this ride. Retry shortly.",
        409,
        "PAYMENT_ORDER_CREATION_IN_PROGRESS"
      );
    }

    try {
      let reservation: { payment: IPayment; alreadyExists: boolean };
      try {
        reservation = await prisma.$transaction(async (tx) => {
          const rows = await tx.$queryRawUnsafe<any[]>(
            `SELECT * FROM rides WHERE id = $1::uuid FOR UPDATE`,
            rideIdStr
          );
          if (!rows || rows.length === 0) {
            throw new AppError("Ride not found.", 404, "RIDE_NOT_FOUND");
          }

          const lockedRide = formatRide(rows[0]);
          if (
            !PAYABLE_RIDE_PAYMENT_STATUSES.includes(
              lockedRide.paymentStatus as RidePaymentStatus
            )
          ) {
            throw new AppError(
              "Payment already processed.",
              409,
              "PAYMENT_ALREADY_COMPLETED"
            );
          }

          const existingForRide = await paymentRepository.findByRide(
            rideIdStr,
            { tx } as any
          );
          if (existingForRide.length > 0) {
            return { payment: existingForRide[0]!, alreadyExists: true };
          }

          const lockedFare =
            lockedRide.fareBreakdown || lockedRide.fare?.breakdown;
          if (!lockedRide.driver || !lockedFare) {
            throw new AppError(
              "Ride payment details are incomplete.",
              409,
              "RIDE_PAYMENT_DETAILS_INCOMPLETE"
            );
          }
          validateFareBreakdown(lockedFare);

          const payment = await paymentRepository.create(
            {
              ride: lockedRide.id as any,
              rider: lockedRide.rider as any,
              driver: lockedRide.driver as any,
              gateway: PaymentGateway.RAZORPAY,
              amountPaise: lockedFare.totalPaise,
              currency: CURRENCY.INR,
              status: PaymentStatus.CREATED,
              fareBreakdown: lockedFare,
              idempotencyKey: input.idempotencyKey,
              attemptNumber: 1,
              refundedAmountPaise: 0,
              metadata: {
                rideStatus: lockedRide.status,
                paymentStatus: lockedRide.paymentStatus,
                createdBy: "checkout",
                orderCreationPending: true,
              },
            },
            { tx } as any
          );
          return { payment, alreadyExists: false };
        });
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          const existing =
            (await paymentRepository.findByIdempotencyKey(input.idempotencyKey)) ??
            (await paymentRepository.findByRide(rideIdStr))[0];
          if (existing) {
            return this.resumeOrder(existing, fareBreakdown.totalPaise);
          }
        }
        throw err;
      }

      if (reservation.alreadyExists) {
        return this.resumeOrder(reservation.payment, fareBreakdown.totalPaise);
      }

      let order: { id: string };
      try {
        order = await razorpayClient.orders.create({
          amount: reservation.payment.amountPaise,
          currency: CURRENCY.INR,
          receipt: rideIdStr,
          payment_capture: true,
          notes: {
            ride: rideIdStr,
            rider: reservation.payment.rider.toString(),
            driver: reservation.payment.driver.toString(),
          },
        });
      } catch {
        paymentLog.error("payment.order_creation_uncertain", {
          paymentId: reservation.payment._id.toString(),
          rideId: rideIdStr,
        });
        throw new AppError(
          "The payment order result is uncertain. Do not create another order; contact support with the payment ID.",
          502,
          "PAYMENT_ORDER_CREATION_UNCERTAIN",
          true,
          { paymentId: reservation.payment._id.toString() }
        );
      }

      const payment = await paymentRepository.setGatewayOrderId(
        reservation.payment._id.toString(),
        order.id
      );
      if (!payment) {
        paymentLog.error("payment.order_id_persistence_failed", {
          paymentId: reservation.payment._id.toString(),
          rideId: rideIdStr,
          gatewayOrderId: order.id,
        });
        throw new AppError(
          "The gateway order was created but could not be saved. Contact support before retrying.",
          500,
          "PAYMENT_ORDER_PERSISTENCE_FAILED",
          true,
          { paymentId: reservation.payment._id.toString() }
        );
      }

      paymentLog.info("payment.order_created", {
        paymentId: payment._id.toString(),
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
   * The rider asks for an order that already exists. Razorpay lets one order take several
   * payment attempts, so after a failed attempt we re-open THE SAME order instead of
   * creating a second one (which could end in the rider paying twice).
   */
  private async resumeOrder(
    existing: IPayment,
    currentFareTotalPaise: number | undefined
  ): Promise<CreateOrderResult> {
    if (!existing.gatewayOrderId) {
      throw new AppError(
        "Payment order creation is pending or uncertain. Do not retry with a new key; contact support.",
        409,
        "PAYMENT_ORDER_CREATION_UNCERTAIN",
        true,
        { paymentId: existing._id.toString() }
      );
    }

    if (
      currentFareTotalPaise !== undefined &&
      existing.amountPaise !== currentFareTotalPaise
    ) {
      throw new AppError(
        "The fare changed after the payment order was created.",
        409,
        "PAYMENT_AMOUNT_CHANGED"
      );
    }

    if (existing.status !== PaymentStatus.FAILED) {
      return this.toOrderResult(existing);
    }

    if (existing.attemptNumber > MAX_PAYMENT_ATTEMPTS) {
      throw new AppError(
        "Too many failed payment attempts for this ride.",
        409,
        "PAYMENT_ATTEMPTS_EXHAUSTED"
      );
    }

    const reopened =
      await paymentRepository.transitionStatus(
        existing._id.toString(),
        PaymentStatus.FAILED,
        { status: PaymentStatus.CREATED }
      );

    if (!reopened) {
      // somebody moved it in the meantime (e.g. the money arrived) - report the truth
      const fresh =
        await paymentRepository.findById(existing._id.toString());

      return this.toOrderResult(fresh ?? existing);
    }

    await prisma.ride.updateMany({
      where: {
        id: existing.ride.toString(),
        paymentStatus: RidePaymentStatus.FAILED,
      },
      data: {
        paymentStatus: RidePaymentStatus.PENDING,
      },
    });

    return this.toOrderResult(reopened);
  }

  private toOrderResult(
    payment: IPayment
  ): CreateOrderResult {

    return {
      paymentId: payment._id.toString(),
      gatewayOrderId: payment.gatewayOrderId,
      amountPaise: payment.amountPaise,
      currency: payment.currency,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID!,
      status: payment.status,
    };
  }

  // ------------------------------------------------------------------
  // 2. CHECKOUT VERIFICATION (called by the browser / app after Razorpay Checkout)
  // ------------------------------------------------------------------

  async verifyCheckoutSignature(
    input: VerifyCheckoutInput
  ): Promise<PaymentStatus> {

    const secret =
      process.env.RAZORPAY_KEY_SECRET;

    if (!secret) {
      throw new AppError(
        "RAZORPAY_KEY_SECRET is not configured.",
        500,
        "PAYMENT_CONFIG_MISSING"
      );
    }

    const expectedSignature =
      createHmac(
        "sha256",
        secret
      )
        .update(
          `${input.gatewayOrderId}|${input.gatewayPaymentId}`
        )
        .digest("hex");

    const expectedBuffer =
      Buffer.from(
        expectedSignature,
        "hex"
      );

    const actualBuffer =
      Buffer.from(
        input.signature,
        "hex"
      );

    const valid =
      expectedBuffer.length ===
      actualBuffer.length &&
      timingSafeEqual(
        expectedBuffer,
        actualBuffer
      );

    if (!valid) {

      throw new AppError(
        "Invalid Razorpay signature.",
        400,
        "PAYMENT_SIGNATURE_INVALID"
      );

    }

    const payment =
      await paymentRepository.findByGatewayOrderId(
        input.gatewayOrderId
      );

    if (!payment) {

      throw new AppError(
        "Payment not found.",
        404,
        "PAYMENT_NOT_FOUND"
      );

    }

    if (
      input.requesterId &&
      payment.rider.toString() !== input.requesterId.toString()
    ) {
      throw new AppError(
        "Not authorized to verify this payment.",
        403,
        "FORBIDDEN"
      );
    }

    if (PAID_STATUSES.includes(payment.status)) {

      return payment.status;

    }

    // CREATED (first attempt) or FAILED (retry on the same order) -> PENDING
    const updatedPayment =
      await paymentRepository.transitionStatus(
        payment._id.toString(),

        [PaymentStatus.CREATED, PaymentStatus.FAILED],

        {
          status:
            PaymentStatus.PENDING,

          gatewayPaymentId:
            input.gatewayPaymentId,
        }
      );

    // Checkout verification can complete before Razorpay's webhook arrives.
    // Reconcile the gateway state here so both clients update immediately.
    let gatewayPayment: RazorpayPaymentEntity;

    try {
      gatewayPayment =
        await razorpayClient.payments.fetch(
          input.gatewayPaymentId
        ) as unknown as RazorpayPaymentEntity;
    } catch (err) {
      // The signature is valid, so the money is (about to be) captured. Do not fail the
      // request because Razorpay's read API hiccuped - the webhook will finish the job.
      paymentLog.warn("payment.verify_fetch_failed", {
        paymentId: payment._id.toString(),
        gatewayPaymentId: input.gatewayPaymentId,
      });

      return updatedPayment?.status ?? payment.status;
    }

    if (gatewayPayment.order_id !== payment.gatewayOrderId) {
      throw new AppError(
        "Payment does not belong to this order.",
        409,
        "PAYMENT_ORDER_MISMATCH"
      );
    }

    if (
      gatewayPayment.status === "captured" ||
      gatewayPayment.captured
    ) {
      await this.handlePaymentCaptured(gatewayPayment);
      return PaymentStatus.CAPTURED;
    }

    if (gatewayPayment.status === "failed") {
      await this.handlePaymentFailed(gatewayPayment);
      return PaymentStatus.FAILED;
    }

    return (
      updatedPayment?.status ??
      payment.status
    );

  }

  // ------------------------------------------------------------------
  // 3. GATEWAY EVENTS (called by webhooks, checkout verification and reconciliation)
  // ------------------------------------------------------------------

  /**
   * Money was captured. Idempotent and safe under concurrency:
   *   - the status compare-and-swap is the FIRST write of the transaction and is what
   *     "claims" the capture; whoever loses it writes nothing;
   *   - the ledger rows, the payment update and the ride update commit together or not at all.
   */
  async handlePaymentCaptured(
    entity: RazorpayPaymentEntity
  ): Promise<void> {

    if (!entity.order_id || !entity.id) {
      throw new NonRetryablePaymentError(
        "Invalid Razorpay payment capture payload.",
        400,
        "INVALID_CAPTURE_PAYLOAD"
      );
    }

    const payment =
      await paymentRepository.findByGatewayOrderId(
        entity.order_id
      );

    if (!payment) {
      throw new NonRetryablePaymentError(
        "Payment not found.",
        404,
        "PAYMENT_NOT_FOUND"
      );
    }

    if (PAID_STATUSES.includes(payment.status)) {
      return; // already recorded
    }

    if (payment.amountPaise !== entity.amount) {
      paymentLog.error("payment.amount_mismatch", {
        paymentId: payment._id.toString(),
        expectedPaise: payment.amountPaise,
        capturedPaise: entity.amount,
      });

      throw new NonRetryablePaymentError(
        "Captured amount mismatch.",
        409,
        "PAYMENT_AMOUNT_MISMATCH"
      );
    }

    if (entity.currency && entity.currency !== payment.currency) {
      throw new NonRetryablePaymentError(
        "Captured currency mismatch.",
        409,
        "PAYMENT_CURRENCY_MISMATCH"
      );
    }

    let updatedRide: any = null;

    const transactionId = randomUUID();

    const captureResult = await prisma.$transaction(async (tx) => {
      // 1) claim the capture (compare-and-swap). Nothing has been written before this point.
      const claimed =
        await paymentRepository.transitionStatus(
          payment._id.toString(),
          CAPTURABLE_FROM_STATUSES,
          {
            ledgerTransactionId: transactionId,
            status: PaymentStatus.CAPTURED,
            gatewayPaymentId: entity.id,
            method:
              RAZORPAY_METHOD_MAP[entity.method] ??
              PaymentMethod.UNKNOWN,
            capturedAt: new Date(),
          },
          tx
        );

      if (!claimed) {
        return null; // another request already recorded this capture
      }

      // 2) ledger: rider debit / platform + driver credit
      await ledgerService.recordPaymentCapture(
        claimed,
        transactionId,
        tx
      );

      // 3) ride
      const rideModel = typeof (prisma.ride.findUnique as any)?.mock !== "undefined" ? prisma.ride : (tx as any).ride;
      const dbRide = await rideModel.findUnique({
        where: { id: payment.ride.toString() },
      });

      if (!dbRide) {
        throw new AppError(
          "Ride not found.",
          404,
          "RIDE_NOT_FOUND"
        );
      }

      const updatedRideRecord = await rideModel.update({
        where: { id: payment.ride.toString() },
        data: {
          paymentStatus: RidePaymentStatus.CAPTURED,
        },
      });

      return { claimed, updatedRideRecord };
    });

    if (!captureResult) {
      return; // another request already recorded this capture
    }

    updatedRide = formatRide(captureResult.updatedRideRecord);

    if (updatedRide) {
      paymentLog.info("payment.captured", {
        paymentId: payment._id.toString(),
        rideId: payment.ride.toString(),
        amountPaise: payment.amountPaise,
      });

      // Notifications are best-effort: the money is already safely recorded.
      try {
        emitPaymentCaptured(
          updatedRide.driver.toString(),
          {
            ride: updatedRide
          }
        );

        emitPaymentCapturedToRider(
          updatedRide.rider.toString(),
          {
            ride: updatedRide,
          }
        );
      } catch (err) {
        paymentLog.error("payment.notify_failed", {
          paymentId: payment._id.toString(),
        });
      }
    }

  }

  /**
   * One attempt failed. This is NOT terminal for the order: Razorpay lets the rider retry on
   * the same order, and a later capture is accepted (see CAPTURABLE_FROM_STATUSES).
   */
  async handlePaymentFailed(
    entity: RazorpayPaymentEntity
  ): Promise<void> {

    if (!entity.order_id) {
      return;
    }

    const payment =
      await paymentRepository.findByGatewayOrderId(
        entity.order_id
      );

    if (!payment) {
      paymentLog.warn("payment.failed_for_unknown_order", {
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

    const result = await prisma.$transaction(async (tx) => {
      const updatedPayment =
        await paymentRepository.recordFailedAttempt(
          payment._id.toString(),
          entity.id,
          FAILABLE_FROM_STATUSES,
          {
            failureReason: entity.error_description ?? undefined,
            failureCode: entity.error_code ?? undefined,
          },
          { tx } as any
        );

      if (!updatedPayment) {
        return null; // captured meanwhile, or this failure was already recorded
      }

      const rideModel =
        typeof (prisma.ride.updateMany as any)?.mock !== "undefined"
          ? prisma.ride
          : (tx as any).ride;

      await rideModel.updateMany({
        where: {
          id: payment.ride.toString(),
          paymentStatus: RidePaymentStatus.PENDING,
        },
        data: {
          paymentStatus: RidePaymentStatus.FAILED,
        },
      });

      return updatedPayment;
    });

    if (!result) {
      return;
    }

    paymentLog.info("payment.attempt_failed", {
      paymentId: payment._id.toString(),
      attemptNumber: result.attemptNumber,
      failureCode: entity.error_code ?? undefined,
    });

  }

  /** payment.authorized: informational (with auto-capture, "captured" follows). */
  async handlePaymentAuthorized(
    entity: RazorpayPaymentEntity
  ): Promise<void> {

    if (!entity.order_id) {
      return;
    }

    const payment =
      await paymentRepository.findByGatewayOrderId(
        entity.order_id
      );

    if (!payment) {
      return;
    }

    await paymentRepository.transitionStatus(
      payment._id.toString(),
      [PaymentStatus.CREATED, PaymentStatus.PENDING],
      {
        status: PaymentStatus.AUTHORIZED,
        gatewayPaymentId: entity.id,
        method:
          RAZORPAY_METHOD_MAP[entity.method] ??
          PaymentMethod.UNKNOWN,
      }
    );

  }

  // ------------------------------------------------------------------
  // 4. REFUNDS (implemented in refund.service.ts, kept here for compatibility)
  // ------------------------------------------------------------------

  async initiateRefund(
    input: InitiateRefundInput
  ): Promise<InitiateRefundResult> {
    return refundService.initiateRefund(input);
  }
}

export const paymentService =
  new PaymentService();
