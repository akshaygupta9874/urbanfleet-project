import { AppError } from "../../utils/AppError.js";
import { IPayment } from "../types/payment.models.js";
import { Paise, RefundStatus } from "../types/payment.types.js";

export interface RefundTotals {
    /** Booked refunds (PENDING + PROCESSED) - always equals payment.refundedAmountPaise. */
    refundedPaise: Paise;
    /** Part of it taken back from the DRIVER ledger leg. */
    driverReversedPaise: Paise;
    /** Part of it taken back from the PLATFORM ledger leg. */
    platformReversedPaise: Paise;
}

type PaymentForTotals = Pick<
    IPayment,
    "amountPaise" | "refundedAmountPaise" | "refunds" | "fareBreakdown"
>;

/**
 * Derives the running refund totals of a payment from its refund records.
 *
 * Payments refunded BEFORE refund records existed only carry refundedAmountPaise. That
 * "legacy" part is attributed to driver / platform proportionally (driver rounds down),
 * so old and new payments are handled by the same code path.
 */
export function computeRefundTotals(payment: PaymentForTotals): RefundTotals {
    const live = (payment.refunds ?? []).filter(
        (refund) => refund.status !== RefundStatus.FAILED
    );

    let recordedPaise = 0;
    let driverPaise = 0;
    let platformPaise = 0;

    for (const refund of live) {
        recordedPaise += refund.amountPaise;
        driverPaise += refund.driverReversalPaise;
        platformPaise += refund.platformReversalPaise;
    }

    const legacyPaise = payment.refundedAmountPaise - recordedPaise;

    if (legacyPaise < 0) {
        throw new AppError(
            "Refund records exceed the payment's refunded total (data inconsistency).",
            500,
            "REFUND_TOTALS_INCONSISTENT"
        );
    }

    if (legacyPaise > 0) {
        const legacyDriver = Number(
            (BigInt(legacyPaise) * BigInt(payment.fareBreakdown.driverEarningPaise)) /
            BigInt(payment.amountPaise)
        );

        driverPaise += legacyDriver;
        platformPaise += legacyPaise - legacyDriver;
    }

    return {
        refundedPaise: payment.refundedAmountPaise,
        driverReversedPaise: driverPaise,
        platformReversedPaise: platformPaise,
    };
}
