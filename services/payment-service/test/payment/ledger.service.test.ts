import { describe, it, expect, vi } from "vitest";
import { Types } from "../../src/payment/types/objectid.js";
import { ledgerService } from "../../src/payment/services/ledger.service.js";
import { ledgerRepository } from "../../src/payment/repositories/ledger.repository.js";
import {
  LedgerAccount as A,
  LedgerEntryType as T,
  LedgerReferenceType,
} from "../../src/payment/types/payment.types.js";
import { fakeSession, makePayment, oid } from "../helpers/helpers.js";

function captureInserts() {
  const rows: any[] = [];
  vi.spyOn(ledgerRepository, "insertEntries").mockImplementation(async (r: any) => {
    rows.push(...r);
    return r;
  });
  return rows;
}

const sum = (rows: any[], type: T, account?: A) =>
  rows
    .filter((r) => r.entryType === type && (!account || r.account === account))
    .reduce((s, r) => s + r.amountPaise, 0);

describe("ledgerService.recordTransaction", () => {
  it("rejects unbalanced and zero / fractional legs", async () => {
    captureInserts();
    const base = { referenceType: LedgerReferenceType.ADJUSTMENT, referenceId: oid() };
    await expect(
      ledgerService.recordTransaction({ ...base, entries: [
        { account: A.RIDER, entryType: T.DEBIT, amountPaise: 100, description: "x" },
        { account: A.DRIVER, entryType: T.CREDIT, amountPaise: 90, description: "y" },
      ] }, fakeSession() as any)
    ).rejects.toMatchObject({ statusCode: 500 });

    await expect(
      ledgerService.recordTransaction({ ...base, entries: [
        { account: A.RIDER, entryType: T.DEBIT, amountPaise: 100, description: "x" },
        { account: A.DRIVER, entryType: T.CREDIT, amountPaise: 0, description: "y" },
      ] }, fakeSession() as any)
    ).rejects.toThrow(/positive integer/);

    await expect(
      ledgerService.recordTransaction({ ...base, entries: [
        { account: A.RIDER, entryType: T.DEBIT, amountPaise: 10.5, description: "x" },
        { account: A.DRIVER, entryType: T.CREDIT, amountPaise: 10.5, description: "y" },
      ] }, fakeSession() as any)
    ).rejects.toThrow(/positive integer/);
  });

  it("stamps idempotencyKey + legIndex, honours a pre-allocated transactionId and owner ids", async () => {
    const rows = captureInserts();
    const owner = oid();
    const id = await ledgerService.recordTransaction({
      referenceType: LedgerReferenceType.ADJUSTMENT,
      referenceId: oid(),
      transactionId: "tx-fixed",
      idempotencyKey: "adj:1",
      entries: [
        { account: A.RIDER, entryType: T.DEBIT, amountPaise: 5, description: "a", ownerId: owner },
        { account: A.PLATFORM, entryType: T.CREDIT, amountPaise: 5, description: "b" },
      ],
    }, fakeSession() as any);

    expect(id).toBe("tx-fixed");
    expect(rows.map((r) => [r.transactionId, r.idempotencyKey, r.legIndex])).toEqual([
      ["tx-fixed", "adj:1", 0],
      ["tx-fixed", "adj:1", 1],
    ]);
    expect(rows[0].ownerId).toBe(owner);
  });

  it("turns a duplicate-key error on an idempotent posting into 409 LEDGER_DUPLICATE_POSTING", async () => {
    vi.spyOn(ledgerRepository, "insertEntries").mockRejectedValue(
      Object.assign(new Error("E11000 duplicate key"), { code: 11000 })
    );
    await expect(
      ledgerService.recordTransaction({
        referenceType: LedgerReferenceType.PAYMENT,
        referenceId: oid(),
        idempotencyKey: "payment:1:capture",
        entries: [
          { account: A.RIDER, entryType: T.DEBIT, amountPaise: 5, description: "a" },
          { account: A.PLATFORM, entryType: T.CREDIT, amountPaise: 5, description: "b" },
        ],
      }, fakeSession() as any)
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("posting rules", () => {
  it("capture: rider DEBIT = platform + driver CREDIT, owners set, key set", async () => {
    const rows = captureInserts();
    const payment = makePayment({ amountPaise: 25000, fareBreakdown: {
      platformCommissionPaise: 5000, driverEarningPaise: 20000, totalPaise: 25000,
    } });

    await ledgerService.recordPaymentCapture(payment, "tx-1", fakeSession() as any);

    expect(rows).toHaveLength(3);
    expect(sum(rows, T.DEBIT)).toBe(25000);
    expect(sum(rows, T.CREDIT, A.PLATFORM)).toBe(5000);
    expect(sum(rows, T.CREDIT, A.DRIVER)).toBe(20000);
    expect(rows.find((r) => r.account === A.DRIVER).ownerId).toBe(payment.driver);
    expect(rows.find((r) => r.account === A.RIDER).ownerId).toBe(payment.rider);
    expect(rows.every((r) => r.idempotencyKey === `payment:${payment._id}:capture`)).toBe(true);
    expect(rows.every((r) => r.referenceType === LedgerReferenceType.PAYMENT)).toBe(true);
  });

  it("capture: a zero-commission fare no longer throws (the zero leg is skipped)", async () => {
    const rows = captureInserts();
    const payment = makePayment({ amountPaise: 1000, fareBreakdown: {
      platformCommissionPaise: 0, driverEarningPaise: 1000, totalPaise: 1000,
    } });
    await ledgerService.recordPaymentCapture(payment, "tx-2", fakeSession() as any);
    expect(rows.map((r) => r.account).sort()).toEqual([A.DRIVER, A.RIDER].sort());
    expect(sum(rows, T.DEBIT)).toBe(sum(rows, T.CREDIT));
  });

  it("refund booking and compensation are exact mirrors and always balance", async () => {
    const rows = captureInserts();
    const payment = makePayment();
    const refundId = new Types.ObjectId();
    const args = {
      payment, refundId, amountPaise: 250,
      split: { driverPaise: 175, platformPaise: 75 }, reason: "test", transactionId: "tx-r",
    };

    await ledgerService.recordRefundBooking(args, fakeSession() as any);
    const booking = rows.splice(0);
    await ledgerService.recordRefundCompensation({ ...args, transactionId: "tx-u" }, fakeSession() as any);
    const undo = rows.splice(0);

    for (const set of [booking, undo]) expect(sum(set, T.DEBIT)).toBe(sum(set, T.CREDIT));

    // booking: rider CREDIT 250, platform DEBIT 75, driver DEBIT 175
    expect(sum(booking, T.CREDIT, A.RIDER)).toBe(250);
    expect(sum(booking, T.DEBIT, A.PLATFORM)).toBe(75);
    expect(sum(booking, T.DEBIT, A.DRIVER)).toBe(175);
    // compensation nets every account back to zero
    for (const acc of [A.RIDER, A.PLATFORM, A.DRIVER]) {
      const net = (set: any[]) => sum(set, T.CREDIT, acc) - sum(set, T.DEBIT, acc);
      expect(net(booking) + net(undo)).toBe(0);
    }
    expect(booking[0].idempotencyKey).toMatch(/:book$/);
    expect(undo[0].idempotencyKey).toMatch(/:undo$/);
    expect(booking.every((r) => r.referenceType === LedgerReferenceType.REFUND && r.referenceId === payment._id)).toBe(true);
  });

  it("payout disbursement and reversal move DRIVER <-> BANK", async () => {
    const rows = captureInserts();
    const payoutId = oid();
    const driverId = oid();

    await ledgerService.recordPayoutDisbursement({ payoutId, driverId, amountPaise: 700, transactionId: "p1" }, fakeSession() as any);
    expect(sum(rows, T.DEBIT, A.DRIVER)).toBe(700);
    expect(sum(rows, T.CREDIT, A.BANK)).toBe(700);
    expect(rows.find((r) => r.account === A.DRIVER).ownerId).toBe(driverId);
    rows.splice(0);

    await ledgerService.recordPayoutReversal({ payoutId, driverId, amountPaise: 700, transactionId: "p2", reason: "returned" }, fakeSession() as any);
    expect(sum(rows, T.DEBIT, A.BANK)).toBe(700);
    expect(sum(rows, T.CREDIT, A.DRIVER)).toBe(700);
  });

  it("getOwnerBalance = credits - debits", async () => {
    vi.spyOn(ledgerRepository, "sumByAccount").mockResolvedValue({ totalDebitPaise: 300, totalCreditPaise: 1000 });
    const balance = await ledgerService.getOwnerBalance(A.DRIVER, oid());
    expect(balance).toEqual({ totalDebitPaise: 300, totalCreditPaise: 1000, netCreditPaise: 700 });
  });
});
