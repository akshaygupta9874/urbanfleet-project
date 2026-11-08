import { describe, it, expect, vi } from "vitest";
import { reconciliationService } from "../../src/services/reconciliation.service.js";
import { paymentRepository } from "../../src/repositories/payment.repository.js";
import { ledgerRepository } from "../../src/repositories/ledger.repository.js";
import { paymentService } from "../../src/services/payment.service.js";
import { razorpayClient } from "../../src/config/razorpay.config.js";
import { LedgerAccount as A, LedgerEntryType as T, LedgerReferenceType, PaymentStatus } from "../../src/types/payment.types.js";
import { capturedEntity, makePayment } from "../helpers/helpers.js";

const leg = (transactionId: string, account: A, entryType: T, amountPaise: number) => ({ transactionId, account, entryType, amountPaise });
const captureLegs = (tx = "tx-cap") => [
  leg(tx, A.RIDER, T.DEBIT, 1000), leg(tx, A.PLATFORM, T.CREDIT, 300), leg(tx, A.DRIVER, T.CREDIT, 700),
];
const paid = (over = {}) => makePayment({ status: PaymentStatus.CAPTURED, ledgerTransactionId: "tx-cap", gatewayPaymentId: "pay_TEST1", ...over });

function ledgerFor(payment: any, capture: any[]) {
  vi.spyOn(paymentRepository, "findById").mockResolvedValue(payment);
  vi.spyOn(ledgerRepository, "listByReference").mockImplementation((async (type: LedgerReferenceType) =>
    type === LedgerReferenceType.PAYMENT ? capture : []) as any);
}

describe("reconcilePayment - ledger checks", () => {
  it("a consistent captured payment has no issues", async () => {
    const p = paid();
    ledgerFor(p, captureLegs());
    const report = await reconciliationService.reconcilePayment(p.id.toString());
    expect(report).toMatchObject({ status: PaymentStatus.CAPTURED, issues: [], healed: false, ledgerEntryCount: 3, ledgerTransactionId: "tx-cap" });
  });

  it("detects wrong legs, duplicate postings and a missing ledger id", async () => {
    let p = paid();
    ledgerFor(p, [leg("tx-cap", A.RIDER, T.DEBIT, 1000), leg("tx-cap", A.PLATFORM, T.CREDIT, 300), leg("tx-cap", A.DRIVER, T.CREDIT, 650)]);
    let issues = (await reconciliationService.reconcilePayment(p.id.toString())).issues.join("|");
    expect(issues).toMatch(/unbalanced/);
    expect(issues).toMatch(/DRIVER credit/);

    p = paid();
    ledgerFor(p, [...captureLegs("tx-cap"), ...captureLegs("tx-dup")]);
    issues = (await reconciliationService.reconcilePayment(p.id.toString())).issues.join("|");
    expect(issues).toMatch(/exactly one capture ledger transaction/);

    p = paid({ ledgerTransactionId: undefined });
    ledgerFor(p, captureLegs());
    issues = (await reconciliationService.reconcilePayment(p.id.toString())).issues.join("|");
    expect(issues).toMatch(/no ledgerTransactionId/);
  });

  it("optionally compares with the gateway", async () => {
    const p = paid();
    ledgerFor(p, captureLegs());
    vi.spyOn(razorpayClient.payments, "fetch").mockResolvedValue(capturedEntity({ amount: 900 }) as any);
    const issues = (await reconciliationService.reconcilePayment(p.id.toString(), { checkGateway: true })).issues.join("|");
    expect(issues).toMatch(/Gateway amount 900 differs/);
  });

  it("unknown payment -> 404", async () => {
    vi.spyOn(paymentRepository, "findById").mockResolvedValue(null);
    await expect(reconciliationService.reconcilePayment("6aafbb5e07d38f34801eddfd")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("healing missed webhooks", () => {
  it("reports an order reservation without asking Razorpay to fetch a missing order ID", async () => {
    const reserved = makePayment({
      gatewayOrderId: undefined,
      status: PaymentStatus.CREATED,
    });
    vi.spyOn(paymentRepository, "findById").mockResolvedValue(reserved);
    const fetchPayments = vi.spyOn(razorpayClient.orders, "fetchPayments");

    const report = await reconciliationService.reconcilePayment(
      reserved.id.toString()
    );

    expect(report.issues.join(" ")).toMatch(/order creation is incomplete or uncertain/i);
    expect(fetchPayments).not.toHaveBeenCalled();
  });

  it("a stuck PENDING payment that the gateway shows as captured is recorded", async () => {
    const stuck = makePayment({ status: PaymentStatus.PENDING });
    const findById = vi.spyOn(paymentRepository, "findById").mockResolvedValueOnce(stuck).mockResolvedValue(paid({ id: stuck.id }));
    vi.spyOn(razorpayClient.orders, "fetchPayments").mockResolvedValue({ items: [capturedEntity({ status: "failed", captured: false, id: "pay_old" }), capturedEntity()] } as any);
    const capture = vi.spyOn(paymentService, "handlePaymentCaptured").mockResolvedValue();
    vi.spyOn(ledgerRepository, "listByReference").mockImplementation((async (t: LedgerReferenceType) => (t === LedgerReferenceType.PAYMENT ? captureLegs() : [])) as any);

    const report = await reconciliationService.reconcilePayment(stuck.id.toString());
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ id: "pay_TEST1", status: "captured" }));
    expect(report.healed).toBe(true);
    expect(report.status).toBe(PaymentStatus.CAPTURED);
    expect(findById).toHaveBeenCalledTimes(2);
  });

  it("sweep: counts checked / healed / failed and survives one bad payment", async () => {
    const [a, b, c] = [makePayment(), makePayment({ gatewayOrderId: "order_B" }), makePayment({ gatewayOrderId: "order_C" })];
    vi.spyOn(paymentRepository, "findUnsettled").mockResolvedValue([a, b, c]);
    vi.spyOn(razorpayClient.orders, "fetchPayments").mockImplementation((async (orderId: string) => {
      if (orderId === "order_B") throw new TypeError("network");
      return { items: orderId === "order_TEST1" ? [capturedEntity()] : [] };
    }) as any);
    vi.spyOn(paymentService, "handlePaymentCaptured").mockResolvedValue();
    expect(await reconciliationService.reconcileStalePayments({ olderThanMinutes: 5 })).toEqual({ checked: 3, healed: 1, failed: 1 });
  });

  it("sweep uses a bounded time window", async () => {
    const find = vi.spyOn(paymentRepository, "findUnsettled").mockResolvedValue([]);
    await reconciliationService.reconcileStalePayments({ olderThanMinutes: 10, maxAgeDays: 2, limit: 7 });
    const [statuses, olderThan, newerThan, limit] = find.mock.calls[0]!;
    expect(statuses).toEqual([PaymentStatus.CREATED, PaymentStatus.PENDING, PaymentStatus.AUTHORIZED, PaymentStatus.FAILED]);
    expect(Date.now() - (olderThan as Date).getTime()).toBeGreaterThanOrEqual(10 * 60_000 - 50);
    expect(Date.now() - (newerThan as Date).getTime()).toBeGreaterThanOrEqual(2 * 86_400_000 - 50);
    expect(limit).toBe(7);
  });
});

describe("verifyLedgerIntegrity", () => {
  it("balanced when totals match and no transaction is unbalanced", async () => {
    vi.spyOn(ledgerRepository, "sumAll").mockResolvedValue({ totalDebitPaise: 5000, totalCreditPaise: 5000 });
    vi.spyOn(ledgerRepository, "findUnbalancedTransactions").mockResolvedValue([]);
    expect(await reconciliationService.verifyLedgerIntegrity()).toMatchObject({ balanced: true });
  });

  it("reports unbalanced transactions", async () => {
    vi.spyOn(ledgerRepository, "sumAll").mockResolvedValue({ totalDebitPaise: 5001, totalCreditPaise: 5000 });
    vi.spyOn(ledgerRepository, "findUnbalancedTransactions").mockResolvedValue([{ transactionId: "t", debitPaise: 1, creditPaise: 0 }]);
    const report = await reconciliationService.verifyLedgerIntegrity();
    expect(report.balanced).toBe(false);
    expect(report.unbalancedTransactions).toHaveLength(1);
  });
});
