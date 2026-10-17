import { Types } from "../types/objectid.js";
import { randomUUID } from "crypto";

import { razorpayClient } from "../../config/razorpay.config.js";
import { AppError } from "../../utils/AppError.js";

import {
    describeGatewayError,
    isGatewayRejection,
} from "../errors/payment.errors.js";

import { paymentRepository } from "../repositories/payment.repository.js";
import { ledgerService } from "./ledger.service.js";
import { payoutService } from "./payout.service.js";

import { prisma } from "../../db/client.js";
import { acquireLock } from "../../redis/redis-lock.js";
import { paymentLog } from "../utils/payment-logger.js";
import { allocateRefund } from "../utils/refund-allocation.js";
import { computeRefundTotals } from "../utils/refund-totals.js";

import {
    InitiateRefundInput,
    InitiateRefundResult,
} from "../types/payment.dto.js";

import { IPayment, IRefundRecord } from "../types/payment.models.js";
import { RazorpayNotes, RazorpayRefundEntity } from "../types/razorpay.types.js";

import {
    PaymentStatus,
    RefundOrigin,
    RefundStatus,
} from "../types/payment.types.js";

import {
    REDIS_KEYS,
    REFUNDABLE_STATUSES,
    REFUND_LOCK_TTL_MS,
} from "../constants/payment.constants.js";

/** Razorpay notes values may be at most 256 characters. */
const NOTE_MAX_LENGTH = 250;

export type GatewayRefundEventKind = "created" | "processed" | "failed";

interface BookRefundArgs {
    payment: IPayment;
    amountPaise: number;
    reason: string;
    origin: RefundOrigin;
    status: RefundStatus;
    initiatedBy?: Types.ObjectId;
    gatewayRefundId?: string;
    processedAt?: Date;
}

function readNote(
    notes: RazorpayNotes | undefined,
    key: string
): string | undefined {
    if (!notes || Array.isArray(notes)) {
        return undefined;
    }

    const value = notes[key];

    return value === undefined || value === null || value === ""
        ? undefined
        : String(value);
}

/**
 * Refund lifecycle.
 *
 *   1. BOOK    one database transaction: compare-and-swap the payment (status + refunded
 *              total), push a PENDING refund record, post the ledger reversal.
 *   2. SEND    ask Razorpay to refund (receipt / notes carry our refund record id).
 *   3. SETTLE  attach the gateway refund id; refund.processed -> PROCESSED,
 *              refund.failed -> compensating ledger posting and the amount is refundable again.
 *
 * The books are updated BEFORE the gateway is called, so "gateway refunded but our records
 * did not change" can no longer happen. If the gateway call fails in a way we cannot classify
 * (timeout / 5xx) the refund stays PENDING and reconciliation resolves it.
 *
 * Every mutation of a payment's refunds runs under lock:payment:refund:<paymentId>.
 */
class RefundService {

    async initiateRefund(
        input: InitiateRefundInput
    ): Promise<InitiateRefundResult> {

        const paymentId = input.paymentId.toString();

        const release =
            await acquireLock(
                REDIS_KEYS.refundLock(paymentId),
                REFUND_LOCK_TTL_MS
            );

        if (!release) {
            throw new AppError(
                "Refund already in progress.",
                409,
                "REFUND_IN_PROGRESS"
            );
        }

        try {

            const payment =
                await paymentRepository.findById(paymentId);

            if (!payment) {
                throw new AppError(
                    "Payment not found.",
                    404,
                    "PAYMENT_NOT_FOUND"
                );
            }

            if (!REFUNDABLE_STATUSES.includes(payment.status)) {
                throw new AppError(
                    `Cannot refund payment in status ${payment.status}`,
                    409,
                    "PAYMENT_NOT_REFUNDABLE"
                );
            }

            if (!payment.gatewayPaymentId) {
                throw new AppError(
                    "Gateway payment id missing.",
                    409,
                    "PAYMENT_NOT_CAPTURED"
                );
            }

            if (!payment.ledgerTransactionId) {
                throw new AppError(
                    "Ledger transaction not found.",
                    500,
                    "LEDGER_TRANSACTION_NOT_FOUND"
                );
            }

            const remaining =
                payment.amountPaise - payment.refundedAmountPaise;

            const refundAmount =
                input.amountPaise ?? remaining;

            if (
                !Number.isSafeInteger(refundAmount) ||
                refundAmount <= 0 ||
                refundAmount > remaining
            ) {
                throw new AppError(
                    "Invalid refund amount.",
                    422,
                    "REFUND_AMOUNT_INVALID"
                );
            }

            // ---- 1. BOOK ---------------------------------------------------
            const booked = await this.bookRefund({
                payment,
                amountPaise: refundAmount,
                reason: input.reason,
                origin: RefundOrigin.APP,
                status: RefundStatus.PENDING,
                initiatedBy: input.initiatedBy,
            });

            const refundId = booked.record._id.toString();

            // ---- 2. SEND ---------------------------------------------------
            let gatewayRefund: { id: string; status: string };

            try {
                gatewayRefund =
                    await razorpayClient.payments.refund(
                        payment.gatewayPaymentId,
                        {
                            amount: refundAmount,
                            receipt: refundId,
                            notes: {
                                reason: input.reason.slice(0, NOTE_MAX_LENGTH),
                                initiatedBy: input.initiatedBy.toString(),
                                paymentId,
                                refundRecordId: refundId,
                            },
                        }
                    );
            } catch (err) {

                if (isGatewayRejection(err)) {
                    // 4xx: the gateway definitely did NOT refund -> undo the booking
                    const description = describeGatewayError(err);

                    await this.compensateRefund(
                        paymentId,
                        refundId,
                        `Gateway rejected the refund: ${description}`
                    );

                    throw new AppError(
                        `Refund rejected by the payment gateway: ${description}`,
                        502,
                        "REFUND_GATEWAY_REJECTED"
                    );
                }

                // timeout / 5xx: outcome unknown. Keep the booking; reconciliation asks the
                // gateway whether a refund carrying our receipt exists.
                paymentLog.error("refund.gateway_outcome_unknown", {
                    paymentId,
                    refundId,
                    amountPaise: refundAmount,
                    error: describeGatewayError(err),
                });

                return this.toResult(booked.payment, refundId);
            }

            // ---- 3. SETTLE -------------------------------------------------
            if (gatewayRefund.status === "failed") {
                await this.compensateRefund(
                    paymentId,
                    refundId,
                    "Gateway created the refund in failed state"
                );

                throw new AppError(
                    "Refund failed at the payment gateway.",
                    502,
                    "REFUND_GATEWAY_REJECTED"
                );
            }

            await paymentRepository.updateRefundRecord(
                paymentId,
                refundId,
                [RefundStatus.PENDING],
                {
                    gatewayRefundId: gatewayRefund.id,
                    ...(gatewayRefund.status === "processed"
                        ? {
                            status: RefundStatus.PROCESSED,
                            processedAt: new Date(),
                        }
                        : {}),
                }
            );

            const settled =
                await paymentRepository.findById(paymentId);

            paymentLog.info("refund.initiated", {
                paymentId,
                refundId,
                gatewayRefundId: gatewayRefund.id,
                amountPaise: refundAmount,
            });

            return this.toResult(
                settled ?? booked.payment,
                refundId,
                gatewayRefund.id
            );

        } finally {
            await release();
        }
    }

    /**
     * Applies a refund.* webhook (or a reconciliation finding).
     * Also discovers refunds that were created OUTSIDE the app (Razorpay dashboard).
     */
    async handleGatewayRefundEvent(
        kind: GatewayRefundEventKind,
        entity: RazorpayRefundEntity
    ): Promise<void> {

        const noteRefundId = readNote(entity.notes, "refundRecordId");

        let located =
            await paymentRepository.findByGatewayRefundId(entity.id);

        if (!located && noteRefundId) {
            located = await paymentRepository.findByRefundRecordId(noteRefundId);
        }

        if (!located) {
            located = await paymentRepository.findByGatewayPaymentId(entity.payment_id);
        }

        if (!located) {
            paymentLog.warn("refund.event_for_unknown_payment", {
                gatewayRefundId: entity.id,
                gatewayPaymentId: entity.payment_id,
                kind,
            });
            return;
        }

        const paymentId = located._id.toString();

        const release =
            await acquireLock(
                REDIS_KEYS.refundLock(paymentId),
                REFUND_LOCK_TTL_MS
            );

        if (!release) {
            // retryable: the webhook is redelivered later
            throw new AppError(
                "Refund is being processed, retry shortly.",
                409,
                "REFUND_IN_PROGRESS"
            );
        }

        try {

            const payment = await paymentRepository.findById(paymentId);

            if (!payment) {
                return;
            }

            const record =
                payment.refunds.find(
                    (item) => item.gatewayRefundId === entity.id
                ) ??
                payment.refunds.find(
                    (item) =>
                        noteRefundId !== undefined &&
                        item._id.toString() === noteRefundId
                );

            if (kind === "failed") {

                if (!record || record.status === RefundStatus.FAILED) {
                    return; // never booked, or already undone
                }

                await this.compensateRefund(
                    paymentId,
                    record._id.toString(),
                    "Gateway reported the refund as failed"
                );

                return;
            }

            const isProcessed =
                kind === "processed" || entity.status === "processed";

            if (record) {

                if (record.status === RefundStatus.FAILED) {
                    // The gateway says the money moved but we had undone the booking.
                    // Needs a human: do not silently re-book.
                    paymentLog.error("refund.event_after_compensation", {
                        paymentId,
                        refundId: record._id.toString(),
                        gatewayRefundId: entity.id,
                        kind,
                    });
                    return;
                }

                const set: Partial<Omit<IRefundRecord, "_id">> = {};

                if (!record.gatewayRefundId) {
                    set.gatewayRefundId = entity.id;
                }

                if (isProcessed && record.status === RefundStatus.PENDING) {
                    set.status = RefundStatus.PROCESSED;
                    set.processedAt = new Date();
                }

                if (Object.keys(set).length > 0) {
                    await paymentRepository.updateRefundRecord(
                        paymentId,
                        record._id.toString(),
                        [RefundStatus.PENDING, RefundStatus.PROCESSED],
                        set
                    );
                }

                return;
            }

            // ---- a refund we did not start (dashboard) --------------------
            if (!REFUNDABLE_STATUSES.includes(payment.status)) {
                paymentLog.error("refund.external_refund_unbookable", {
                    paymentId,
                    status: payment.status,
                    gatewayRefundId: entity.id,
                });
                return;
            }

            const remaining =
                payment.amountPaise - payment.refundedAmountPaise;

            if (entity.amount > remaining) {
                paymentLog.error("refund.external_refund_exceeds_balance", {
                    paymentId,
                    gatewayRefundId: entity.id,
                    amountPaise: entity.amount,
                    remainingPaise: remaining,
                });
                return;
            }

            await this.bookRefund({
                payment,
                amountPaise: entity.amount,
                reason: "Refund issued outside the app (gateway dashboard)",
                origin: RefundOrigin.GATEWAY,
                status: isProcessed ? RefundStatus.PROCESSED : RefundStatus.PENDING,
                gatewayRefundId: entity.id,
                ...(isProcessed ? { processedAt: new Date() } : {}),
            });

            paymentLog.warn("refund.external_refund_booked", {
                paymentId,
                gatewayRefundId: entity.id,
                amountPaise: entity.amount,
            });

        } finally {
            await release();
        }
    }

    /**
     * Reconciliation found a booked refund the gateway never received (the request failed
     * without an answer and nothing carrying our receipt exists at the gateway): undo it.
     */
    async abandonUnsentRefund(
        paymentId: string,
        refundId: string,
        reason: string
    ): Promise<boolean> {

        const release =
            await acquireLock(
                REDIS_KEYS.refundLock(paymentId),
                REFUND_LOCK_TTL_MS
            );

        if (!release) {
            return false;
        }

        try {
            const payment = await paymentRepository.findById(paymentId);

            const record = payment?.refunds.find(
                (item) => item._id.toString() === refundId
            );

            if (
                !record ||
                record.status !== RefundStatus.PENDING ||
                record.gatewayRefundId
            ) {
                return false;
            }

            return await this.compensateRefund(paymentId, refundId, reason);

        } finally {
            await release();
        }
    }

    // ------------------------------------------------------------------ internals

    /** Phase 1 - one transaction: CAS payment + push refund record + post ledger reversal. */
    private async bookRefund(
        args: BookRefundArgs
    ): Promise<{ payment: IPayment; record: IRefundRecord }> {

        const { payment } = args;

        const totals = computeRefundTotals(payment);

        const remaining = payment.amountPaise - totals.refundedPaise;

        if (args.amountPaise <= 0 || args.amountPaise > remaining) {
            throw new AppError(
                "Invalid refund amount.",
                422,
                "REFUND_AMOUNT_INVALID"
            );
        }

        const split = allocateRefund({
            totalPaise: payment.amountPaise,
            driverEarningPaise: payment.fareBreakdown.driverEarningPaise,
            platformCommissionPaise: payment.fareBreakdown.platformCommissionPaise,
            refundedSoFarPaise: totals.refundedPaise,
            driverReversedSoFarPaise: totals.driverReversedPaise,
            platformReversedSoFarPaise: totals.platformReversedPaise,
            refundPaise: args.amountPaise,
        });

        const refundId = new Types.ObjectId();

        const newRefunded = totals.refundedPaise + args.amountPaise;

        const newStatus =
            newRefunded >= payment.amountPaise
                ? PaymentStatus.REFUNDED
                : PaymentStatus.PARTIALLY_REFUNDED;

        const transactionId = randomUUID();

        const { updated, record } = await prisma.$transaction(async (tx) => {
            const payoutEffect =
                await payoutService.handleRefundBooked(
                    payment._id,
                    split.driverPaise,
                    tx
                );

            const rec: IRefundRecord = {
                _id: refundId,
                gatewayRefundId: args.gatewayRefundId,
                amountPaise: args.amountPaise,
                status: args.status,
                origin: args.origin,
                reason: args.reason,
                initiatedBy: args.initiatedBy,
                driverReversalPaise: split.driverPaise,
                platformReversalPaise: split.platformPaise,
                ledgerTransactionId: transactionId,
                driverClawbackRequired: payoutEffect.clawbackRequired,
                processedAt: args.processedAt,
                createdAt: new Date(),
            };

            const updatedPayment =
                await paymentRepository.bookRefund(
                    payment._id.toString(),
                    {
                        status: payment.status,
                        refundedAmountPaise: payment.refundedAmountPaise,
                    },
                    {
                        status: newStatus,
                        refundedAmountPaise: newRefunded,
                    },
                    rec,
                    tx
                );

            if (!updatedPayment) {
                throw new AppError(
                    "The payment changed while the refund was being booked. Please retry.",
                    409,
                    "REFUND_CONFLICT"
                );
            }

            await ledgerService.recordRefundBooking(
                {
                    payment,
                    refundId,
                    amountPaise: args.amountPaise,
                    split,
                    reason: args.reason,
                    transactionId,
                },
                tx
            );

            return { updated: updatedPayment, record: rec };
        });

        return { payment: updated, record };
    }

    /**
     * Undoes a booked refund: record -> FAILED, refunded total / payment status restored and
     * the ledger booking mirrored. Idempotent. The caller must hold the refund lock.
     * Returns true when it did something.
     */
    private async compensateRefund(
        paymentId: string,
        refundId: string,
        failureReason: string
    ): Promise<boolean> {

        for (let attempt = 0; attempt < 3; attempt++) {

            const payment = await paymentRepository.findById(paymentId);

            if (!payment) {
                return false;
            }

            const record = payment.refunds.find(
                (item) => item._id.toString() === refundId
            );

            if (!record || record.status === RefundStatus.FAILED) {
                return false;
            }

            const newRefunded =
                payment.refundedAmountPaise - record.amountPaise;

            if (newRefunded < 0) {
                throw new AppError(
                    "Refund total would become negative (data inconsistency).",
                    500,
                    "REFUND_TOTALS_INCONSISTENT"
                );
            }

            const newStatus =
                newRefunded === 0
                    ? PaymentStatus.CAPTURED
                    : PaymentStatus.PARTIALLY_REFUNDED;

            const transactionId = randomUUID();

            const updated = await prisma.$transaction(async (tx) => {
                const res = await paymentRepository.failRefund(
                    paymentId,
                    refundId,
                    payment.refundedAmountPaise,
                    {
                        status: newStatus,
                        refundedAmountPaise: newRefunded,
                    },
                    {
                        failureReason,
                        compensationLedgerTransactionId: transactionId,
                    },
                    tx
                );

                if (!res) {
                    return null;
                }

                await ledgerService.recordRefundCompensation(
                    {
                        payment,
                        refundId: record._id,
                        amountPaise: record.amountPaise,
                        split: {
                            driverPaise: record.driverReversalPaise,
                            platformPaise: record.platformReversalPaise,
                        },
                        reason: failureReason,
                        transactionId,
                    },
                    tx
                );

                return res;
            });

            if (!updated) {
                continue; // state moved under us: reload and try again
            }

            paymentLog.warn("refund.compensated", {
                paymentId,
                refundId,
                amountPaise: record.amountPaise,
                reason: failureReason,
            });

            return true;
        }

        throw new AppError(
            "Could not undo the refund: the payment kept changing.",
            409,
            "REFUND_CONFLICT"
        );
    }

    private toResult(
        payment: IPayment,
        refundId: string,
        gatewayRefundId?: string
    ): InitiateRefundResult {

        const record = payment.refunds.find(
            (item) => item._id.toString() === refundId
        );

        return {
            refundId,
            gatewayRefundId: record?.gatewayRefundId ?? gatewayRefundId,
            amountPaise: record?.amountPaise ?? 0,
            refundStatus: record?.status ?? RefundStatus.PENDING,
            paymentStatus: payment.status,
            refundedAmountPaise: payment.refundedAmountPaise,
        };
    }
}

export const refundService = new RefundService();
