import { vi } from "vitest";
import { Types } from "../../src/payment/types/objectid.js";
import { PaymentStatus } from "../../src/payment/types/payment.types.js";

/** A session whose transactions simply run the callback once (no MongoDB needed). */
export function fakeSession() {
  return {
    withTransaction: async (fn: () => Promise<unknown>) => {
      await fn();
    },
    endSession: async () => {},
  };
}

/** Same, but the callback is retried like the driver does on TransientTransactionError. */
export function retryingSession(times: number) {
  return {
    withTransaction: async (fn: () => Promise<unknown>) => {
      for (let i = 0; i < times; i++) {
        await fn();
      }
    },
    endSession: async () => {},
  };
}

export const oid = () => new Types.ObjectId();

export function makePayment(over: Record<string, unknown> = {}) {
  const payment: any = {
    _id: oid(),
    ride: oid(),
    rider: oid(),
    driver: oid(),
    gatewayOrderId: "order_TEST1",
    gatewayPaymentId: undefined,
    amountPaise: 1000,
    currency: "INR",
    status: PaymentStatus.PENDING,
    fareBreakdown: {
      baseFarePaise: 400,
      distanceFarePaise: 300,
      timeFarePaise: 200,
      surgePaise: 100,
      platformCommissionPaise: 300,
      driverEarningPaise: 700,
      totalPaise: 1000,
    },
    idempotencyKey: "k".repeat(64),
    attemptNumber: 1,
    refundedAmountPaise: 0,
    refunds: [],
    ledgerTransactionId: undefined,
    lastFailedGatewayPaymentId: undefined,
    ...over,
  };
  payment.toObject = () => ({ ...payment, toObject: undefined });
  return payment;
}

export function capturedEntity(over: Record<string, unknown> = {}) {
  return {
    id: "pay_TEST1",
    entity: "payment",
    order_id: "order_TEST1",
    status: "captured",
    amount: 1000,
    currency: "INR",
    method: "upi",
    captured: true,
    created_at: 1_700_000_000,
    ...over,
  } as any;
}

/** In-memory stand-in for the parts of node-redis the module uses. */
export function makeFakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    client: {
      set: vi.fn(async (k: string, v: string, o?: { NX?: boolean }) => {
        if (o?.NX && store.has(k)) return null;
        store.set(k, v);
        return "OK";
      }),
      del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
      eval: vi.fn(async (_script: string, o: { keys: string[]; arguments: string[] }) => {
        const key = o.keys[0]!;
        if (store.get(key) === o.arguments[0]) {
          store.delete(key);
          return 1;
        }
        return 0;
      }),
    },
  };
}
