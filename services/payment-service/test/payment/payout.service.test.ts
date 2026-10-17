import { describe, it, expect, vi } from "vitest";

import { payoutService } from "../../src/payment/services/payout.service.js";
import { payoutRepository } from "../../src/payment/repositories/payout.repository.js";
import { paymentRepository } from "../../src/payment/repositories/payment.repository.js";
import { ledgerService } from "../../src/payment/services/ledger.service.js";
import { NonRetryablePaymentError } from "../../src/payment/errors/payment.errors.js";
import { PaymentStatus, PayoutStatus, RefundStatus } from "../../src/payment/types/payment.types.js";
import { fakeSession, makePayment, oid } from "../helpers/helpers.js";

const payout = (over: Record<string, unknown> = {}): any => ({
  _id: oid(), driver: oid(), payment: oid(), ride: oid(), amountPaise: 700, status: PayoutStatus.PENDING, ...over,
});

describe("createPayout", () => {
  const paid = (over = {}) => makePayment({ status: PaymentStatus.CAPTURED, ...over });
  const args = (p: any, over = {}) => ({ driverId: p.driver, paymentId: p._id, rideId: p.ride, amountPaise: 700, ...over });

  it("creates a PENDING payout for the driver's share", async () => {
    const p = paid();
    vi.spyOn(paymentRepository, "findById").mockResolvedValue(p);
    vi.spyOn(payoutRepository, "findLiveByPayment").mockResolvedValue(null);
    const create = vi.spyOn(payoutRepository, "create").mockResolvedValue(payout() as any);
    await payoutService.createPayout(args(p));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ status: PayoutStatus.PENDING, amountPaise: 700, driver: p.driver }));
  });

  it.each([
    ["non-integer amount", () => paid(), { amountPaise: 10.5 }, 422],
    ["zero amount", () => paid(), { amountPaise: 0 }, 422],
    ["payment not captured", () => paid({ status: PaymentStatus.PENDING }), {}, 409],
    ["fully refunded payment", () => paid({ status: PaymentStatus.REFUNDED }), {}, 409],
    ["another driver", () => paid(), { driverId: oid() }, 409],
    ["more than the driver's share", () => paid(), { amountPaise: 701 }, 422],
  ])("rejects: %s", async (_n, make, over, status) => {
    const p = make();
    vi.spyOn(paymentRepository, "findById").mockResolvedValue(p);
    vi.spyOn(payoutRepository, "findLiveByPayment").mockResolvedValue(null);
    const create = vi.spyOn(payoutRepository, "create");
    await expect(payoutService.createPayout(args(p, over))).rejects.toMatchObject({ statusCode: status });
    expect(create).not.toHaveBeenCalled();
  });

  it("the driver's share shrinks by refunds that were already booked", async () => {
    const p = paid({
      status: PaymentStatus.PARTIALLY_REFUNDED, refundedAmountPaise: 250,
      refunds: [{ status: RefundStatus.PROCESSED, amountPaise: 250, driverReversalPaise: 175, platformReversalPaise: 75 }],
    });
    vi.spyOn(paymentRepository, "findById").mockResolvedValue(p);
    vi.spyOn(payoutRepository, "findLiveByPayment").mockResolvedValue(null);
    vi.spyOn(payoutRepository, "create").mockResolvedValue(payout() as any);
    await expect(payoutService.createPayout(args(p, { amountPaise: 526 }))).rejects.toMatchObject({ statusCode: 422 }); // 700-175 = 525
    await expect(payoutService.createPayout(args(p, { amountPaise: 525 }))).resolves.toBeDefined();
  });

  it("one live payout per payment - checked in code AND by the unique index", async () => {
    const p = paid();
    vi.spyOn(paymentRepository, "findById").mockResolvedValue(p);
    vi.spyOn(payoutRepository, "findLiveByPayment").mockResolvedValueOnce(payout() as any);
    await expect(payoutService.createPayout(args(p))).rejects.toMatchObject({ statusCode: 409 });

    vi.spyOn(payoutRepository, "findLiveByPayment").mockResolvedValue(null);
    vi.spyOn(payoutRepository, "create").mockRejectedValue(Object.assign(new Error("E11000"), { code: 11000 }));
    await expect(payoutService.createPayout(args(p))).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("state changes", () => {
  it("markProcessed: the ledger is posted ONLY by the caller that wins the compare-and-swap", async () => {
    const p = payout();
    const transition = vi.spyOn(payoutRepository, "transition").mockResolvedValueOnce(p).mockResolvedValueOnce(null);
    const ledger = vi.spyOn(ledgerService, "recordPayoutDisbursement").mockResolvedValue("tx");
    vi.spyOn(payoutRepository, "findById").mockResolvedValue({ ...p, status: PayoutStatus.PROCESSED } as any);

    await payoutService.markProcessed(p._id.toString(), "pout_1", "UTR123");
    const [, from, update] = transition.mock.calls[0]!;
    expect(from).toEqual([PayoutStatus.PENDING, PayoutStatus.PROCESSING]);
    expect(update).toMatchObject({ status: PayoutStatus.PROCESSED, gatewayPayoutId: "pout_1", utr: "UTR123" });
    expect(ledger).toHaveBeenCalledTimes(1);
    expect(ledger.mock.calls[0]![0]).toMatchObject({ payoutId: p._id, driverId: p.driver, amountPaise: 700, transactionId: (update as any).ledgerTransactionId });

    await payoutService.markProcessed(p._id.toString()); // duplicate webhook
    expect(ledger).toHaveBeenCalledTimes(1);
  });

  it("markFailed changes nothing in the ledger and does not overwrite a finished payout", async () => {
    const t = vi.spyOn(payoutRepository, "transition").mockResolvedValue(null);
    vi.spyOn(payoutRepository, "findById").mockResolvedValue(payout({ status: PayoutStatus.PROCESSED }));
    const result = await payoutService.markFailed("6aafbb5e07d38f34801eddfd", "late failure");
    expect(t.mock.calls[0]![1]).toEqual([PayoutStatus.PENDING, PayoutStatus.PROCESSING]);
    expect(result.status).toBe(PayoutStatus.PROCESSED);
  });

  it("markReversed: PROCESSED is reversed WITH a ledger reversal; never-processed payouts simply fail", async () => {
    const processed = payout({ status: PayoutStatus.PROCESSED });
    vi.spyOn(payoutRepository, "findById").mockResolvedValue(processed);
    vi.spyOn(payoutRepository, "transition").mockResolvedValue({ ...processed, status: PayoutStatus.REVERSED } as any);
    const reversal = vi.spyOn(ledgerService, "recordPayoutReversal").mockResolvedValue("tx");
    await payoutService.markReversed(processed._id.toString(), "beneficiary bank returned");
    expect(reversal).toHaveBeenCalledWith(
      expect.objectContaining({ amountPaise: 700, driverId: processed.driver, reason: "beneficiary bank returned" }),
      expect.anything()
    );

    reversal.mockClear();
    const pending = payout({ status: PayoutStatus.PROCESSING });
    vi.spyOn(payoutRepository, "findById").mockResolvedValue(pending);
    const t = vi.spyOn(payoutRepository, "transition").mockResolvedValue({ ...pending, status: PayoutStatus.FAILED } as any);
    await payoutService.markReversed(pending._id.toString());
    expect(reversal).not.toHaveBeenCalled();
    expect(t.mock.calls.at(-1)![2]).toMatchObject({ status: PayoutStatus.FAILED });

    vi.spyOn(payoutRepository, "findById").mockResolvedValue(payout({ status: PayoutStatus.REVERSED }));
    await payoutService.markReversed("6aafbb5e07d38f34801eddfd"); // already reversed: no-op
    expect(reversal).not.toHaveBeenCalled();
  });

  it("markProcessing / unknown payout -> 404", async () => {
    vi.spyOn(payoutRepository, "transition").mockResolvedValue(null);
    vi.spyOn(payoutRepository, "findById").mockResolvedValue(null);
    await expect(payoutService.markProcessing("6aafbb5e07d38f34801eddfd")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("refund side effects", () => {
  const session = fakeSession() as any;

  it("nothing to do when the driver's share is untouched or no payout exists", async () => {
    const find = vi.spyOn(payoutRepository, "findLiveByPayment").mockResolvedValue(null);
    expect(await payoutService.handleRefundBooked(oid(), 0, session)).toEqual({ clawbackRequired: false });
    expect(find).not.toHaveBeenCalled();
    expect(await payoutService.handleRefundBooked(oid(), 10, session)).toEqual({ clawbackRequired: false });
  });

  it("a PENDING payout is cancelled (the money has not been sent yet)", async () => {
    const p = payout();
    vi.spyOn(payoutRepository, "findLiveByPayment").mockResolvedValue(p);
    const t = vi.spyOn(payoutRepository, "transition").mockResolvedValue({ ...p, status: PayoutStatus.CANCELLED } as any);
    const result = await payoutService.handleRefundBooked(oid(), 100, session);
    expect(result).toEqual({ cancelledPayoutId: p._id.toString(), clawbackRequired: false });
    expect(t.mock.calls[0]![1]).toEqual([PayoutStatus.PENDING]);
  });

  it("PROCESSING / PROCESSED payouts (or a lost cancel race) require a clawback", async () => {
    for (const status of [PayoutStatus.PROCESSING, PayoutStatus.PROCESSED]) {
      vi.spyOn(payoutRepository, "findLiveByPayment").mockResolvedValue(payout({ status }));
      expect(await payoutService.handleRefundBooked(oid(), 100, session)).toEqual({ clawbackRequired: true });
    }
    vi.spyOn(payoutRepository, "findLiveByPayment").mockResolvedValue(payout());
    vi.spyOn(payoutRepository, "transition").mockResolvedValue(null);
    expect(await payoutService.handleRefundBooked(oid(), 100, session)).toEqual({ clawbackRequired: true });
  });
});

describe("balances and webhook entry point", () => {
  it("getDriverBalance = ledger balance - reserved payouts", async () => {
    vi.spyOn(ledgerService, "getOwnerBalance").mockResolvedValue({ totalCreditPaise: 5000, totalDebitPaise: 1200, netCreditPaise: 3800 });
    vi.spyOn(payoutRepository, "sumAmountByDriver").mockResolvedValue(800);
    expect(await payoutService.getDriverBalance(oid())).toEqual({ earnedPaise: 5000, debitedPaise: 1200, balancePaise: 3800, reservedPaise: 800, availablePaise: 3000 });
  });

  it("payout.* events call the matching state change; lookup falls back to reference_id", async () => {
    const p = payout();
    vi.spyOn(payoutRepository, "findByGatewayPayoutId").mockResolvedValue(null);
    vi.spyOn(payoutRepository, "findById").mockResolvedValue(p);
    const processing = vi.spyOn(payoutService, "markProcessing").mockResolvedValue(p);
    const processed = vi.spyOn(payoutService, "markProcessed").mockResolvedValue({ ...p, status: PayoutStatus.PROCESSED } as any);
    const failed = vi.spyOn(payoutService, "markFailed").mockResolvedValue(p);
    const reversed = vi.spyOn(payoutService, "markReversed").mockResolvedValue(p);
    const entity = (o = {}) => ({ id: "pout_1", reference_id: p._id.toString(), utr: "UTR9", failure_reason: null, ...o }) as any;

    await payoutService.handleGatewayPayoutEvent("payout.initiated", entity());
    await payoutService.handleGatewayPayoutEvent("payout.processed", entity());
    await payoutService.handleGatewayPayoutEvent("payout.failed", entity({ failure_reason: "bad account" }));
    await payoutService.handleGatewayPayoutEvent("payout.rejected", entity());
    await payoutService.handleGatewayPayoutEvent("payout.reversed", entity());

    expect(processing).toHaveBeenCalledWith(p._id.toString(), "pout_1");
    expect(processed).toHaveBeenCalledWith(p._id.toString(), "pout_1", "UTR9");
    expect(failed).toHaveBeenCalledTimes(2);
    expect(failed.mock.calls[0]![1]).toBe("bad account");
    expect(reversed).toHaveBeenCalledTimes(1);
  });

  it("unknown payout is a non-retryable error", async () => {
    vi.spyOn(payoutRepository, "findByGatewayPayoutId").mockResolvedValue(null);
    vi.spyOn(payoutRepository, "findById").mockResolvedValue(null);
    await expect(payoutService.handleGatewayPayoutEvent("payout.processed", { id: "pout_x", reference_id: null } as any)).rejects.toBeInstanceOf(NonRetryablePaymentError);
  });
});
