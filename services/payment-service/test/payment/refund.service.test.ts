import { describe, it, expect, vi, beforeEach } from "vitest";

// -----------------------------------------------------------------------------
// Fake Redis
// -----------------------------------------------------------------------------
//
// IMPORTANT:
// This test file lives at:
//   test/payment/refund.service.test.ts
//
// Therefore src/redis/client.js is:
//   ../../src/redis/client.js
//
// -----------------------------------------------------------------------------

const redis = vi.hoisted(() => {
  const store = new Map<string, string>();

  return {
    store,

    client: {
      set: async (
        k: string,
        v: string,
        o?: { NX?: boolean }
      ) => {
        if (o?.NX && store.has(k)) {
          return null;
        }

        store.set(k, v);
        return "OK";
      },

      del: async (k: string) => {
        return store.delete(k) ? 1 : 0;
      },

      eval: async (
        _script: string,
        o: {
          keys: string[];
          arguments: string[];
        }
      ) => {
        const key = o.keys[0];
        const token = o.arguments[0];

        if (!key || !token) {
          return 0;
        }

        if (store.get(key) === token) {
          store.delete(key);
          return 1;
        }

        return 0;
      },
    },
  };
});

// IMPORTANT: correct path from test/payment -> src
vi.mock("../../src/redis/client.js", () => ({
  redisClient: redis.client,
}));

// -----------------------------------------------------------------------------
// Imports
// -----------------------------------------------------------------------------

import { refundService } from "../../src/payment/services/refund.service.js";
import { paymentRepository } from "../../src/payment/repositories/payment.repository.js";
import { ledgerService } from "../../src/payment/services/ledger.service.js";
import { payoutService } from "../../src/payment/services/payout.service.js";
import { razorpayClient } from "../../src/config/razorpay.config.js";

import {
  PaymentStatus,
  RefundOrigin,
  RefundStatus,
} from "../../src/payment/types/payment.types.js";

import {
  fakeSession,
  makePayment,
  oid,
} from "../helpers/helpers.js";

// -----------------------------------------------------------------------------
// Test setup
// -----------------------------------------------------------------------------

beforeEach(() => {
  redis.store.clear();
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const record = (
  over: Record<string, unknown> = {}
) => ({
  _id: oid(),
  amountPaise: 250,
  status: RefundStatus.PENDING,
  origin: RefundOrigin.APP,
  reason: "r",
  driverReversalPaise: 175,
  platformReversalPaise: 75,
  createdAt: new Date(),
  ...over,
});

const capturedPayment = (
  over: Record<string, unknown> = {}
) =>
  makePayment({
    status: PaymentStatus.CAPTURED,
    gatewayPaymentId: "pay_TEST1",
    ledgerTransactionId: "tx-cap",
    ...over,
  });

// -----------------------------------------------------------------------------
// Arrange helper
// -----------------------------------------------------------------------------

/**
 * Wires up all collaborators of a successful booking.
 * Returns handles to assert on.
 */
function arrange(
  payment: any,
  opts: {
    gateway?: () => Promise<any>;
    clawback?: boolean;
  } = {}
) {
  const calls: string[] = [];

  let booked: any = null;

  vi.spyOn(
    payoutService,
    "handleRefundBooked"
  ).mockImplementation(async () => {
    calls.push("payout");

    return {
      clawbackRequired: !!opts.clawback,
    };
  });

  const book = vi
    .spyOn(paymentRepository, "bookRefund")
    .mockImplementation(
      (async (
        _id: string,
        _e: any,
        next: any,
        rec: any
      ) => {
        calls.push("book");

        booked = makePayment({
          ...payment,
          status: next.status,
          refundedAmountPaise:
            next.refundedAmountPaise,
          refunds: [
            ...payment.refunds,
            rec,
          ],
        });

        return booked;
      }) as any
    );

  const ledger = vi
    .spyOn(
      ledgerService,
      "recordRefundBooking"
    )
    .mockImplementation(async () => {
      calls.push("ledger");
      return "tx-book";
    });

  const gateway = vi
    .spyOn(
      razorpayClient.payments,
      "refund"
    )
    .mockImplementation(
      (
        opts.gateway ??
        (async () => ({
          id: "rfnd_1",
          status: "pending",
        }))
      ) as any
    );

  // The gateway mock itself is already a Vitest mock.
  // No need to spy on getMockImplementation().
  const original =
    gateway.getMockImplementation()!;

  gateway.mockImplementation(
    (async (...a: any[]) => {
      calls.push("gateway");

      return (original as any)(...a);
    }) as any
  );

  const attach = vi
    .spyOn(
      paymentRepository,
      "updateRefundRecord"
    )
    .mockResolvedValue(null);

  const failRefund = vi
    .spyOn(
      paymentRepository,
      "failRefund"
    )
    .mockImplementation(
      (async (
        _i: string,
        _r: string,
        _e: number,
        next: any
      ) =>
        makePayment({
          ...(booked ?? payment),
          status: next.status,
          refundedAmountPaise:
            next.refundedAmountPaise,
        })) as any
    );

  const compensation = vi
    .spyOn(
      ledgerService,
      "recordRefundCompensation"
    )
    .mockImplementation(async () => {
      calls.push("compensation");
      return "tx-undo";
    });

  vi.spyOn(
    paymentRepository,
    "findById"
  ).mockImplementation(
    async () =>
      (booked ?? payment) as any
  );

  return {
    calls,
    book,
    ledger,
    gateway,
    attach,
    failRefund,
    compensation,

    get booked() {
      return booked;
    },
  };
}

const input = (
  payment: any,
  over: Record<string, unknown> = {}
) => ({
  paymentId: payment._id,
  reason: "Rider was overcharged",
  initiatedBy: oid(),
  ...over,
});

// -----------------------------------------------------------------------------
// initiateRefund - happy path and ordering
// -----------------------------------------------------------------------------

describe(
  "initiateRefund - happy path and ordering",
  () => {
    it(
      "FIXED: books (payment CAS + ledger) BEFORE the gateway is called",
      async () => {
        const payment = capturedPayment();

        const h = arrange(payment);

        const result =
          await refundService.initiateRefund(
            input(payment, {
              amountPaise: 250,
            }) as any
          );

        expect(h.calls).toEqual([
          "payout",
          "book",
          "ledger",
          "gateway",
        ]);

        // proportional split:
        // driver 700/1000 of 250 = 175
        // platform 75
        expect(
          h.ledger.mock.calls[0]![0]
        ).toMatchObject({
          amountPaise: 250,

          split: {
            driverPaise: 175,
            platformPaise: 75,
          },
        });

        expect(
          h.book.mock.calls[0]![1]
        ).toEqual({
          status: PaymentStatus.CAPTURED,
          refundedAmountPaise: 0,
        });

        expect(
          h.book.mock.calls[0]![2]
        ).toEqual({
          status:
            PaymentStatus.PARTIALLY_REFUNDED,
          refundedAmountPaise: 250,
        });

        const refundId =
          h.book
            .mock
            .calls[0]![3]
            ._id.toString();

        expect(
          h.gateway
        ).toHaveBeenCalledWith(
          "pay_TEST1",
          expect.objectContaining({
            amount: 250,
            receipt: refundId,

            notes: expect.objectContaining({
              refundRecordId: refundId,
              paymentId:
                payment._id.toString(),
            }),
          })
        );

        expect(
          h.attach
        ).toHaveBeenCalledWith(
          payment._id.toString(),
          refundId,
          [RefundStatus.PENDING],
          {
            gatewayRefundId: "rfnd_1",
          }
        );

        expect(result).toMatchObject({
          refundId,
          gatewayRefundId: "rfnd_1",
          amountPaise: 250,
          refundStatus:
            RefundStatus.PENDING,
          paymentStatus:
            PaymentStatus.PARTIALLY_REFUNDED,
          refundedAmountPaise: 250,
        });

        // lock released
        expect(redis.store.size).toBe(0);
      }
    );

    it(
      "a refund the gateway already reports as processed is stored as PROCESSED",
      async () => {
        const payment =
          capturedPayment();

        const h = arrange(payment, {
          gateway: async () => ({
            id: "rfnd_2",
            status: "processed",
          }),
        });

        await refundService.initiateRefund(
          input(payment) as any
        );

        expect(
          h.attach.mock.calls[0]![3]
        ).toMatchObject({
          gatewayRefundId: "rfnd_2",
          status: RefundStatus.PROCESSED,
        });
      }
    );

    it(
      "no amount = refund everything that is left, and the payment becomes REFUNDED",
      async () => {
        const payment =
          capturedPayment();

        const h = arrange(payment);

        await refundService.initiateRefund(
          input(payment) as any
        );

        expect(
          h.book.mock.calls[0]![2]
        ).toEqual({
          status:
            PaymentStatus.REFUNDED,
          refundedAmountPaise: 1000,
        });

        expect(
          h.ledger.mock.calls[0]![0]
            .split
        ).toEqual({
          driverPaise: 700,
          platformPaise: 300,
        });
      }
    );

    it(
      "second partial refund: cumulative split still lands exactly on the original legs",
      async () => {
        const payment =
          capturedPayment({
            status:
              PaymentStatus.PARTIALLY_REFUNDED,

            refundedAmountPaise: 250,

            refunds: [
              record({
                status:
                  RefundStatus.PROCESSED,
              }),
            ],
          });

        const h = arrange(payment);

        await refundService.initiateRefund(
          input(payment, {
            amountPaise: 750,
          }) as any
        );

        // 250 already reversed (175/75);
        // remaining 750 must reverse:
        // driver 525
        // platform 225
        expect(
          h.ledger.mock.calls[0]![0]
            .split
        ).toEqual({
          driverPaise: 525,
          platformPaise: 225,
        });

        expect(
          h.book.mock.calls[0]![2].status
        ).toBe(
          PaymentStatus.REFUNDED
        );
      }
    );

    it(
      "records a clawback flag when the driver was already paid out",
      async () => {
        const payment =
          capturedPayment();

        const h = arrange(payment, {
          clawback: true,
        });

        await refundService.initiateRefund(
          input(payment, {
            amountPaise: 100,
          }) as any
        );

        expect(
          h.book.mock.calls[0]![3]
        ).toMatchObject({
          driverClawbackRequired: true,
        });
      }
    );
  }
);

// -----------------------------------------------------------------------------
// initiateRefund - failures
// -----------------------------------------------------------------------------

describe("initiateRefund - failures", () => {
  it(
    "FIXED: gateway 4xx => booking is undone (record FAILED, payment restored, ledger mirrored) and 502 is returned",
    async () => {
      const payment =
        capturedPayment();

      const h = arrange(payment, {
        gateway: async () => {
          throw {
            statusCode: 400,
            error: {
              description:
                "refund not allowed",
            },
          };
        },
      });

      await expect(
        refundService.initiateRefund(
          input(payment, {
            amountPaise: 250,
          }) as any
        )
      ).rejects.toMatchObject({
        statusCode: 502,
      });

      expect(h.calls).toEqual([
        "payout",
        "book",
        "ledger",
        "gateway",
        "compensation",
      ]);

      expect(
        h.failRefund
      ).toHaveBeenCalledTimes(1);

      const [
        ,
        ,
        expectedRefunded,
        next,
      ] = h.failRefund.mock.calls[0]!;

      expect(
        expectedRefunded
      ).toBe(250);

      expect(next).toEqual({
        status: PaymentStatus.CAPTURED,
        refundedAmountPaise: 0,
      });

      expect(
        h.compensation.mock.calls[0]![0]
      ).toMatchObject({
        amountPaise: 250,

        split: {
          driverPaise: 175,
          platformPaise: 75,
        },
      });

      expect(redis.store.size).toBe(0);
    }
  );

  it(
    "gateway returns a refund in failed state => also undone",
    async () => {
      const payment =
        capturedPayment();

      const h = arrange(payment, {
        gateway: async () => ({
          id: "rfnd_x",
          status: "failed",
        }),
      });

      await expect(
        refundService.initiateRefund(
          input(payment) as any
        )
      ).rejects.toMatchObject({
        statusCode: 502,
      });

      expect(
        h.compensation
      ).toHaveBeenCalledTimes(1);
    }
  );

  it(
    "FIXED: unknown outcome (timeout / 5xx) keeps the booking PENDING for reconciliation and does NOT double-refund",
    async () => {
      for (const err of [
        new TypeError(
          "socket hang up"
        ),
        {
          statusCode: 502,
          error: {},
        },
      ]) {
        const payment =
          capturedPayment();

        const h = arrange(payment, {
          gateway: async () => {
            throw err;
          },
        });

        const result =
          await refundService.initiateRefund(
            input(payment, {
              amountPaise: 250,
            }) as any
          );

        expect(
          result.refundStatus
        ).toBe(
          RefundStatus.PENDING
        );

        expect(
          result.gatewayRefundId
        ).toBeUndefined();

        expect(
          h.failRefund
        ).not.toHaveBeenCalled();

        expect(
          h.compensation
        ).not.toHaveBeenCalled();

        // Clear spies between iterations,
        // but don't restore the global mocks.
        vi.clearAllMocks();
        redis.store.clear();
      }
    }
  );

  it(
    "validation: status, missing gateway id, missing capture ledger, amounts",
    async () => {
      const cases: [
        any,
        any,
        number
      ][] = [
        [
          capturedPayment({
            status:
              PaymentStatus.PENDING,
          }),
          {},
          409,
        ],

        [
          capturedPayment({
            status:
              PaymentStatus.REFUNDED,
          }),
          {},
          409,
        ],

        [
          capturedPayment({
            gatewayPaymentId:
              undefined,
          }),
          {},
          409,
        ],

        [
          capturedPayment({
            ledgerTransactionId:
              undefined,
          }),
          {},
          500,
        ],

        [
          capturedPayment(),
          {
            amountPaise: 1001,
          },
          422,
        ],

        [
          capturedPayment(),
          {
            amountPaise: 0,
          },
          422,
        ],

        [
          capturedPayment(),
          {
            amountPaise: 10.5,
          },
          422,
        ],

        [
          capturedPayment({
            refundedAmountPaise: 900,

            status:
              PaymentStatus.PARTIALLY_REFUNDED,

            refunds: [
              record({
                amountPaise: 900,
                driverReversalPaise: 630,
                platformReversalPaise: 270,
              }),
            ],
          }),

          {
            amountPaise: 200,
          },

          422,
        ],
      ];

      for (const [
        payment,
        over,
        status,
      ] of cases) {
        const h = arrange(payment);

        await expect(
          refundService.initiateRefund(
            input(payment, over) as any
          )
        ).rejects.toMatchObject({
          statusCode: status,
        });

        expect(
          h.book
        ).not.toHaveBeenCalled();

        expect(
          h.gateway
        ).not.toHaveBeenCalled();

        // Do not restore the Redis mock.
        vi.clearAllMocks();
        redis.store.clear();
      }
    }
  );

  it(
    "a concurrent change of the payment (CAS lost) aborts before the gateway is called",
    async () => {
      const payment =
        capturedPayment();

      const h = arrange(payment);

      h.book.mockResolvedValue(
        null
      );

      await expect(
        refundService.initiateRefund(
          input(payment, {
            amountPaise: 250,
          }) as any
        )
      ).rejects.toMatchObject({
        statusCode: 409,
        message:
          expect.stringMatching(
            /changed/
          ),
      });

      expect(
        h.gateway
      ).not.toHaveBeenCalled();
    }
  );

  it(
    "only one refund at a time per payment (lock)",
    async () => {
      const payment =
        capturedPayment();

      const h = arrange(payment);

      redis.store.set(
        `lock:payment:refund:${payment._id}`,
        "other"
      );

      await expect(
        refundService.initiateRefund(
          input(payment) as any
        )
      ).rejects.toMatchObject({
        statusCode: 409,
      });

      expect(
        h.book
      ).not.toHaveBeenCalled();

      expect(
        redis.store.get(
          `lock:payment:refund:${payment._id}`
        )
      ).toBe("other");
    }
  );
});

// -----------------------------------------------------------------------------
// handleGatewayRefundEvent
// -----------------------------------------------------------------------------

describe(
  "handleGatewayRefundEvent (webhooks / reconciliation)",
  () => {
    const entity = (
      over: Record<string, unknown> = {}
    ) =>
      ({
        id: "rfnd_1",
        entity: "refund",
        payment_id: "pay_TEST1",
        amount: 250,
        status: "processed",
        notes: [],
        created_at: 1,
        ...over,
      }) as any;

    function locate(
      payment: any,
      by: "refund" | "payment" = "refund"
    ) {
      vi.spyOn(
        paymentRepository,
        "findByGatewayRefundId"
      ).mockResolvedValue(
        by === "refund"
          ? payment
          : null
      );

      vi.spyOn(
        paymentRepository,
        "findByRefundRecordId"
      ).mockResolvedValue(null);

      vi.spyOn(
        paymentRepository,
        "findByGatewayPaymentId"
      ).mockResolvedValue(
        by === "payment"
          ? payment
          : null
      );

      vi.spyOn(
        paymentRepository,
        "findById"
      ).mockResolvedValue(
        payment
      );
    }

    it(
      "refund.processed marks a PENDING refund PROCESSED (idempotent for repeated events)",
      async () => {
        const rec =
          record({
            gatewayRefundId:
              "rfnd_1",
          });

        const payment =
          capturedPayment({
            status:
              PaymentStatus.PARTIALLY_REFUNDED,

            refundedAmountPaise: 250,

            refunds: [rec],
          });

        locate(payment);

        const update =
          vi.spyOn(
            paymentRepository,
            "updateRefundRecord"
          ).mockResolvedValue(
            payment
          );

        await refundService.handleGatewayRefundEvent(
          "processed",
          entity()
        );

        expect(
          update
        ).toHaveBeenCalledWith(
          payment._id.toString(),
          rec._id.toString(),
          [
            RefundStatus.PENDING,
            RefundStatus.PROCESSED,
          ],
          expect.objectContaining({
            status:
              RefundStatus.PROCESSED,
          })
        );

        update.mockClear();

        rec.status =
          RefundStatus.PROCESSED;

        await refundService.handleGatewayRefundEvent(
          "processed",
          entity()
        );

        expect(
          update
        ).not.toHaveBeenCalled();

        expect(
          redis.store.size
        ).toBe(0);
      }
    );

    it(
      "refund.created attaches the gateway id to the record found through our receipt note",
      async () => {
        const rec =
          record({
            gatewayRefundId:
              undefined,
          });

        const payment =
          capturedPayment({
            refundedAmountPaise: 250,
            refunds: [rec],
          });

        vi.spyOn(
          paymentRepository,
          "findByGatewayRefundId"
        ).mockResolvedValue(null);

        vi.spyOn(
          paymentRepository,
          "findByRefundRecordId"
        ).mockResolvedValue(
          payment
        );

        vi.spyOn(
          paymentRepository,
          "findById"
        ).mockResolvedValue(
          payment
        );

        const update =
          vi.spyOn(
            paymentRepository,
            "updateRefundRecord"
          ).mockResolvedValue(
            payment
          );

        await refundService.handleGatewayRefundEvent(
          "created",
          entity({
            status: "pending",

            notes: {
              refundRecordId:
                rec._id.toString(),
            },
          })
        );

        expect(
          update.mock.calls[0]![3]
        ).toEqual({
          gatewayRefundId:
            "rfnd_1",
        });
      }
    );

    it(
      "FIXED: refund.failed undoes the booking (before: the ledger stayed reversed although no money left)",
      async () => {
        const rec =
          record({
            gatewayRefundId:
              "rfnd_1",
          });

        const payment =
          capturedPayment({
            status:
              PaymentStatus.PARTIALLY_REFUNDED,

            refundedAmountPaise: 250,

            refunds: [rec],
          });

        locate(payment);


        const fail =
          vi.spyOn(
            paymentRepository,
            "failRefund"
          ).mockResolvedValue(
            payment
          );

        const comp =
          vi.spyOn(
            ledgerService,
            "recordRefundCompensation"
          ).mockResolvedValue(
            "tx-undo"
          );

        await refundService.handleGatewayRefundEvent(
          "failed",
          entity({
            status: "failed",
          })
        );

        expect(
          fail.mock.calls[0]![3]
        ).toEqual({
          status:
            PaymentStatus.CAPTURED,
          refundedAmountPaise: 0,
        });

        expect(
          comp.mock.calls[0]![0]
        ).toMatchObject({
          amountPaise: 250,

          split: {
            driverPaise: 175,
            platformPaise: 75,
          },
        });

        // A second delivery finds the
        // record FAILED and does nothing.
        rec.status =
          RefundStatus.FAILED;

        fail.mockClear();
        comp.mockClear();

        await refundService.handleGatewayRefundEvent(
          "failed",
          entity({
            status: "failed",
          })
        );

        expect(
          fail
        ).not.toHaveBeenCalled();

        expect(
          comp
        ).not.toHaveBeenCalled();
      }
    );

    it(
      "a refund created in the Razorpay dashboard is discovered and booked (origin GATEWAY)",
      async () => {
        const payment =
          capturedPayment();

        locate(
          payment,
          "payment"
        );

        const h = arrange(payment);

        await refundService.handleGatewayRefundEvent(
          "processed",
          entity({
            amount: 400,
          })
        );

        expect(
          h.book
        ).toHaveBeenCalledTimes(1);

        expect(
          h.book.mock.calls[0]![3]
        ).toMatchObject({
          origin:
            RefundOrigin.GATEWAY,

          gatewayRefundId:
            "rfnd_1",

          status:
            RefundStatus.PROCESSED,

          amountPaise: 400,
        });

        // Never refunds a second time.
        expect(
          h.gateway
        ).not.toHaveBeenCalled();
      }
    );

    it(
      "a dashboard refund that cannot be booked is reported, not booked",
      async () => {
        const payment =
          capturedPayment();

        locate(
          payment,
          "payment"
        );

        const h = arrange(payment);

        await refundService.handleGatewayRefundEvent(
          "created",
          entity({
            amount: 5000,
          })
        );

        // Never booked -> nothing to undo.
        await refundService.handleGatewayRefundEvent(
          "failed",
          entity()
        );

        expect(
          h.book
        ).not.toHaveBeenCalled();

        expect(
          h.compensation
        ).not.toHaveBeenCalled();
      }
    );

    it(
      "unknown payment -> ignored; busy lock -> retryable error",
      async () => {
        vi.spyOn(
          paymentRepository,
          "findByGatewayRefundId"
        ).mockResolvedValue(null);

        vi.spyOn(
          paymentRepository,
          "findByRefundRecordId"
        ).mockResolvedValue(null);

        vi.spyOn(
          paymentRepository,
          "findByGatewayPaymentId"
        ).mockResolvedValue(null);

        await expect(
          refundService.handleGatewayRefundEvent(
            "processed",
            entity()
          )
        ).resolves.toBeUndefined();

        const payment =
          capturedPayment();

        locate(payment);

        redis.store.set(
          `lock:payment:refund:${payment._id}`,
          "other"
        );

        await expect(
          refundService.handleGatewayRefundEvent(
            "processed",
            entity()
          )
        ).rejects.toMatchObject({
          statusCode: 409,
        });
      }
    );

    it(
      "abandonUnsentRefund only touches PENDING refunds the gateway never acknowledged",
      async () => {
        const unsent =
          record({
            gatewayRefundId:
              undefined,
          });

        const sent =
          record({
            gatewayRefundId:
              "rfnd_9",
          });

        const payment =
          capturedPayment({
            status:
              PaymentStatus.PARTIALLY_REFUNDED,

            refundedAmountPaise: 500,

            refunds: [
              unsent,
              sent,
            ],
          });

        vi.spyOn(
          paymentRepository,
          "findById"
        ).mockResolvedValue(
          payment
        );


        const fail =
          vi.spyOn(
            paymentRepository,
            "failRefund"
          ).mockResolvedValue(
            payment
          );

        vi.spyOn(
          ledgerService,
          "recordRefundCompensation"
        ).mockResolvedValue(
          "tx"
        );

        expect(
          await refundService.abandonUnsentRefund(
            payment._id.toString(),
            sent._id.toString(),
            "x"
          )
        ).toBe(false);

        expect(
          fail
        ).not.toHaveBeenCalled();

        expect(
          await refundService.abandonUnsentRefund(
            payment._id.toString(),
            unsent._id.toString(),
            "never reached gateway"
          )
        ).toBe(true);

        expect(
          fail
        ).toHaveBeenCalledTimes(1);
      }
    );
  }
);