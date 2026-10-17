import { describe, it, expect, vi } from "vitest";
import { Types } from "../../src/payment/types/objectid.js";
import { createHash } from "crypto";
import {
  createOrderSchema, verifyCheckoutSchema, refundSchema, listPaymentsQuerySchema,
  paymentIdParamSchema, validate,
} from "../../src/payment/validation/payment.validation.js";
import { requireAdmin } from "../../src/payment/middlewares/require-admin.middleware.js";
import * as controller from "../../src/payment/controllers/payment.controller.js";
import { paymentService } from "../../src/payment/services/payment.service.js";
import { paymentRepository } from "../../src/payment/repositories/payment.repository.js";
import { UserRole } from "@prisma/client";
import { prisma } from "../../src/db/client.js";
import { PaymentStatus, RefundStatus } from "../../src/payment/types/payment.types.js";
import { makePayment, oid } from "../helpers/helpers.js";

const rideId = "6aafbb5e07d38f34801eddfd";

describe("validation schemas", () => {
  it("createOrder needs only a valid rideId; legacy client fields are dropped, never trusted", () => {
    const legacy = {
      rideId, driverId: "x", idempotencyKey: "abc",
      fareBreakdown: { baseFarePaise: 1, distanceFarePaise: 1, timeFarePaise: 1, surgePaise: 0, platformCommissionPaise: 1, driverEarningPaise: 2, totalPaise: 3.5 },
    };
    const parsed = createOrderSchema.parse({ body: legacy });
    expect(parsed.body).toEqual({ rideId });
    expect(createOrderSchema.safeParse({ body: { rideId: "not-an-id" } }).success).toBe(false);
    expect(createOrderSchema.safeParse({ body: {} }).success).toBe(false);
  });

  it("verify: Razorpay id shapes and a 64-hex signature", () => {
    const ok = { razorpay_order_id: "order_Abc123", razorpay_payment_id: "pay_Xyz789", razorpay_signature: "a".repeat(64) };
    expect(verifyCheckoutSchema.safeParse({ body: ok }).success).toBe(true);
    for (const bad of [{ razorpay_order_id: "x" }, { razorpay_payment_id: "order_1" }, { razorpay_signature: "zz" }, { razorpay_signature: "a".repeat(63) }]) {
      expect(verifyCheckoutSchema.safeParse({ body: { ...ok, ...bad } }).success).toBe(false);
    }
  });

  it("refund + params + list query", () => {
    expect(refundSchema.safeParse({ body: { reason: "ok reason", amountPaise: 100 } }).success).toBe(true);
    expect(refundSchema.safeParse({ body: { reason: "ok reason", amountPaise: 1.5 } }).success).toBe(false);
    expect(refundSchema.safeParse({ body: { reason: "x" } }).success).toBe(false);
    expect(paymentIdParamSchema.safeParse({ params: { paymentId: "nope" } }).success).toBe(false);

    expect(listPaymentsQuerySchema.parse({ query: {} }).query).toEqual({ page: 1, limit: 20 });
    expect(listPaymentsQuerySchema.parse({ query: { page: "3", limit: "50", status: "CAPTURED" } }).query).toEqual({ page: 3, limit: 50, status: PaymentStatus.CAPTURED });
    expect(listPaymentsQuerySchema.safeParse({ query: { limit: "101" } }).success).toBe(false);
    expect(listPaymentsQuerySchema.safeParse({ query: { status: "BOGUS" } }).success).toBe(false);
  });

  it("validate(): 422 on failure, otherwise replaces body / query with the parsed values", () => {
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    validate(createOrderSchema)({ body: {}, params: {}, query: {} } as any, res, next);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(next).not.toHaveBeenCalled();

    const req: any = { body: { rideId, extra: 1 }, params: {}, query: {} };
    validate(createOrderSchema)(req, res, next);
    expect(req.body).toEqual({ rideId });
    expect(next).toHaveBeenCalled();
  });
});

describe("requireAdmin", () => {
  const run = async (req: any, user: any) => {
    vi.spyOn(prisma.user, "findUnique").mockResolvedValue(user ? ({ roles: user.role } as any) : null);
    const next = vi.fn();
    await requireAdmin(req, {} as any, next);
    return next;
  };

  it("lets admins through", async () => {
    const next = await run({ userId: "u1" }, { role: [UserRole.RIDER, UserRole.ADMIN] });
    expect(next).toHaveBeenCalledWith();
  });

  it("FIXED: riders / drivers get 403, anonymous and unknown users 401", async () => {
    expect((await run({ userId: "u1" }, { role: [UserRole.RIDER, UserRole.DRIVER] })).mock.calls[0]![0]).toMatchObject({ statusCode: 403 });
    expect((await run({}, null)).mock.calls[0]![0]).toMatchObject({ statusCode: 401 });
    expect((await run({ userId: "u1" }, null)).mock.calls[0]![0]).toMatchObject({ statusCode: 401 });
  });
});

describe("controllers", () => {
  const call = async (handler: any, req: any) => {
    const res: any = { statusCode: 0, body: undefined, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
    const next = vi.fn();
    handler(req, res, next);
    await new Promise((r) => setImmediate(r));
    return { res, next };
  };
  const asUser = (roles: UserRole[]) => vi.spyOn(prisma.user, "findUnique").mockResolvedValue({ roles } as any);

  it("createOrder derives the idempotency key from (ride, rider) and never from the client", async () => {
    const riderId = oid().toString();
    const create = vi.spyOn(paymentService, "createOrder").mockResolvedValue({ paymentId: "p" } as any);
    const { res } = await call(controller.createOrder, { userId: riderId, body: { rideId, idempotencyKey: "client-chosen" } });
    const arg = create.mock.calls[0]![0];
    expect(arg.idempotencyKey).toBe(createHash("sha256").update(`${rideId}:${riderId}`).digest("hex"));
    expect(arg.ride).toBeInstanceOf(Types.ObjectId);
    expect(res.statusCode).toBe(201);
  });

  it("unauthenticated requests get 401 (was 400)", async () => {
    for (const handler of [controller.createOrder, controller.verifyCheckout, controller.getPayment, controller.listPayments, controller.refundPayment]) {
      const { next } = await call(handler, { body: {}, params: {}, query: {} });
      expect(next.mock.calls[0]![0]).toMatchObject({ statusCode: 401 });
    }
  });

  it("verifyCheckout passes the caller so ownership can be enforced", async () => {
    const riderId = oid().toString();
    const verify = vi.spyOn(paymentService, "verifyCheckoutSignature").mockResolvedValue(PaymentStatus.PENDING);
    await call(controller.verifyCheckout, { userId: riderId, body: { razorpay_order_id: "o", razorpay_payment_id: "p", razorpay_signature: "s" } });
    expect(verify.mock.calls[0]![0].requesterId!.toString()).toBe(riderId);
  });

  it("getPayment: participant sees a sanitised view, stranger gets 403, admin sees everything", async () => {
    const payment = makePayment({ refunds: [{ _id: oid(), amountPaise: 5, status: RefundStatus.PROCESSED, createdAt: new Date(), initiatedBy: oid(), driverReversalPaise: 3, platformReversalPaise: 2, ledgerTransactionId: "t" }], metadata: { a: 1 }, ledgerTransactionId: "tx" });
    vi.spyOn(paymentRepository, "findById").mockResolvedValue(payment);

    asUser([UserRole.RIDER]);
    const { res } = await call(controller.getPayment, { userId: payment.rider.toString(), params: { paymentId: "x" } });
    expect(res.statusCode).toBe(200);
    expect(res.body.data).not.toHaveProperty("idempotencyKey");
    expect(res.body.data).not.toHaveProperty("metadata");
    expect(res.body.data).not.toHaveProperty("ledgerTransactionId");
    expect(Object.keys(res.body.data.refunds[0]).sort()).toEqual(["_id", "amountPaise", "createdAt", "processedAt", "status"]);

    let out = await call(controller.getPayment, { userId: oid().toString(), params: { paymentId: "x" } });
    expect(out.next.mock.calls[0]![0]).toMatchObject({ statusCode: 403 });

    asUser([UserRole.ADMIN]);
    out = await call(controller.getPayment, { userId: oid().toString(), params: { paymentId: "x" } });
    expect(out.res.body.data).toHaveProperty("idempotencyKey");
    expect(out.res.body.data.refunds[0]).toHaveProperty("driverReversalPaise");
  });

  it("listPayments: riders are limited to their own payments; response is paginated but `data` is still an array", async () => {
    const riderId = oid().toString();
    asUser([UserRole.RIDER]);
    const list = vi.spyOn(paymentRepository, "listPaginated").mockResolvedValue({ items: [makePayment()], total: 41 });
    const { res } = await call(controller.listPayments, { userId: riderId, query: { page: 2, limit: 20, status: PaymentStatus.CAPTURED } });
    expect(list).toHaveBeenCalledWith({ rider: riderId, status: PaymentStatus.CAPTURED }, 2, 20);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toEqual({ page: 2, limit: 20, total: 41, totalPages: 3 });

    asUser([UserRole.ADMIN]);
    await call(controller.listPayments, { userId: riderId, query: { page: 1, limit: 20 } });
    expect(list.mock.calls[1]![0]).toEqual({ status: undefined });
  });

  it("refundPayment returns 202 with the refund result", async () => {
    const refund = vi.spyOn(paymentService, "initiateRefund").mockResolvedValue({ refundId: "r1" } as any);
    const adminId = oid().toString();
    const { res } = await call(controller.refundPayment, { userId: adminId, params: { paymentId: rideId }, body: { reason: "why not", amountPaise: 50 } });
    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ message: "Refund initiated", data: { refundId: "r1" } });
    expect(refund.mock.calls[0]![0].initiatedBy.toString()).toBe(adminId);
  });
});
