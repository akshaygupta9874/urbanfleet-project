import { Types, ClientSession } from "../types/objectid.js";
import { randomUUID } from "crypto";

import { AppError } from "../../utils/AppError.js";
import { NonRetryablePaymentError, isDuplicateKeyError } from "../errors/payment.errors.js";
import { payoutRepository } from "../repositories/payout.repository.js";
import { paymentRepository } from "../repositories/payment.repository.js";
import { ledgerService } from "./ledger.service.js";
import { prisma } from "../../db/client.js";
import { IPayout } from "../types/payment.models.js";
import { RazorpayPayoutEntity } from "../types/razorpay.types.js";
import { computeRefundTotals } from "../utils/refund-totals.js";
import { paymentLog } from "../utils/payment-logger.js";

import {
  LedgerAccount,
  PayoutMode,
  PayoutStatus,
} from "../types/payment.types.js";

import {
  RAZORPAY_WEBHOOK_EVENTS,
  REFUNDABLE_STATUSES,
} from "../constants/payment.constants.js";

export interface DriverBalance {
  /** Everything ever credited to the driver's ledger account. */
  earnedPaise: number;
  /** Everything ever debited (payouts already disbursed, refund reversals). */
  debitedPaise: number;
  /** earned - debited: what the platform still owes the driver. */
  balancePaise: number;
  /** Payouts requested but not yet PROCESSED (PENDING / PROCESSING). */
  reservedPaise: number;
  /** balance - reserved: what can still be requested as a new payout. */
  availablePaise: number;
}

export class PayoutService {
  /**
   * Creates a PENDING payout for the driver's share of one captured payment.
   * NOTE: this only records the intent. Sending the money (RazorpayX payouts API)
   * is not part of this module; when it is added it must call markProcessing()
   * with the gateway payout id, and pass our payout _id as `reference_id`.
   */
  async createPayout(input: {
    driverId: Types.ObjectId;
    paymentId: Types.ObjectId;
    rideId: Types.ObjectId;
    amountPaise: number;
    mode?: PayoutMode;
    metadata?: Record<string, unknown>;
  }) {
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
      throw new AppError(
        "Payout amount must be a positive integer number of paise.",
        422,
        "PAYOUT_AMOUNT_INVALID"
      );
    }

    const payment = await paymentRepository.findById(input.paymentId.toString());

    if (!payment) {
      throw new AppError("Payment not found.", 404, "PAYMENT_NOT_FOUND");
    }

    if (!REFUNDABLE_STATUSES.includes(payment.status)) {
      throw new AppError(
        `Cannot pay out a payment in status ${payment.status}`,
        409,
        "PAYMENT_NOT_PAYABLE"
      );
    }

    if (
      payment.driver.toString() !== input.driverId.toString() ||
      payment.ride.toString() !== input.rideId.toString()
    ) {
      throw new AppError(
        "Payout driver / ride does not match the payment.",
        409,
        "PAYOUT_PAYMENT_MISMATCH"
      );
    }

    const { driverReversedPaise } = computeRefundTotals(payment);
    const payableShare = payment.fareBreakdown.driverEarningPaise - driverReversedPaise;

    if (input.amountPaise > payableShare) {
      throw new AppError(
        `Payout ${input.amountPaise} exceeds the driver's remaining share ${payableShare}.`,
        422,
        "PAYOUT_EXCEEDS_DRIVER_SHARE"
      );
    }

    const alreadyLive = await payoutRepository.findLiveByPayment(input.paymentId.toString());

    if (alreadyLive) {
      throw new AppError(
        "A payout already exists for this payment.",
        409,
        "PAYOUT_ALREADY_EXISTS"
      );
    }

    try {
      return await payoutRepository.create({
        driver: input.driverId,
        payment: input.paymentId,
        ride: input.rideId,
        amountPaise: input.amountPaise,
        status: PayoutStatus.PENDING,
        mode: input.mode ?? PayoutMode.IMPS,
        metadata: input.metadata ?? {},
      });
    } catch (err) {
      // two requests raced past the check above - the partial unique index decided
      if (isDuplicateKeyError(err)) {
        throw new AppError(
          "A payout already exists for this payment.",
          409,
          "PAYOUT_ALREADY_EXISTS"
        );
      }
      throw err;
    }
  }

  /** PENDING -> PROCESSING (the gateway accepted the payout request). */
  async markProcessing(payoutId: string, gatewayPayoutId?: string) {
    const update: Partial<IPayout> = { status: PayoutStatus.PROCESSING };

    if (gatewayPayoutId) {
      update.gatewayPayoutId = gatewayPayoutId;
    }

    const updated = await payoutRepository.transition(
      payoutId,
      [PayoutStatus.PENDING],
      update
    );

    return updated ?? this.requirePayout(payoutId);
  }

  /**
   * PENDING / PROCESSING -> PROCESSED and, in the SAME database transaction, the ledger
   * posting DEBIT DRIVER / CREDIT BANK. Idempotent: calling it again is a no-op.
   */
  async markProcessed(payoutId: string, gatewayPayoutId?: string, utr?: string) {
    const transactionId = randomUUID();

    const update: Partial<IPayout> = {
      status: PayoutStatus.PROCESSED,
      processedAt: new Date(),
      ledgerTransactionId: transactionId,
    };

    if (gatewayPayoutId) {
      update.gatewayPayoutId = gatewayPayoutId;
    }

    if (utr) {
      update.utr = utr;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const res = await payoutRepository.transition(
        payoutId,
        [PayoutStatus.PENDING, PayoutStatus.PROCESSING],
        update,
        tx
      );

      if (res) {
        await ledgerService.recordPayoutDisbursement(
          {
            payoutId: res._id,
            driverId: res.driver,
            amountPaise: res.amountPaise,
            transactionId,
          },
          tx
        );
      }

      return res;
    });

    return updated ?? this.requirePayout(payoutId);
  }

  /** PENDING / PROCESSING -> FAILED. Nothing was posted to the ledger yet, so nothing to undo. */
  async markFailed(payoutId: string, reason?: string, gatewayPayoutId?: string) {
    const update: Partial<IPayout> = {
      status: PayoutStatus.FAILED,
      failureReason: reason ?? "Unknown payout failure",
      failedAt: new Date(),
    };

    if (gatewayPayoutId) {
      update.gatewayPayoutId = gatewayPayoutId;
    }

    const updated = await payoutRepository.transition(
      payoutId,
      [PayoutStatus.PENDING, PayoutStatus.PROCESSING],
      update
    );

    return updated ?? this.requirePayout(payoutId);
  }

  /** PENDING -> CANCELLED (e.g. the ride was refunded before the money was sent). */
  async cancelPending(payoutId: string, reason: string, session?: ClientSession) {
    return payoutRepository.transition(
      payoutId,
      [PayoutStatus.PENDING],
      {
        status: PayoutStatus.CANCELLED,
        failureReason: reason,
      },
      session
    );
  }

  /**
   * The bank returned money that had been PROCESSED. The ledger posting of the disbursement
   * is undone (DEBIT BANK / CREDIT DRIVER) in the same transaction as the status change.
   * If we never saw the payout as PROCESSED there is nothing to undo: it simply FAILED.
   */
  async markReversed(payoutId: string, reason?: string, gatewayPayoutId?: string) {
    const current = await this.requirePayout(payoutId);

    if (
      current.status === PayoutStatus.PENDING ||
      current.status === PayoutStatus.PROCESSING
    ) {
      return this.markFailed(payoutId, reason ?? "Payout reversed", gatewayPayoutId);
    }

    if (current.status !== PayoutStatus.PROCESSED) {
      return current; // already REVERSED / FAILED / CANCELLED
    }

    const transactionId = randomUUID();
    const failureReason = reason ?? "Payout reversed by the bank";

    const updated = await prisma.$transaction(async (tx) => {
      const res = await payoutRepository.transition(
        payoutId,
        [PayoutStatus.PROCESSED],
        {
          status: PayoutStatus.REVERSED,
          reversedAt: new Date(),
          failureReason,
          reversalLedgerTransactionId: transactionId,
        },
        tx
      );

      if (res) {
        await ledgerService.recordPayoutReversal(
          {
            payoutId: res._id,
            driverId: res.driver,
            amountPaise: res.amountPaise,
            transactionId,
            reason: failureReason,
          },
          tx
        );
      }

      return res;
    });

    return updated ?? this.requirePayout(payoutId);
  }

  /**
   * Called by the refund flow, INSIDE its transaction, after the driver's share of a payment
   * was reduced.
   *  - payout still PENDING          -> cancelled (create a new, smaller one later)
   *  - payout PROCESSING / PROCESSED -> money is (being) sent: flag a clawback; the driver's
   *                                     ledger balance simply goes lower / negative.
   */
  async handleRefundBooked(
    paymentId: Types.ObjectId,
    driverReversalPaise: number,
    session?: ClientSession
  ): Promise<{ cancelledPayoutId?: string; clawbackRequired: boolean }> {
    if (driverReversalPaise <= 0) {
      return { clawbackRequired: false };
    }

    const payout = await payoutRepository.findLiveByPayment(paymentId.toString(), session);

    if (!payout) {
      return { clawbackRequired: false };
    }

    if (payout.status === PayoutStatus.PENDING) {
      const cancelled = await this.cancelPending(
        payout._id.toString(),
        "Cancelled: payment was refunded",
        session
      );

      if (cancelled) {
        return { cancelledPayoutId: cancelled._id.toString(), clawbackRequired: false };
      }
    }

    return { clawbackRequired: true };
  }

  /** How much the platform owes a driver and how much of it is already spoken for. */
  async getDriverBalance(driverId: Types.ObjectId): Promise<DriverBalance> {
    const owner = await ledgerService.getOwnerBalance(LedgerAccount.DRIVER, driverId);

    const reservedPaise = await payoutRepository.sumAmountByDriver(
      driverId.toString(),
      [PayoutStatus.PENDING, PayoutStatus.PROCESSING]
    );

    return {
      earnedPaise: owner.totalCreditPaise,
      debitedPaise: owner.totalDebitPaise,
      balancePaise: owner.netCreditPaise,
      reservedPaise,
      availablePaise: owner.netCreditPaise - reservedPaise,
    };
  }

  /** Entry point for payout.* webhooks. */
  async handleGatewayPayoutEvent(
    event: string,
    entity: RazorpayPayoutEntity
  ): Promise<void> {
    let payout = await payoutRepository.findByGatewayPayoutId(entity.id);

    if (!payout && entity.reference_id && Types.ObjectId.isValid(entity.reference_id)) {
      payout = await payoutRepository.findById(entity.reference_id);
    }

    if (!payout) {
      throw new NonRetryablePaymentError(
        "Payout not found for webhook.",
        404,
        "PAYOUT_NOT_FOUND"
      );
    }

    const id = payout._id.toString();
    const events = RAZORPAY_WEBHOOK_EVENTS;

    switch (event) {
      case events.PAYOUT_INITIATED:
        await this.markProcessing(id, entity.id);
        break;

      case events.PAYOUT_PROCESSED: {
        const result = await this.markProcessed(id, entity.id, entity.utr ?? undefined);

        if (result.status !== PayoutStatus.PROCESSED) {
          paymentLog.error("payout.processed_in_unexpected_state", {
            payoutId: id,
            status: result.status,
          });
        }
        break;
      }

      case events.PAYOUT_FAILED:
      case events.PAYOUT_REJECTED:
        await this.markFailed(
          id,
          entity.failure_reason ?? `Gateway reported ${event}`,
          entity.id
        );
        break;

      case events.PAYOUT_REVERSED:
        await this.markReversed(
          id,
          entity.failure_reason ?? "Payout reversed by the bank",
          entity.id
        );
        break;

      default:
        break;
    }
  }

  private async requirePayout(payoutId: string): Promise<IPayout> {
    const payout = await payoutRepository.findById(payoutId);

    if (!payout) {
      throw new AppError("Payout not found.", 404, "PAYOUT_NOT_FOUND");
    }

    return payout;
  }
}

export const payoutService = new PayoutService();
