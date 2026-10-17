import { Types } from "./objectid.js";

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
  RefundOrigin,
  RefundStatus,
} from "./payment.types.js";

/** One refund attempt (sub-document of Payment.refunds). */
export interface IRefundRecord {
  _id: Types.ObjectId;
  gatewayRefundId?: string;
  amountPaise: Paise;
  status: RefundStatus;
  origin: RefundOrigin;
  reason: string;
  initiatedBy?: Types.ObjectId;

  driverReversalPaise: Paise;
  platformReversalPaise: Paise;

  ledgerTransactionId?: string;
  compensationLedgerTransactionId?: string;

  driverClawbackRequired: boolean;

  failureReason?: string;
  processedAt?: Date;
  createdAt: Date;
}

export interface IPayment {
  _id: Types.ObjectId;
  ride: Types.ObjectId;
  rider: Types.ObjectId;
  driver: Types.ObjectId;

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

  refundedAmountPaise: Paise;
  refunds: IRefundRecord[];

  ledgerTransactionId?: string;

  metadata: Record<string, unknown>;

  capturedAt?: Date;
  refundedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export interface ILedgerEntry {
  _id: Types.ObjectId;
  transactionId: string;
  account: LedgerAccount;
  ownerId?: Types.ObjectId;
  entryType: LedgerEntryType;
  amountPaise: Paise;
  currency: CurrencyType;
  referenceType: LedgerReferenceType;
  referenceId: Types.ObjectId;

  idempotencyKey?: string;
  legIndex?: number;

  description: string;
  metadata: Record<string, unknown>;

  createdAt: Date;
}

export interface IPayout {
  _id: Types.ObjectId;
  payment: Types.ObjectId;
  ride: Types.ObjectId;
  driver: Types.ObjectId;

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