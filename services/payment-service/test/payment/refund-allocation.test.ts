import { describe, it, expect } from "vitest";
import { allocateRefund } from "../../src/payment/utils/refund-allocation.js";
import { computeRefundTotals } from "../../src/payment/utils/refund-totals.js";
import { RefundStatus } from "../../src/payment/types/payment.types.js";

/** deterministic PRNG so failures are reproducible */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

interface Live { amount: number; driver: number; platform: number }

function book(total: number, D: number, C: number, live: Live[], amount: number): Live {
  const refunded = live.reduce((s, r) => s + r.amount, 0);
  const split = allocateRefund({
    totalPaise: total,
    driverEarningPaise: D,
    platformCommissionPaise: C,
    refundedSoFarPaise: refunded,
    driverReversedSoFarPaise: live.reduce((s, r) => s + r.driver, 0),
    platformReversedSoFarPaise: live.reduce((s, r) => s + r.platform, 0),
    refundPaise: amount,
  });
  return { amount, driver: split.driverPaise, platform: split.platformPaise };
}

describe("allocateRefund", () => {
  it("fixes the case that drifted in the original (101 paise, refunded 33+33+35)", () => {
    const live: Live[] = [];
    for (const part of [33, 33, 35]) live.push(book(101, 1, 100, live, part));
    expect(live.reduce((s, r) => s + r.driver, 0)).toBe(1);
    expect(live.reduce((s, r) => s + r.platform, 0)).toBe(100);
  });

  it("splits a single refund proportionally (rounding driver down)", () => {
    // 250 of 1000, driver share 700 => driver 175, platform 75
    expect(
      allocateRefund({
        totalPaise: 1000, driverEarningPaise: 700, platformCommissionPaise: 300,
        refundedSoFarPaise: 0, driverReversedSoFarPaise: 0, platformReversedSoFarPaise: 0,
        refundPaise: 250,
      })
    ).toEqual({ driverPaise: 175, platformPaise: 75 });
  });

  it("a full refund reverses every leg exactly", () => {
    expect(
      allocateRefund({
        totalPaise: 25000, driverEarningPaise: 20000, platformCommissionPaise: 5000,
        refundedSoFarPaise: 0, driverReversedSoFarPaise: 0, platformReversedSoFarPaise: 0,
        refundPaise: 25000,
      })
    ).toEqual({ driverPaise: 20000, platformPaise: 5000 });
  });

  it("handles zero-commission and zero-driver fares", () => {
    expect(
      allocateRefund({
        totalPaise: 500, driverEarningPaise: 500, platformCommissionPaise: 0,
        refundedSoFarPaise: 0, driverReversedSoFarPaise: 0, platformReversedSoFarPaise: 0,
        refundPaise: 123,
      })
    ).toEqual({ driverPaise: 123, platformPaise: 0 });

    expect(
      allocateRefund({
        totalPaise: 500, driverEarningPaise: 0, platformCommissionPaise: 500,
        refundedSoFarPaise: 0, driverReversedSoFarPaise: 0, platformReversedSoFarPaise: 0,
        refundPaise: 123,
      })
    ).toEqual({ driverPaise: 0, platformPaise: 123 });
  });

  it("property: any partition of the full amount reverses each leg exactly and never goes negative", () => {
    const rnd = prng(42);
    for (let i = 0; i < 4000; i++) {
      const total = 100 + Math.floor(rnd() * 5_000_000);
      const D = Math.floor(rnd() * (total + 1));
      const C = total - D;
      const live: Live[] = [];
      let remaining = total;

      while (remaining > 0) {
        const amount = rnd() < 0.25 ? remaining : 1 + Math.floor(rnd() * remaining);
        const r = book(total, D, C, live, amount);
        expect(r.driver + r.platform).toBe(amount);
        expect(r.driver).toBeGreaterThanOrEqual(0);
        expect(r.platform).toBeGreaterThanOrEqual(0);
        live.push(r);
        remaining -= amount;
      }

      expect(live.reduce((s, r) => s + r.driver, 0)).toBe(D);
      expect(live.reduce((s, r) => s + r.platform, 0)).toBe(C);
    }
  });

  it("property: failed refunds (compensation) never break exactness of the final full refund", () => {
    const rnd = prng(7);
    for (let i = 0; i < 3000; i++) {
      const total = 100 + Math.floor(rnd() * 100_000);
      const D = Math.floor(rnd() * (total + 1));
      const C = total - D;
      const live: Live[] = [];

      for (let step = 0; step < 8; step++) {
        const refunded = live.reduce((s, r) => s + r.amount, 0);
        const remaining = total - refunded;

        if (live.length > 0 && rnd() < 0.35) {
          // a random booked refund FAILS at the gateway and is compensated
          live.splice(Math.floor(rnd() * live.length), 1);
        } else if (remaining > 0) {
          live.push(book(total, D, C, live, 1 + Math.floor(rnd() * remaining)));
        }
      }

      const refunded = live.reduce((s, r) => s + r.amount, 0);
      const remaining = total - refunded;
      if (remaining > 0) live.push(book(total, D, C, live, remaining));

      expect(live.reduce((s, r) => s + r.amount, 0)).toBe(total);
      expect(live.reduce((s, r) => s + r.driver, 0)).toBe(D);
      expect(live.reduce((s, r) => s + r.platform, 0)).toBe(C);
    }
  });

  it("rejects impossible input", () => {
    const base = {
      totalPaise: 1000, driverEarningPaise: 700, platformCommissionPaise: 300,
      refundedSoFarPaise: 0, driverReversedSoFarPaise: 0, platformReversedSoFarPaise: 0,
      refundPaise: 100,
    };
    expect(() => allocateRefund({ ...base, refundPaise: 0 })).toThrow(RangeError);
    expect(() => allocateRefund({ ...base, refundPaise: 1001 })).toThrow(/exceeds/);
    expect(() => allocateRefund({ ...base, refundPaise: 10.5 })).toThrow(RangeError);
    expect(() => allocateRefund({ ...base, driverEarningPaise: 600 })).toThrow(RangeError);
    expect(() => allocateRefund({ ...base, refundedSoFarPaise: 100 })).toThrow(/add up/);
  });
});

describe("computeRefundTotals", () => {
  const fare = { driverEarningPaise: 700, platformCommissionPaise: 300 };

  it("sums live refunds and ignores FAILED ones", () => {
    const totals = computeRefundTotals({
      amountPaise: 1000,
      refundedAmountPaise: 300,
      fareBreakdown: fare as any,
      refunds: [
        { status: RefundStatus.PROCESSED, amountPaise: 100, driverReversalPaise: 70, platformReversalPaise: 30 },
        { status: RefundStatus.PENDING, amountPaise: 200, driverReversalPaise: 140, platformReversalPaise: 60 },
        { status: RefundStatus.FAILED, amountPaise: 500, driverReversalPaise: 350, platformReversalPaise: 150 },
      ] as any,
    });
    expect(totals).toEqual({ refundedPaise: 300, driverReversedPaise: 210, platformReversedPaise: 90 });
  });

  it("attributes refunds made before refund records existed (legacy) proportionally", () => {
    const totals = computeRefundTotals({
      amountPaise: 1000,
      refundedAmountPaise: 250,
      fareBreakdown: fare as any,
      refunds: [] as any,
    });
    expect(totals).toEqual({ refundedPaise: 250, driverReversedPaise: 175, platformReversedPaise: 75 });
  });

  it("throws when records exceed the payment total (corrupt data)", () => {
    expect(() =>
      computeRefundTotals({
        amountPaise: 1000,
        refundedAmountPaise: 50,
        fareBreakdown: fare as any,
        refunds: [{ status: RefundStatus.PENDING, amountPaise: 100, driverReversalPaise: 70, platformReversalPaise: 30 }] as any,
      })
    ).toThrow(/inconsisten/i);
  });
});
