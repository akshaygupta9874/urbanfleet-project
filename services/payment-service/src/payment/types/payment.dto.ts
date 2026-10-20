
import {
    CurrencyType,
    LedgerAccount,
    LedgerEntryType,
    LedgerReferenceType,
    Paise,
    PaymentStatus,
    PayoutMode,
    RefundStatus,
} from "./payment.types.js";

export interface CreateOrderInput {
    rideId: string;
    riderId: string;
    idempotencyKey: string;
}

export interface CreateOrderResult {
    paymentId: string;
    gatewayOrderId: string;
    amountPaise: Paise;
    currency: CurrencyType;
    razorpayKeyId: string;
    status: PaymentStatus;
}

export interface VerifyCheckoutInput {
    gatewayOrderId: string;
    gatewayPaymentId: string;
    signature: string;
    /** The authenticated caller. When supplied it must be the rider that owns the payment. */
    requesterId?: string;
}

export interface InitiateRefundInput {
    paymentId: string;
    amountPaise?: Paise;
    reason: string;
    initiatedBy: string;
}

export interface InitiateRefundResult {
    refundId: string;
    gatewayRefundId?: string;
    amountPaise: Paise;
    refundStatus: RefundStatus;
    paymentStatus: PaymentStatus;
    refundedAmountPaise: Paise;
}

export interface LedgerEntryInput {
    account: LedgerAccount;
    entryType: LedgerEntryType;
    amountPaise: Paise;
    description: string;
    /** Owner of this leg (e.g. the driver whose earning it is). */
    ownerId?: string;
}

export interface RecordLedgerTransactionInput {
    entries: LedgerEntryInput[];
    referenceType: LedgerReferenceType;
    referenceId: string;
    currency?: CurrencyType;
    metadata?: Record<string, unknown>;
    /** Pre-allocated transaction id (lets a caller store it on another document atomically). */
    transactionId?: string;
    /** Logical posting key. A second posting with the same key is rejected by the database. */
    idempotencyKey?: string;
}

export interface CreatePayoutInput {
    driver: string;
    payment: string;
    ride: string;
    amountPaise: Paise;
    mode: PayoutMode;
    metadata?: Record<string, unknown>;
}
