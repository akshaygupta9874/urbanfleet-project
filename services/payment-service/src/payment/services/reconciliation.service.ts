import { razorpayClient } from "../../config/razorpay.config.js";
import { AppError } from "../../utils/AppError.js";

import { paymentRepository } from "../repositories/payment.repository.js";
import { ledgerRepository } from "../repositories/ledger.repository.js";
import { paymentService } from "./payment.service.js";
import { refundService } from "./refund.service.js";

import { paymentLog } from "../utils/payment-logger.js";
import { computeRefundTotals } from "../utils/refund-totals.js";

import {
  LedgerAccount,
  LedgerEntryType,
  LedgerReferenceType,
  PaymentStatus,
  RefundStatus,
} from "../types/payment.types.js";

import { IPayment } from "../types/payment.models.js";
import { RazorpayPaymentEntity, RazorpayRefundEntity } from "../types/razorpay.types.js";

import {
  PAID_STATUSES,
  RECONCILE_BATCH_LIMIT,
  RECONCILE_MAX_AGE_DAYS,
  RECONCILE_MIN_AGE_MINUTES,
  RECONCILE_UNSENT_REFUND_GIVE_UP_MINUTES,
  UNSETTLED_STATUSES,
} from "../constants/payment.constants.js";

export interface PaymentReconciliationReport {
  paymentId: string;
  status: PaymentStatus;
  ledgerTransactionId: string | undefined;
  /** Number of ledger rows that reference this payment (capture + refunds). */
  ledgerEntryCount: number;
  /** True when the gateway showed a capture we had missed and we recorded it. */
  healed: boolean;
  /** Human-readable inconsistencies. Empty means the payment is consistent. */
  issues: string[];
}

export interface SweepSummary {
  checked: number;
  healed: number;
  failed: number;
}

export interface LedgerIntegrityReport {
  balanced: boolean;
  totalDebitPaise: number;
  totalCreditPaise: number;
  unbalancedTransactions: { transactionId: string; debitPaise: number; creditPaise: number }[];
}

interface SweepOptions {
  olderThanMinutes?: number;
  maxAgeDays?: number;
  limit?: number;
}

const minutes = (n: number): number => n * 60_000;
const days = (n: number): number => n * 24 * 60 * 60_000;

/**
 * Compares three sources of truth - the gateway, our payment records and the ledger - and
 * repairs what can be repaired safely (a missed capture / refund webhook). Everything else is
 * REPORTED, never silently "fixed": money discrepancies need a human.
 */
export class ReconciliationService {

  /**
   * Full check of one payment.
   *  1. if it still waits for money, ask the gateway and record a capture we missed;
   *  2. if it is paid, verify the ledger: one balanced capture transaction with the right
   *     legs, refund bookings that add up to refundedAmountPaise.
   */
  async reconcilePayment(
    paymentId: string,
    options: { checkGateway?: boolean } = {}
  ): Promise<PaymentReconciliationReport> {

    let payment = await paymentRepository.findById(paymentId);

    if (!payment) {
      throw new AppError("Payment not found.", 404, "PAYMENT_NOT_FOUND");
    }

    const issues: string[] = [];
    let healed = false;

    if (UNSETTLED_STATUSES.includes(payment.status)) {
      if (!payment.gatewayOrderId) {
        issues.push(
          "Gateway order creation is incomplete or uncertain; reconcile this reservation with the payment gateway before retrying."
        );
      } else {
        healed = await this.healFromGateway(payment);
      }

      if (healed) {
        payment = (await paymentRepository.findById(paymentId)) ?? payment;
      }
    }

    let ledgerEntryCount = 0;

    if (PAID_STATUSES.includes(payment.status)) {
      ledgerEntryCount = await this.checkLedger(payment, issues);

      if (options.checkGateway && payment.gatewayPaymentId) {
        await this.checkAgainstGateway(payment, issues);
      }
    }

    return {
      paymentId,
      status: payment.status,
      ledgerTransactionId: payment.ledgerTransactionId,
      ledgerEntryCount,
      healed,
      issues,
    };
  }

  /** Payments stuck before CAPTURED (missed webhook, closed browser, crash mid-flow). */
  async reconcileStalePayments(options: SweepOptions = {}): Promise<SweepSummary> {
    const olderThan = new Date(
      Date.now() - minutes(options.olderThanMinutes ?? RECONCILE_MIN_AGE_MINUTES)
    );
    const newerThan = new Date(
      Date.now() - days(options.maxAgeDays ?? RECONCILE_MAX_AGE_DAYS)
    );

    const candidates = await paymentRepository.findUnsettled(
      UNSETTLED_STATUSES,
      olderThan,
      newerThan,
      options.limit ?? RECONCILE_BATCH_LIMIT
    );

    const summary: SweepSummary = { checked: 0, healed: 0, failed: 0 };

    for (const payment of candidates) {
      summary.checked++;

      try {
        if (await this.healFromGateway(payment)) {
          summary.healed++;
        }
      } catch (err) {
        summary.failed++;
        paymentLog.error("reconcile.payment_failed", {
          paymentId: payment._id.toString(),
        });
      }
    }

    return summary;
  }

  /**
   * Refunds that are still PENDING after a while: ask the gateway for the truth.
   *  - gateway knows it  -> apply processed / failed exactly like the webhook would;
   *  - gateway never saw it (our request was lost) -> after a grace period undo the booking.
   */
  async reconcilePendingRefunds(options: SweepOptions = {}): Promise<SweepSummary> {
    const olderThan = new Date(
      Date.now() - minutes(options.olderThanMinutes ?? RECONCILE_MIN_AGE_MINUTES)
    );

    const payments = await paymentRepository.findWithPendingRefunds(
      olderThan,
      options.limit ?? RECONCILE_BATCH_LIMIT
    );

    const summary: SweepSummary = { checked: 0, healed: 0, failed: 0 };

    for (const payment of payments) {
      for (const record of payment.refunds) {
        if (record.status !== RefundStatus.PENDING || record.createdAt >= olderThan) {
          continue;
        }

        summary.checked++;

        try {
          let gatewayRefund: RazorpayRefundEntity | undefined;

          if (record.gatewayRefundId) {
            gatewayRefund = (await razorpayClient.refunds.fetch(
              record.gatewayRefundId
            )) as unknown as RazorpayRefundEntity;
          } else if (payment.gatewayPaymentId) {
            // our request may have reached the gateway although we never saw the answer:
            // look for a refund carrying our receipt
            const list = (await razorpayClient.payments.fetchMultipleRefund(
              payment.gatewayPaymentId
            )) as unknown as { items: (RazorpayRefundEntity & { receipt?: string | null })[] };

            gatewayRefund = list.items.find(
              (item) => item.receipt === record._id.toString()
            );
          }

          if (gatewayRefund) {
            const kind =
              gatewayRefund.status === "processed"
                ? "processed"
                : gatewayRefund.status === "failed"
                  ? "failed"
                  : "created";

            await refundService.handleGatewayRefundEvent(kind, gatewayRefund);
            summary.healed++;
            continue;
          }

          const ageMs = Date.now() - record.createdAt.getTime();

          if (
            !record.gatewayRefundId &&
            ageMs > minutes(RECONCILE_UNSENT_REFUND_GIVE_UP_MINUTES)
          ) {
            const undone = await refundService.abandonUnsentRefund(
              payment._id.toString(),
              record._id.toString(),
              "Refund never reached the payment gateway"
            );

            if (undone) {
              summary.healed++;
            }
          }
        } catch (err) {
          summary.failed++;
          paymentLog.error("reconcile.refund_failed", {
            paymentId: payment._id.toString(),
            refundId: record._id.toString(),
          });
        }
      }
    }

    return summary;
  }

  /**
   * Global double-entry invariants:
   *   - every ledger transaction has equal debits and credits;
   *   - the sum of ALL debits equals the sum of ALL credits.
   */
  async verifyLedgerIntegrity(): Promise<LedgerIntegrityReport> {
    const [totals, unbalancedTransactions] = await Promise.all([
      ledgerRepository.sumAll(),
      ledgerRepository.findUnbalancedTransactions(100),
    ]);

    return {
      balanced:
        totals.totalDebitPaise === totals.totalCreditPaise &&
        unbalancedTransactions.length === 0,
      totalDebitPaise: totals.totalDebitPaise,
      totalCreditPaise: totals.totalCreditPaise,
      unbalancedTransactions,
    };
  }

  // ------------------------------------------------------------------ internals

  /** Asks Razorpay which payments exist on the order; records a capture we missed. */
  private async healFromGateway(payment: IPayment): Promise<boolean> {
    if (!payment.gatewayOrderId) {
      paymentLog.warn("reconcile.payment_order_missing", {
        paymentId: payment._id.toString(),
      });
      return false;
    }

    const result = (await razorpayClient.orders.fetchPayments(
      payment.gatewayOrderId
    )) as unknown as { items: RazorpayPaymentEntity[] };

    const captured = result.items.find(
      (item) => item.status === "captured" || item.captured
    );

    if (!captured) {
      return false;
    }

    paymentLog.warn("reconcile.missed_capture_found", {
      paymentId: payment._id.toString(),
      gatewayPaymentId: captured.id,
    });

    await paymentService.handlePaymentCaptured(captured);

    return true;
  }

  private async checkLedger(payment: IPayment, issues: string[]): Promise<number> {
    const entries = await ledgerRepository.listByReference(
      LedgerReferenceType.PAYMENT,
      payment._id
    );

    const transactionIds = new Set(entries.map((entry) => entry.transactionId));

    if (!payment.ledgerTransactionId) {
      issues.push("Payment is captured but has no ledgerTransactionId.");
    } else if (transactionIds.size !== 1 || !transactionIds.has(payment.ledgerTransactionId)) {
      issues.push(
        `Expected exactly one capture ledger transaction (${payment.ledgerTransactionId}), found ${transactionIds.size}.`
      );
    }

    const sum = (type: LedgerEntryType, account?: LedgerAccount): number =>
      entries
        .filter((entry) => entry.entryType === type && (!account || entry.account === account))
        .reduce((total, entry) => total + entry.amountPaise, 0);

    if (sum(LedgerEntryType.DEBIT) !== sum(LedgerEntryType.CREDIT)) {
      issues.push("Capture ledger transaction is unbalanced.");
    }

    if (sum(LedgerEntryType.DEBIT, LedgerAccount.RIDER) !== payment.amountPaise) {
      issues.push("RIDER debit does not equal the payment amount.");
    }

    if (sum(LedgerEntryType.CREDIT, LedgerAccount.DRIVER) !== payment.fareBreakdown.driverEarningPaise) {
      issues.push("DRIVER credit does not equal the driver earning.");
    }

    if (sum(LedgerEntryType.CREDIT, LedgerAccount.PLATFORM) !== payment.fareBreakdown.platformCommissionPaise) {
      issues.push("PLATFORM credit does not equal the platform commission.");
    }

    const refundEntries = await ledgerRepository.listByReference(
      LedgerReferenceType.REFUND,
      payment._id
    );

    let totals;

    try {
      totals = computeRefundTotals(payment);
    } catch {
      issues.push("Refund records are inconsistent with refundedAmountPaise.");
      return entries.length + refundEntries.length;
    }

    const net = (account: LedgerAccount, positive: LedgerEntryType): number =>
      refundEntries
        .filter((entry) => entry.account === account)
        .reduce(
          (total, entry) =>
            total + (entry.entryType === positive ? entry.amountPaise : -entry.amountPaise),
          0
        );

    // Bookings DEBIT driver / platform and CREDIT the rider; compensations do the opposite.
    if (net(LedgerAccount.RIDER, LedgerEntryType.CREDIT) !== totals.refundedPaise) {
      issues.push(
        `Ledger refund total ${net(LedgerAccount.RIDER, LedgerEntryType.CREDIT)} differs from refundedAmountPaise ${totals.refundedPaise}.`
      );
    }

    if (net(LedgerAccount.DRIVER, LedgerEntryType.DEBIT) !== totals.driverReversedPaise) {
      issues.push("Ledger DRIVER refund reversal differs from the refund records.");
    }

    if (net(LedgerAccount.PLATFORM, LedgerEntryType.DEBIT) !== totals.platformReversedPaise) {
      issues.push("Ledger PLATFORM refund reversal differs from the refund records.");
    }

    return entries.length + refundEntries.length;
  }

  private async checkAgainstGateway(payment: IPayment, issues: string[]): Promise<void> {
    const gateway = (await razorpayClient.payments.fetch(
      payment.gatewayPaymentId as string
    )) as unknown as RazorpayPaymentEntity;

    if (gateway.status !== "captured" && gateway.status !== "refunded") {
      issues.push(`Gateway reports the payment as ${gateway.status}.`);
    }

    if (gateway.amount !== payment.amountPaise) {
      issues.push(
        `Gateway amount ${gateway.amount} differs from the payment amount ${payment.amountPaise}.`
      );
    }

    if ((gateway.amount_refunded ?? 0) !== payment.refundedAmountPaise) {
      issues.push(
        `Gateway refunded ${gateway.amount_refunded ?? 0} but we booked ${payment.refundedAmountPaise}.`
      );
    }
  }
}

export const reconciliationService = new ReconciliationService();
