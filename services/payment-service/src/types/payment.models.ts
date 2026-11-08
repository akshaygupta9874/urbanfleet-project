
import type {
  CurrencyType,
  IFareBreakdown,
  LedgerAccount,
  LedgerEntryType,
  LedgerReferenceType,
  Paise,
  PaymentGateway,
  PaymentMethod,
  PaymentStatus,
  PayoutMode,
  PayoutStatus,
} from "./payment.types.js";

export interface IPayment {
  id: string;
  ride: string;
  rider: string;
  driver: string;
  riderId?: string;
  driverId?: string;

  gateway: PaymentGateway;
  gatewayOrderId: string;
  gatewayPaymentId?: string;

  amountPaise: Paise;
  currency: CurrencyType;
  status: PaymentStatus;
  method?: PaymentMethod;

  fareBreakdown: IFareBreakdown;

  idempotencyKey: string;
  attemptNumber: number;

  failureReason?: string;
  failureCode?: string;
  lastFailedGatewayPaymentId?: string;

  ledgerTransactionId?: string;

  metadata: Record<string, unknown>;

  capturedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export interface ILedgerEntry {
  id: string;
  transactionId: string;
  account: LedgerAccount;
  ownerId?: string;
  entryType: LedgerEntryType;
  amountPaise: Paise;
  currency: CurrencyType;
  referenceType: LedgerReferenceType;
  referenceId: string;

  idempotencyKey?: string;
  legIndex?: number;

  description: string;
  metadata: Record<string, unknown>;

  createdAt: Date;
}

export interface IPayout {
  id: string;
  payment: string;
  ride: string;
  driver: string;

  amountPaise: Paise;
  currency: CurrencyType;

  status: PayoutStatus;
  mode: PayoutMode;

  gatewayPayoutId?: string;
  utr?: string;

  ledgerTransactionId?: string;
  reversalLedgerTransactionId?: string;

  processedAt?: Date;
  failedAt?: Date;
  reversedAt?: Date;

  failureReason?: string;

  metadata: Record<string, unknown>;

  createdAt: Date;
  updatedAt: Date;
}