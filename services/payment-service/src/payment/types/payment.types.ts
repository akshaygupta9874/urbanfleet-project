export type Paise = number;
export type CurrencyType = "INR";

export enum PaymentGateway {
    RAZORPAY = "RAZORPAY",
}

export enum PaymentMethod {
    UPI = "UPI",
    CARD = "CARD",
    NETBANKING = "NETBANKING",
    WALLET = "WALLET",
    EMI = "EMI",
    UNKNOWN = "UNKNOWN",
}

export enum PaymentStatus {
    CREATED = "CREATED",
    PENDING = "PENDING",
    AUTHORIZED = "AUTHORIZED",
    CAPTURED = "CAPTURED",
    FAILED = "FAILED",
    REFUNDED = "REFUNDED",
    PARTIALLY_REFUNDED = "PARTIALLY_REFUNDED",
    CANCELLED = "CANCELLED",
}

export enum LedgerAccount {
    RIDER = "RIDER",
    PLATFORM = "PLATFORM",
    DRIVER = "DRIVER",
    /** Money that has left the platform to an external bank account (driver payouts). */
    BANK = "BANK",
}

export enum LedgerEntryType {
    DEBIT = "DEBIT",
    CREDIT = "CREDIT",
}

export enum LedgerReferenceType {
    PAYMENT = "PAYMENT",
    PAYOUT = "PAYOUT",
    REFUND = "REFUND",
    ADJUSTMENT = "ADJUSTMENT",
}

export enum PayoutStatus {
    PENDING = "PENDING",
    PROCESSING = "PROCESSING",
    PROCESSED = "PROCESSED",
    FAILED = "FAILED",
    REVERSED = "REVERSED",
    CANCELLED = "CANCELLED",
}

export enum PayoutMode {
    IMPS = "IMPS",
    NEFT = "NEFT",
    RTGS = "RTGS",
    UPI = "UPI",
}

/** Lifecycle of ONE refund attempt stored inside Payment.refunds[]. */
export enum RefundStatus {
    /** Booked in our ledger, gateway has not confirmed it as processed yet. */
    PENDING = "PENDING",
    /** Gateway confirmed the refund as processed. */
    PROCESSED = "PROCESSED",
    /** Gateway rejected / failed it; the ledger booking was compensated. */
    FAILED = "FAILED",
}

export enum RefundOrigin {
    /** Started through POST /payments/:id/refund. */
    APP = "APP",
    /** Started outside the app (e.g. Razorpay dashboard) and discovered through a webhook. */
    GATEWAY = "GATEWAY",
}

export interface IFareBreakdown {
    baseFarePaise: Paise;
    distanceFarePaise: Paise;
    timeFarePaise: Paise;
    surgePaise: Paise;
    platformCommissionPaise: Paise;
    driverEarningPaise: Paise;
    totalPaise: Paise;
}
