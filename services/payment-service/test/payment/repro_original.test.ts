/**
 * Regression tests for the payment module.
 *
 * These tests originally reproduced defects found in the old payment module.
 * They have been converted to assert the expected behaviour of the FIXED
 * implementation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Types } from "../../src/payment/types/objectid.js";

// -----------------------------------------------------------------------------
// Fake Redis
// -----------------------------------------------------------------------------

const store = new Map<string, string>();

vi.mock("../../src/redis/client.js", () => ({
    redisClient: {
        set: vi.fn(
            async (
                k: string,
                v: string,
                o?: { NX?: boolean }
            ) => {
                if (o?.NX && store.has(k)) {
                    return null;
                }

                store.set(k, v);
                return "OK";
            }
        ),

        del: vi.fn(async (k: string) => {
            return store.delete(k) ? 1 : 0;
        }),

        eval: vi.fn(async () => 1),
    },
}));

// -----------------------------------------------------------------------------
// Imports
// -----------------------------------------------------------------------------

import { paymentService } from "../../src/payment/services/payment.service.js";
import { webhookService } from "../../src/payment/services/webhook.service.js";
import { ledgerService } from "../../src/payment/services/ledger.service.js";
import { paymentRepository } from "../../src/payment/repositories/payment.repository.js";
import { prisma } from "../../src/db/client.js";

import {
    PaymentStatus,
    LedgerAccount,
} from "../../src/payment/types/payment.types.js";

import { allocateRefund } from "../../src/payment/utils/refund-allocation.js";

// -----------------------------------------------------------------------------
// Test lifecycle
// -----------------------------------------------------------------------------

beforeEach(() => {
    store.clear();
    vi.restoreAllMocks();
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const fakeSession = () => ({
    withTransaction: async (fn: () => Promise<void>) => fn(),
    endSession: async () => {},
});

const basePayment = (
    over: Record<string, unknown> = {}
) => ({
    _id: new Types.ObjectId(),

    ride: new Types.ObjectId(),

    rider: new Types.ObjectId(),

    driver: new Types.ObjectId(),

    status: PaymentStatus.PENDING,

    amountPaise: 1000,

    currency: "INR",

    gatewayOrderId: "order_1",

    gatewayPaymentId: "pay_1",

    refundedAmountPaise: 0,

    refunds: [],

    fareBreakdown: {
        platformCommissionPaise: 300,
        driverEarningPaise: 700,
    },

    ...over,
});

// -----------------------------------------------------------------------------
// Webhook deduplication regression
// -----------------------------------------------------------------------------

describe("webhook deduplication", () => {
    it(
        "does not silently drop a failed event on Razorpay retry",
        async () => {
            const spy = vi
                .spyOn(
                    paymentService,
                    "handlePaymentCaptured"
                )
                .mockRejectedValueOnce(
                    new Error("transient DB error")
                )
                .mockResolvedValue(undefined);

            const payload: any = {
                event: "payment.captured",

                created_at: 1,

                payload: {
                    payment: {
                        entity: {
                            id: "pay_1",
                            order_id: "order_1",
                        },
                    },
                },
            };

            // First delivery fails.
            await expect(
                webhookService.handleEvent(
                    payload,
                    "evt_1"
                )
            ).rejects.toThrow(
                "transient DB error"
            );

            // Razorpay retries the SAME event after
            // the transient failure.
            await webhookService.handleEvent(
                payload,
                "evt_1"
            );

            /*
             * Important invariant:
             *
             * The retry MUST reach the handler.
             *
             * Therefore the handler is called twice:
             *
             *   1. original delivery
             *   2. retry after transient failure
             */
            expect(spy).toHaveBeenCalledTimes(2);
        }
    );
});

// -----------------------------------------------------------------------------
// Capture handler ordering
// -----------------------------------------------------------------------------

describe("capture handler ordering", () => {
    it(
        "does not write ledger entries when the status CAS loses the race",
        async () => {
            const payment = basePayment();

            vi.spyOn(
                paymentRepository,
                "findByGatewayOrderId"
            ).mockResolvedValue(
                payment as any
            );

            // Another request already won the race.
            vi.spyOn(
                paymentRepository,
                "transitionStatus"
            ).mockResolvedValue(null);

            const record = vi
                .spyOn(
                    ledgerService,
                    "recordPaymentCapture"
                )
                .mockResolvedValue("tx-1");

            await paymentService.handlePaymentCaptured({
                id: "pay_1",
                entity: "payment",
                order_id: "order_1",
                status: "captured",
                amount: 1000,
                currency: "INR",
                method: "upi",
                captured: true,
                created_at: 1,
            });

            /*
             * The CAS must happen before ledger posting.
             *
             * Since this request lost the race, no ledger
             * transaction should be created by this request.
             */
            expect(record).not.toHaveBeenCalled();
        }
    );

    it(
        "re-opens a FAILED payment when a later capture succeeds",
        async () => {
            const payment = basePayment({
                status: PaymentStatus.FAILED,
            });

            vi.spyOn(
                paymentRepository,
                "findByGatewayOrderId"
            ).mockResolvedValue(
                payment as any
            );

            /*
             * A FAILED payment is allowed to transition to
             * CAPTURED when a later successful gateway capture
             * arrives.
             */
            vi.spyOn(
                paymentRepository,
                "transitionStatus"
            ).mockResolvedValue(
                {
                    ...payment,
                    status: PaymentStatus.CAPTURED,
                } as any
            );

            /*
             * Ledger posting is tested separately.
             * Here we only need to verify the ordering/state
             * transition.
             */
            vi.spyOn(
                ledgerService,
                "recordPaymentCapture"
            ).mockResolvedValue(
                "capture-tx"
            );

            vi.spyOn(prisma.ride, "findUnique").mockResolvedValue({
                id: payment.ride.toString(),
                riderId: payment.rider.toString(),
                driverId: payment.driver.toString(),
            } as any);

            vi.spyOn(prisma.ride, "update").mockResolvedValue({
                id: payment.ride.toString(),
                riderId: payment.rider.toString(),
                driverId: payment.driver.toString(),
                paymentStatus: "CAPTURED",
            } as any);

            await expect(
                paymentService.handlePaymentCaptured({
                    id: "pay_2",
                    entity: "payment",
                    order_id: "order_1",
                    status: "captured",
                    amount: 1000,
                    currency: "INR",
                    method: "card",
                    captured: true,
                    created_at: 1,
                })
            ).resolves.not.toThrow();

            expect(
                paymentRepository.transitionStatus
            ).toHaveBeenCalled();

            expect(
                ledgerService.recordPaymentCapture
            ).toHaveBeenCalled();
        }
    );

    it(
        "accepts a fare with zero platform commission",
        async () => {
            const payment = basePayment({
                fareBreakdown: {
                    platformCommissionPaise: 0,
                    driverEarningPaise: 1000,
                },
            });

            vi.spyOn(
                paymentRepository,
                "findByGatewayOrderId"
            ).mockResolvedValue(
                payment as any
            );

            vi.spyOn(
                paymentRepository,
                "transitionStatus"
            ).mockResolvedValue(
                {
                    ...payment,
                    status: PaymentStatus.CAPTURED,
                } as any
            );

            /*
             * The zero platform commission case is handled
             * by recordPaymentCapture() through withoutZeroLegs().
             */
            const capture = vi
                .spyOn(
                    ledgerService,
                    "recordPaymentCapture"
                )
                .mockResolvedValue(
                    "capture-tx-zero-commission"
                );

            vi.spyOn(prisma.ride, "findUnique").mockResolvedValue({
                id: payment.ride.toString(),
                riderId: payment.rider.toString(),
                driverId: payment.driver.toString(),
            } as any);

            vi.spyOn(prisma.ride, "update").mockResolvedValue({
                id: payment.ride.toString(),
                riderId: payment.rider.toString(),
                driverId: payment.driver.toString(),
                paymentStatus: "CAPTURED",
            } as any);

            await expect(
                paymentService.handlePaymentCaptured({
                    id: "pay_3",
                    entity: "payment",
                    order_id: "order_1",
                    status: "captured",
                    amount: 1000,
                    currency: "INR",
                    method: "upi",
                    captured: true,
                    created_at: 1,
                })
            ).resolves.not.toThrow();

            expect(capture).toHaveBeenCalled();
        }
    );
});

// -----------------------------------------------------------------------------
// Partial refund allocation
// -----------------------------------------------------------------------------

describe("partial-refund allocation", () => {
    it(
        "keeps per-account reversals consistent across multiple partial refunds",
        () => {
            let counterExample:
                | null
                | Record<string, unknown> = null;

            outer: for (const total of [
                101,
                250,
                999,
                1000,
                1234,
            ]) {
                for (const driver of [
                    1,
                    3,
                    7,
                    33,
                    Math.floor(total * 0.8),
                ]) {
                    const platform =
                        total - driver;

                    if (platform <= 0) {
                        continue;
                    }

                    const parts = [
                        Math.floor(total / 3),
                        Math.floor(total / 3),
                    ];

                    parts.push(
                        total -
                            parts[0]! -
                            parts[1]!
                    );

                    let refundedSoFar = 0;
                    let driverReversedSoFar = 0;
                    let platformReversedSoFar = 0;

                    let reversedDriver = 0;
                    let reversedPlatform = 0;

                    for (const refundPaise of parts) {
                        const split = allocateRefund({
                            totalPaise: total,

                            driverEarningPaise:
                                driver,

                            platformCommissionPaise:
                                platform,

                            refundedSoFarPaise:
                                refundedSoFar,

                            driverReversedSoFarPaise:
                                driverReversedSoFar,

                            platformReversedSoFarPaise:
                                platformReversedSoFar,

                            refundPaise,
                        });

                        reversedDriver +=
                            split.driverPaise;

                        reversedPlatform +=
                            split.platformPaise;

                        refundedSoFar +=
                            refundPaise;

                        driverReversedSoFar +=
                            split.driverPaise;

                        platformReversedSoFar +=
                            split.platformPaise;
                    }

                    if (
                        refundedSoFar !== total ||
                        reversedDriver !== driver ||
                        reversedPlatform !== platform
                    ) {
                        counterExample = {
                            total,
                            driver,
                            platform,
                            parts,
                            refundedSoFar,
                            reversedDriver,
                            reversedPlatform,
                        };

                        break outer;
                    }
                }
            }

            expect(counterExample).toBeNull();
        }
    );
});