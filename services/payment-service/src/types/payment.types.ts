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

export enum RideStatus {
    SEARCHING = "SEARCHING",
    DRIVER_ASSIGNED = "DRIVER_ASSIGNED",
    DRIVER_ARRIVING = "DRIVER_ARRIVING",
    RIDE_STARTED = "RIDE_STARTED",
    ARRIVED_AT_DESTINATION = "ARRIVED_AT_DESTINATION",
    COMPLETED = "COMPLETED",
    CANCELLED = "CANCELLED",
}

export enum RidePaymentStatus {
    PENDING = "PENDING",
    PAID = "PAID",
    CAPTURED = "CAPTURED",
    FAILED = "FAILED",
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
