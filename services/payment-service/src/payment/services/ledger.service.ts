import { Types, ClientSession } from "../types/objectid.js";
import { randomUUID } from "crypto";

import { ledgerRepository } from "../repositories/ledger.repository.js";

import { AppError } from "../../utils/AppError.js";
import { isDuplicateKeyError } from "../errors/payment.errors.js";

import {
    LedgerEntryInput,
    RecordLedgerTransactionInput,
} from "../types/payment.dto.js";

import { IPayment } from "../types/payment.models.js";

import {
    LedgerAccount,
    LedgerEntryType,
    LedgerReferenceType,
    CurrencyType,
    Paise,
} from "../types/payment.types.js";

import { CURRENCY } from "../constants/payment.constants.js";

import { RefundAllocation } from "../utils/refund-allocation.js";

const opposite = (
    type: LedgerEntryType
): LedgerEntryType =>
    type === LedgerEntryType.DEBIT
        ? LedgerEntryType.CREDIT
        : LedgerEntryType.DEBIT;

/** Zero-paise legs cannot be stored (amount must be > 0) and carry no information. */
const withoutZeroLegs = (
    entries: LedgerEntryInput[]
): LedgerEntryInput[] =>
    entries.filter((entry) => entry.amountPaise > 0);

type PaymentForPosting = Pick<
    IPayment,
    | "_id"
    | "ride"
    | "rider"
    | "driver"
    | "amountPaise"
    | "fareBreakdown"
    | "gatewayOrderId"
    | "gatewayPaymentId"
>;

export interface OwnerBalance {
    totalDebitPaise: Paise;
    totalCreditPaise: Paise;
    /** credits - debits. For DRIVER this is "earned but not yet paid out". */
    netCreditPaise: number;
}

class LedgerService {
    async recordTransaction(
        input: RecordLedgerTransactionInput,
        session?: ClientSession
    ): Promise<string> {

        const {
            entries,
            referenceType,
            referenceId,
            metadata = {},
            idempotencyKey,
        } = input;

        const currency: CurrencyType =
            input.currency ?? CURRENCY.INR;

        if (entries.length < 2) {
            throw new AppError(
                "A ledger transaction requires at least two legs",
                500,
                "LEDGER_UNBALANCED"
            );
        }

        for (const entry of entries) {

            if (
                !Number.isInteger(entry.amountPaise) ||
                entry.amountPaise <= 0
            ) {

                throw new AppError(
                    `Ledger leg for ${entry.account} must be a positive integer paise amount`,
                    500,
                    "LEDGER_INVALID_AMOUNT"
                );

            }

        }

        const totalDebit =
            entries
                .filter(
                    (entry) =>
                        entry.entryType ===
                        LedgerEntryType.DEBIT
                )
                .reduce(
                    (sum, entry) =>
                        sum + entry.amountPaise,
                    0
                );

        const totalCredit =
            entries
                .filter(
                    (entry) =>
                        entry.entryType ===
                        LedgerEntryType.CREDIT
                )
                .reduce(
                    (sum, entry) =>
                        sum + entry.amountPaise,
                    0
                );

        if (totalDebit !== totalCredit) {

            throw new AppError(
                `Unbalanced ledger transaction: debits=${totalDebit} credits=${totalCredit}`,
                500,
                "LEDGER_UNBALANCED"
            );

        }

        const transactionId = input.transactionId ?? randomUUID();

        const rows = entries.map((entry, index) => ({
            transactionId,

            account: entry.account,

            ownerId: entry.ownerId,

            entryType: entry.entryType,

            amountPaise: entry.amountPaise,

            currency,

            referenceType,

            referenceId,

            idempotencyKey,

            legIndex: idempotencyKey ? index : undefined,

            description: entry.description,

            metadata,
        }));

        const insert = async (
            activeSession: ClientSession
        ): Promise<void> => {
            try {
                await ledgerRepository.insertEntries(
                    rows,
                    activeSession
                );
            } catch (err) {
                if (idempotencyKey && isDuplicateKeyError(err)) {
                    throw new AppError(
                        `Ledger posting ${idempotencyKey} already exists`,
                        409,
                        "LEDGER_DUPLICATE_POSTING"
                    );
                }
                throw err;
            }
        };

        await insert(session);
        return transactionId;
    }

    // ------------------------------------------------------------------
    // Posting rules. Every money movement of the payment module is defined
    // here, in one place, so the accounting can be audited by reading it.
    // ------------------------------------------------------------------

    /**
     * Capture of a rider payment.
     *   DEBIT  RIDER     amount            (source of the money)
     *   CREDIT PLATFORM  commission        (what the platform keeps)
     *   CREDIT DRIVER    driver earning    (what the platform owes the driver)
     * A zero commission / zero earning leg is skipped.
     */
    async recordPaymentCapture(
        payment: PaymentForPosting,
        transactionId: string,
        session?: ClientSession
    ): Promise<string> {

        const { platformCommissionPaise, driverEarningPaise } =
            payment.fareBreakdown;

        return this.recordTransaction(
            {
                entries: withoutZeroLegs([
                    {
                        account: LedgerAccount.RIDER,
                        ownerId: payment.rider,
                        entryType: LedgerEntryType.DEBIT,
                        amountPaise: payment.amountPaise,
                        description: `Payment received for ride ${payment.ride.toString()}`,
                    },
                    {
                        account: LedgerAccount.PLATFORM,
                        entryType: LedgerEntryType.CREDIT,
                        amountPaise: platformCommissionPaise,
                        description: "Platform commission",
                    },
                    {
                        account: LedgerAccount.DRIVER,
                        ownerId: payment.driver,
                        entryType: LedgerEntryType.CREDIT,
                        amountPaise: driverEarningPaise,
                        description: "Driver earning",
                    },
                ]),
                referenceType: LedgerReferenceType.PAYMENT,
                referenceId: payment._id,
                transactionId,
                idempotencyKey: `payment:${payment._id.toString()}:capture`,
                metadata: {
                    paymentId: payment._id.toString(),
                    rideId: payment.ride.toString(),
                    gatewayOrderId: payment.gatewayOrderId,
                    gatewayPaymentId: payment.gatewayPaymentId,
                },
            },
            session
        );
    }

    /**
     * Booking of a refund (reverses the capture proportionally).
     *   CREDIT RIDER     amount
     *   DEBIT  PLATFORM  platform share of the refund
     *   DEBIT  DRIVER    driver share of the refund
     */
    async recordRefundBooking(
        args: {
            payment: PaymentForPosting;
            refundId: Types.ObjectId;
            amountPaise: Paise;
            split: RefundAllocation;
            reason: string;
            transactionId: string;
        },
        session?: ClientSession
    ): Promise<string> {

        const { payment, refundId, amountPaise, split, reason } = args;

        return this.recordTransaction(
            {
                entries: withoutZeroLegs([
                    {
                        account: LedgerAccount.RIDER,
                        ownerId: payment.rider,
                        entryType: LedgerEntryType.CREDIT,
                        amountPaise,
                        description: `Refund for ride ${payment.ride.toString()}: ${reason}`,
                    },
                    {
                        account: LedgerAccount.PLATFORM,
                        entryType: LedgerEntryType.DEBIT,
                        amountPaise: split.platformPaise,
                        description: "Platform commission reversed (refund)",
                    },
                    {
                        account: LedgerAccount.DRIVER,
                        ownerId: payment.driver,
                        entryType: LedgerEntryType.DEBIT,
                        amountPaise: split.driverPaise,
                        description: "Driver earning reversed (refund)",
                    },
                ]),
                referenceType: LedgerReferenceType.REFUND,
                referenceId: payment._id,
                transactionId: args.transactionId,
                idempotencyKey:
                    `refund:${payment._id.toString()}:${refundId.toString()}:book`,
                metadata: {
                    paymentId: payment._id.toString(),
                    refundId: refundId.toString(),
                    reason,
                },
            },
            session
        );
    }

    /** Exact mirror of recordRefundBooking - used when the gateway refund FAILED. */
    async recordRefundCompensation(
        args: {
            payment: PaymentForPosting;
            refundId: Types.ObjectId;
            amountPaise: Paise;
            split: RefundAllocation;
            reason: string;
            transactionId: string;
        },
        session?: ClientSession
    ): Promise<string> {

        const { payment, refundId, amountPaise, split, reason } = args;

        return this.recordTransaction(
            {
                entries: withoutZeroLegs([
                    {
                        account: LedgerAccount.RIDER,
                        ownerId: payment.rider,
                        entryType: LedgerEntryType.DEBIT,
                        amountPaise,
                        description: `Refund failed, booking undone for ride ${payment.ride.toString()}`,
                    },
                    {
                        account: LedgerAccount.PLATFORM,
                        entryType: LedgerEntryType.CREDIT,
                        amountPaise: split.platformPaise,
                        description: "Platform commission restored (refund failed)",
                    },
                    {
                        account: LedgerAccount.DRIVER,
                        ownerId: payment.driver,
                        entryType: LedgerEntryType.CREDIT,
                        amountPaise: split.driverPaise,
                        description: "Driver earning restored (refund failed)",
                    },
                ]),
                referenceType: LedgerReferenceType.REFUND,
                referenceId: payment._id,
                transactionId: args.transactionId,
                idempotencyKey:
                    `refund:${payment._id.toString()}:${refundId.toString()}:undo`,
                metadata: {
                    paymentId: payment._id.toString(),
                    refundId: refundId.toString(),
                    reason,
                },
            },
            session
        );
    }

    /**
     * Money left the platform for a driver's bank account.
     *   DEBIT  DRIVER  amount   (the platform no longer owes the driver)
     *   CREDIT BANK    amount   (cash out)
     */
    async recordPayoutDisbursement(
        args: {
            payoutId: Types.ObjectId;
            driverId: Types.ObjectId;
            amountPaise: Paise;
            transactionId: string;
        },
        session?: ClientSession
    ): Promise<string> {

        return this.recordTransaction(
            {
                entries: [
                    {
                        account: LedgerAccount.DRIVER,
                        ownerId: args.driverId,
                        entryType: LedgerEntryType.DEBIT,
                        amountPaise: args.amountPaise,
                        description: "Driver payout disbursed",
                    },
                    {
                        account: LedgerAccount.BANK,
                        entryType: LedgerEntryType.CREDIT,
                        amountPaise: args.amountPaise,
                        description: "Payout sent to driver bank account",
                    },
                ],
                referenceType: LedgerReferenceType.PAYOUT,
                referenceId: args.payoutId,
                transactionId: args.transactionId,
                idempotencyKey: `payout:${args.payoutId.toString()}:disburse`,
                metadata: { payoutId: args.payoutId.toString() },
            },
            session
        );
    }

    /** The bank returned a PROCESSED payout: the platform owes the driver again. */
    async recordPayoutReversal(
        args: {
            payoutId: Types.ObjectId;
            driverId: Types.ObjectId;
            amountPaise: Paise;
            transactionId: string;
            reason: string;
        },
        session?: ClientSession
    ): Promise<string> {

        return this.recordTransaction(
            {
                entries: [
                    {
                        account: LedgerAccount.BANK,
                        entryType: LedgerEntryType.DEBIT,
                        amountPaise: args.amountPaise,
                        description: `Payout returned by bank: ${args.reason}`,
                    },
                    {
                        account: LedgerAccount.DRIVER,
                        ownerId: args.driverId,
                        entryType: LedgerEntryType.CREDIT,
                        amountPaise: args.amountPaise,
                        description: "Driver payout reversed, balance restored",
                    },
                ],
                referenceType: LedgerReferenceType.PAYOUT,
                referenceId: args.payoutId,
                transactionId: args.transactionId,
                idempotencyKey: `payout:${args.payoutId.toString()}:reverse`,
                metadata: {
                    payoutId: args.payoutId.toString(),
                    reason: args.reason,
                },
            },
            session
        );
    }

    /** Debit / credit totals of one owner's account (e.g. one driver's earnings). */
    async getOwnerBalance(
        account: LedgerAccount,
        ownerId: Types.ObjectId
    ): Promise<OwnerBalance> {

        const totals =
            await ledgerRepository.sumByAccount(
                account,
                undefined,
                ownerId
            );

        return {
            ...totals,
            netCreditPaise:
                totals.totalCreditPaise - totals.totalDebitPaise,
        };
    }

    /**
     * @deprecated
     *
     * Prefer:
     *
     *   allocateRefund(...)
     *   recordRefundBooking(...)
     *
     * This compatibility method intentionally performs a simple
     * proportional reversal. It must NOT be used by the production
     * refund flow because it has no cumulative-refund state.
     */
    async reverseTransactionPartial(
        originalTransactionId: string,
        fraction: number,
        referenceType: LedgerReferenceType,
        referenceId: Types.ObjectId,
        reason: string,
        session?: ClientSession
    ): Promise<string> {
        if (
            !Number.isFinite(fraction) ||
            fraction <= 0 ||
            fraction > 1
        ) {
            throw new RangeError(
                "fraction must be greater than 0 and less than or equal to 1"
            );
        }

        const originalEntries =
            await ledgerRepository.findByTransactionId(
                originalTransactionId
            );

        if (originalEntries.length === 0) {
            throw new AppError(
                "Original ledger transaction not found.",
                404
            );
        }

        const reversedEntries: LedgerEntryInput[] =
            originalEntries
                .filter((entry) => entry.amountPaise > 0)
                .map((entry) => ({
                    account: entry.account,

                    ownerId: entry.ownerId,

                    entryType:
                        entry.entryType === LedgerEntryType.DEBIT
                            ? LedgerEntryType.CREDIT
                            : LedgerEntryType.DEBIT,

                    amountPaise: Math.floor(
                        entry.amountPaise * fraction
                    ),

                    description:
                        `Partial reversal: ${reason}`,
                }))
                .filter(
                    (entry) =>
                        entry.amountPaise > 0
                );

        if (reversedEntries.length === 0) {
            throw new RangeError(
                "Partial reversal produces zero ledger amount."
            );
        }

        return this.recordTransaction(
            {
                referenceType,
                referenceId,
                entries: reversedEntries,
                metadata: {
                    reason,
                    originalTransactionId,
                    fraction,
                },
            },
            session
        );
    }
}

export const ledgerService =
    new LedgerService();
