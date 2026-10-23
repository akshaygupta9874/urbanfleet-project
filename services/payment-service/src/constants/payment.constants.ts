import { PaymentStatus, PayoutMode, PayoutStatus } from "../types/payment.types.js";

export const CURRENCY = {
    INR: "INR",
} as const;

export const RAZORPAY_WEBHOOK_EVENTS = {
    PAYMENT_AUTHORIZED: "payment.authorized",
    PAYMENT_CAPTURED: "payment.captured",
    PAYMENT_FAILED: "payment.failed",
    ORDER_PAID: "order.paid",
    REFUND_CREATED: "refund.created",
    REFUND_PROCESSED: "refund.processed",
    REFUND_FAILED: "refund.failed",
    PAYOUT_INITIATED: "payout.initiated",
    PAYOUT_PROCESSED: "payout.processed",
    PAYOUT_REVERSED: "payout.reversed",
    PAYOUT_FAILED: "payout.failed",
    PAYOUT_REJECTED: "payout.rejected",
} as const;

export type RazorpayWebhookEventName = (typeof RAZORPAY_WEBHOOK_EVENTS)[keyof typeof RAZORPAY_WEBHOOK_EVENTS];

export const MIN_PAYMENT_AMOUNT_PAISE = 100;
export const MAX_PAYMENT_AMOUNT_PAISE = 5_000_000;
export const IDEMPOTENCY_LOCK_TTL_MS = 60_000;
export const REFUND_LOCK_TTL_MS = 30_000;
export const WEBHOOK_DEDUPE_TTL_SECONDS = 60 * 60 * 24 * 7;
/** While a webhook is being processed its dedupe key is only a short "in progress" marker. */
export const WEBHOOK_PROCESSING_TTL_SECONDS = 5 * 60;

/** How many times a rider may re-open checkout for the same ride after failures. */
export const MAX_PAYMENT_ATTEMPTS = 8;

/** Reconciliation sweeps (see reconciliation.service.ts). */
export const RECONCILE_MIN_AGE_MINUTES = 10;
export const RECONCILE_MAX_AGE_DAYS = 7;
export const RECONCILE_BATCH_LIMIT = 100;
export const RECONCILE_UNSENT_REFUND_GIVE_UP_MINUTES = 60;

export const REDIS_KEYS = {
    paymentOrderLock: (
        rideId: string
    ): string =>
        `lock:payment:order:${rideId}`,

    refundLock: (
        paymentId: string
    ): string =>
        `lock:payment:refund:${paymentId}`,

    webhookProcessed: (
        eventId: string
    ): string =>
        `webhook:razorpay:processed:${eventId}`,

    reconciliationLock: (): string =>
        "lock:payment:reconciliation",
} as const;

/**
 * Payment statuses from which a gateway "captured" confirmation is accepted.
 * The gateway is the source of truth for money: if it says the money was
 * captured we record it, even if we had provisionally marked the payment FAILED
 * (an earlier attempt on the same Razorpay order failed, a later one succeeded).
 */
export const CAPTURABLE_FROM_STATUSES: readonly PaymentStatus[] = [
    PaymentStatus.CREATED,
    PaymentStatus.PENDING,
    PaymentStatus.AUTHORIZED,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELLED,
];

/** Statuses in which money has been captured (and possibly refunded). */
export const PAID_STATUSES: readonly PaymentStatus[] = [
    PaymentStatus.CAPTURED,
    PaymentStatus.PARTIALLY_REFUNDED,
    PaymentStatus.REFUNDED,
];

export const REFUNDABLE_STATUSES: readonly PaymentStatus[] = [
    PaymentStatus.CAPTURED,
    PaymentStatus.PARTIALLY_REFUNDED,
];

/** Statuses that still wait for money (used by the reconciliation sweep). */
export const UNSETTLED_STATUSES: readonly PaymentStatus[] = [
    PaymentStatus.CREATED,
    PaymentStatus.PENDING,
    PaymentStatus.AUTHORIZED,
    PaymentStatus.FAILED,
];

/** A payout in one of these states still "reserves" the driver's money. */
export const LIVE_PAYOUT_STATUSES: readonly PayoutStatus[] = [
    PayoutStatus.PENDING,
    PayoutStatus.PROCESSING,
    PayoutStatus.PROCESSED,
];

export const RAZORPAY_SIGNATURE_HEADER = "x-razorpay-signature";
export const RAZORPAY_EVENT_ID_HEADER = "x-razorpay-event-id";
export const DEFAULT_PAYOUT_MODE = PayoutMode.IMPS;
export const DEFAULT_PAYOUT_PURPOSE = "payout";
