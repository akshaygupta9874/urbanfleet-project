import { Types } from "./objectid.js";

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
    ride: Types.ObjectId;
    rider: Types.ObjectId;
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
    requesterId?: Types.ObjectId;
}

export interface InitiateRefundInput {
    paymentId: Types.ObjectId;
    amountPaise?: Paise;
    reason: string;
    initiatedBy: Types.ObjectId;
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
    ownerId?: Types.ObjectId;
}

export interface RecordLedgerTransactionInput {
    entries: LedgerEntryInput[];
    referenceType: LedgerReferenceType;
    referenceId: Types.ObjectId;
    currency?: CurrencyType;
    metadata?: Record<string, unknown>;
    /** Pre-allocated transaction id (lets a caller store it on another document atomically). */
    transactionId?: string;
    /** Logical posting key. A second posting with the same key is rejected by the database. */
    idempotencyKey?: string;
}

export interface CreatePayoutInput {
    driver: Types.ObjectId;
    payment: Types.ObjectId;
    ride: Types.ObjectId;
    amountPaise: Paise;
    mode: PayoutMode;
    metadata?: Record<string, unknown>;
}
