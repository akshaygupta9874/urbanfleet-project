import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

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
        if (o?.NX && store.has(k)) return null;

        store.set(k, v);
        return "OK";
      },

      del: async (k: string) =>
        store.delete(k) ? 1 : 0,

      eval: async (
        _s: string,
        o: {
          keys: string[];
          arguments: string[];
        }
      ) => {
        if (store.get(o.keys[0]!) === o.arguments[0]) {
          store.delete(o.keys[0]!);
          return 1;
        }

        return 0;
      },
    },
  };
});

/**
 * --------------------------------------------------------------------------
 * Mocks
 * --------------------------------------------------------------------------
 */

vi.mock("../../src/redis/client.js", () => ({
  redisClient: redis.client,
}));

vi.mock("../../src/sockets/emitters/driver.emitter.js", () => ({
  emitPaymentCaptured: vi.fn(),
}));

vi.mock("../../src/sockets/emitters/rider.emitter.js", () => ({
  emitPaymentCaptured: vi.fn(),
}));

/**
 * --------------------------------------------------------------------------
 * Imports
 * --------------------------------------------------------------------------
 */

import * as driverEmitter from "../../src/sockets/emitters/driver.emitter.js";
import * as riderEmitter from "../../src/sockets/emitters/rider.emitter.js";

import { paymentService } from "../../src/payment/services/payment.service.js";
import { paymentRepository } from "../../src/payment/repositories/payment.repository.js";
import { ledgerService } from "../../src/payment/services/ledger.service.js";
import { razorpayClient } from "../../src/config/razorpay.config.js";

import { prisma } from "../../src/db/client.js";
import {
  RidePaymentStatus,
  RideStatus,
} from "@prisma/client";

import { NonRetryablePaymentError } from "../../src/payment/errors/payment.errors.js";
import { PaymentStatus } from "../../src/payment/types/payment.types.js";

import {
  CAPTURABLE_FROM_STATUSES,
  MAX_PAYMENT_ATTEMPTS,
} from "../../src/payment/constants/payment.constants.js";

import {
  capturedEntity,
  fakeSession,
  makePayment,
  oid,
  retryingSession,
} from "../helpers/helpers.js";

/**
 * --------------------------------------------------------------------------
 * Typed mocked emitters
 * --------------------------------------------------------------------------
 */

const emitDriver = vi.mocked(driverEmitter.emitPaymentCaptured);
const emitRider = vi.mocked(riderEmitter.emitPaymentCaptured);

let currentRide: any = null;

/**
 * --------------------------------------------------------------------------
 * Test setup
 * --------------------------------------------------------------------------
 */

beforeEach(() => {
  redis.store.clear();
  currentRide = null;

  emitDriver.mockClear();
  emitRider.mockClear();

  vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(prisma));
  vi.spyOn(prisma.ride, "findUnique").mockImplementation(async () => currentRide);
  vi.spyOn(prisma, "$queryRawUnsafe").mockImplementation(async () => currentRide ? [currentRide] : []);
  vi.spyOn(paymentRepository, "findByRide").mockResolvedValue([]);
});

/**
 * --------------------------------------------------------------------------
 * capture
 * --------------------------------------------------------------------------
 */

describe("handlePaymentCaptured", () => {
  function arrange(opts: {
    claims: (any | null)[];
    session?: any;
    ride?: any;
  }) {
    const payment = makePayment({
      status: PaymentStatus.PENDING,
    });

    const order: string[] = [];
    let call = 0;

    vi.spyOn(
      paymentRepository,
      "findByGatewayOrderId"
    ).mockResolvedValue(payment);

    const claim = vi
      .spyOn(paymentRepository, "transitionStatus")
      .mockImplementation(async () => {
        order.push("claim");

        const v =
          opts.claims[
          Math.min(call++, opts.claims.length - 1)
          ];

        return v === "same" ? payment : v;
      });

    const ledger = vi
      .spyOn(ledgerService, "recordPaymentCapture")
      .mockImplementation(async () => {
        order.push("ledger");

        return "tx";
      });

    const ride =
      opts.ride === undefined
        ? {
          id: payment.ride.toString(),
          _id: payment.ride,
          driverId: payment.driver.toString(),
          driver: payment.driver,
          riderId: payment.rider.toString(),
          rider: payment.rider,
        }
        : opts.ride;

    vi.spyOn(prisma.ride, "findUnique").mockResolvedValue(ride as any);

    vi.spyOn(prisma.ride, "update").mockImplementation(
      (async () => {
        order.push("ride");

        return ride;
      }) as any
    );

    return {
      payment,
      order,
      claim,
      ledger,
    };
  }

  it(
    "claims the capture FIRST, then posts the ledger, then updates the ride",
    async () => {
      const { order, claim } = arrange({
        claims: ["same"],
      });

      await paymentService.handlePaymentCaptured(
        capturedEntity()
      );

      expect(order).toEqual([
        "claim",
        "ledger",
        "ride",
      ]);

      const [, from, update] =
        claim.mock.calls[0]!;

      expect(from).toEqual(
        CAPTURABLE_FROM_STATUSES
      );

      expect(update).toMatchObject({
        status: PaymentStatus.CAPTURED,
        gatewayPaymentId: "pay_TEST1",
      });

      expect(emitDriver).toHaveBeenCalledTimes(1);
      expect(emitRider).toHaveBeenCalledTimes(1);
    }
  );

  it(
    "FIXED: losing the race writes NOTHING (no ledger rows, no ride update, no notification)",
    async () => {
      const { order, ledger } = arrange({
        claims: [null],
      });

      await paymentService.handlePaymentCaptured(
        capturedEntity()
      );

      expect(order).toEqual(["claim"]);

      expect(ledger).not.toHaveBeenCalled();

      expect(emitDriver).not.toHaveBeenCalled();
    }
  );

  it(
    "FIXED: a transaction retried by the driver cannot post the ledger twice",
    async () => {
      const { ledger } = arrange({
        claims: ["same", null],
        session: retryingSession(2),
      });

      await paymentService.handlePaymentCaptured(
        capturedEntity()
      );

      expect(ledger).toHaveBeenCalledTimes(1);
    }
  );

  it(
    "FIXED: a payment marked FAILED (earlier attempt) still accepts the successful capture",
    async () => {
      const payment = makePayment({
        status: PaymentStatus.FAILED,
      });

      vi.spyOn(
        paymentRepository,
        "findByGatewayOrderId"
      ).mockResolvedValue(payment);

      const claim = vi
        .spyOn(paymentRepository, "transitionStatus")
        .mockResolvedValue(payment);

      vi.spyOn(
        ledgerService,
        "recordPaymentCapture"
      ).mockResolvedValue("tx");

      vi.spyOn(prisma.ride, "findUnique").mockResolvedValue({
        id: payment.ride.toString(),
        _id: payment.ride,
        driverId: payment.driver.toString(),
        driver: payment.driver,
        riderId: payment.rider.toString(),
        rider: payment.rider,
      } as any);

      vi.spyOn(prisma.ride, "update").mockResolvedValue({
        id: payment.ride.toString(),
        driverId: payment.driver.toString(),
        riderId: payment.rider.toString(),
        paymentStatus: RidePaymentStatus.CAPTURED,
      } as any);

      await expect(
        paymentService.handlePaymentCaptured(
          capturedEntity()
        )
      ).resolves.toBeUndefined();

      expect(claim).toHaveBeenCalled();
    }
  );

  it(
    "ride missing -> throws so the whole transaction (including the claim) is rolled back",
    async () => {
      arrange({
        claims: ["same"],
        ride: null,
      });

      await expect(
        paymentService.handlePaymentCaptured(
          capturedEntity()
        )
      ).rejects.toMatchObject({
        statusCode: 404,
      });

      expect(emitDriver).not.toHaveBeenCalled();
    }
  );

  it(
    "already recorded (CAPTURED / REFUNDED ...) -> silent no-op",
    async () => {
      for (const status of [
        PaymentStatus.CAPTURED,
        PaymentStatus.PARTIALLY_REFUNDED,
        PaymentStatus.REFUNDED,
      ]) {
        vi.spyOn(
          paymentRepository,
          "findByGatewayOrderId"
        ).mockResolvedValue(
          makePayment({ status })
        );

        const start = vi.spyOn(
          paymentRepository,
          "transitionStatus"
        );

        await paymentService.handlePaymentCaptured(
          capturedEntity()
        );

        expect(start).not.toHaveBeenCalled();
      }
    }
  );

  it(
    "unknown order / amount mismatch / currency mismatch / malformed payload are NON-retryable",
    async () => {
      vi.spyOn(
        paymentRepository,
        "findByGatewayOrderId"
      ).mockResolvedValueOnce(null);

      await expect(
        paymentService.handlePaymentCaptured(
          capturedEntity()
        )
      ).rejects.toBeInstanceOf(
        NonRetryablePaymentError
      );

      vi.spyOn(
        paymentRepository,
        "findByGatewayOrderId"
      ).mockResolvedValue(
        makePayment()
      );

      await expect(
        paymentService.handlePaymentCaptured(
          capturedEntity({ amount: 999 })
        )
      ).rejects.toMatchObject({
        statusCode: 409,
      });

      await expect(
        paymentService.handlePaymentCaptured(
          capturedEntity({ amount: 999 })
        )
      ).rejects.toBeInstanceOf(
        NonRetryablePaymentError
      );

      await expect(
        paymentService.handlePaymentCaptured(
          capturedEntity({ currency: "USD" })
        )
      ).rejects.toBeInstanceOf(
        NonRetryablePaymentError
      );

      await expect(
        paymentService.handlePaymentCaptured(
          capturedEntity({ order_id: "" })
        )
      ).rejects.toBeInstanceOf(
        NonRetryablePaymentError
      );
    }
  );

  it(
    "a socket failure after commit does not fail the capture",
    async () => {
      arrange({
        claims: ["same"],
      });

      emitDriver.mockImplementationOnce(() => {
        throw new Error("socket down");
      });

      await expect(
        paymentService.handlePaymentCaptured(
          capturedEntity()
        )
      ).resolves.toBeUndefined();
    }
  );
});

/**
 * --------------------------------------------------------------------------
 * failed / authorized
 * --------------------------------------------------------------------------
 */

describe(
  "handlePaymentFailed / handlePaymentAuthorized",
  () => {
    const failedEntity = (over = {}) =>
      capturedEntity({
        id: "pay_F1",
        status: "failed",
        captured: false,
        error_code: "BAD_REQUEST_ERROR",
        error_description: "Card declined",
        ...over,
      });

    it(
      "records the failed attempt and flips the ride only if it is still PENDING",
      async () => {
        const payment = makePayment({
          status: PaymentStatus.PENDING,
        });

        vi.spyOn(
          paymentRepository,
          "findByGatewayOrderId"
        ).mockResolvedValue(payment);

        const record = vi
          .spyOn(
            paymentRepository,
            "recordFailedAttempt"
          )
          .mockResolvedValue({
            ...payment,
            attemptNumber: 2,
          } as any);

        const rideUpdate = vi
          .spyOn(prisma.ride, "updateMany")
          .mockResolvedValue({ count: 1 } as any);

        await paymentService.handlePaymentFailed(
          failedEntity()
        );

        expect(record).toHaveBeenCalledWith(
          payment._id.toString(),
          "pay_F1",
          expect.arrayContaining([
            PaymentStatus.FAILED,
          ]),
          {
            failureReason: "Card declined",
            failureCode: "BAD_REQUEST_ERROR",
          },
          expect.anything()
        );

        expect(rideUpdate).toHaveBeenCalledWith({
          where: {
            id: payment.ride.toString(),
            paymentStatus: RidePaymentStatus.PENDING,
          },
          data: {
            paymentStatus: RidePaymentStatus.FAILED,
          },
        });
      }
    );

    it(
      "is idempotent per gateway payment id and ignores paid payments",
      async () => {
        const record = vi.spyOn(
          paymentRepository,
          "recordFailedAttempt"
        );

        vi.spyOn(
          paymentRepository,
          "findByGatewayOrderId"
        ).mockResolvedValue(
          makePayment({
            lastFailedGatewayPaymentId:
              "pay_F1",
          })
        );

        await paymentService.handlePaymentFailed(
          failedEntity()
        );

        vi.spyOn(
          paymentRepository,
          "findByGatewayOrderId"
        ).mockResolvedValue(
          makePayment({
            status: PaymentStatus.CAPTURED,
          })
        );

        await paymentService.handlePaymentFailed(
          failedEntity()
        );

        vi.spyOn(
          paymentRepository,
          "findByGatewayOrderId"
        ).mockResolvedValue(null);

        await paymentService.handlePaymentFailed(
          failedEntity()
        );

        expect(record).not.toHaveBeenCalled();
      }
    );

    it(
      "does not touch the ride when the CAS lost (captured meanwhile)",
      async () => {
        vi.spyOn(
          paymentRepository,
          "findByGatewayOrderId"
        ).mockResolvedValue(
          makePayment()
        );

        vi.spyOn(
          paymentRepository,
          "recordFailedAttempt"
        ).mockResolvedValue(null);

        const rideUpdate = vi.spyOn(
          prisma.ride,
          "updateMany"
        );

        await paymentService.handlePaymentFailed(
          failedEntity()
        );

        expect(
          rideUpdate
        ).not.toHaveBeenCalled();
      }
    );

    it(
      "authorized only moves CREATED / PENDING forward",
      async () => {
        vi.spyOn(
          paymentRepository,
          "findByGatewayOrderId"
        ).mockResolvedValue(
          makePayment()
        );

        const t = vi
          .spyOn(
            paymentRepository,
            "transitionStatus"
          )
          .mockResolvedValue(null);

        await paymentService.handlePaymentAuthorized(
          capturedEntity({
            status: "authorized",
          })
        );

        expect(
          t.mock.calls[0]![1]
        ).toEqual([
          PaymentStatus.CREATED,
          PaymentStatus.PENDING,
        ]);
      }
    );
  }
);

/**
 * --------------------------------------------------------------------------
 * createOrder
 * --------------------------------------------------------------------------
 */

describe("createOrder", () => {
  const fare = {
    baseFarePaise: 400,
    distanceFarePaise: 300,
    timeFarePaise: 200,
    surgePaise: 100,
    platformCommissionPaise: 300,
    driverEarningPaise: 700,
    totalPaise: 1000,
  };

  const makeRide = (over: any = {}) => {
    const id = (over._id ?? oid()).toString();
    const riderId = (over.rider ?? oid()).toString();
    const driverId = (over.driver ?? oid()).toString();
    const effectiveBreakdown = {
      ...fare,
      ...(over.fare?.breakdown ?? over.fareBreakdown ?? {}),
    };
    const ride: any = {
      id,
      _id: id,
      riderId,
      rider: riderId,
      driverId,
      driver: driverId,
      status: RideStatus.ARRIVED_AT_DESTINATION,
      paymentStatus: RidePaymentStatus.PENDING,
      fare: {
        breakdown: effectiveBreakdown,
      },
      fareBreakdown: effectiveBreakdown,
      estimatedFarePaise: effectiveBreakdown.totalPaise ?? 1000,
      ...over,
    };
    ride.fareBreakdown = effectiveBreakdown;
    ride.fare = { breakdown: effectiveBreakdown };
    currentRide = ride;
    return ride;
  };

  const input = (
    ride: any,
    rider = ride.rider
  ) => ({
    ride: ride._id,
    rider,
    idempotencyKey:
      "key-" + "x".repeat(20),
  });

  it(
    "checks ownership BEFORE revealing whether the ride is payable",
    async () => {
      const ride = makeRide({
        status: RideStatus.COMPLETED,
      });

      vi.spyOn(
        prisma.ride,
        "findUnique"
      ).mockResolvedValue(
        ride as any
      );

      await expect(
        paymentService.createOrder(
          input(ride, oid())
        )
      ).rejects.toMatchObject({
        statusCode: 403,
      });
    }
  );

  it(
    "rejects rides that are not ready for payment",
    async () => {
      const ride = makeRide({
        status: RideStatus.DRIVER_ASSIGNED,
      });

      vi.spyOn(
        prisma.ride,
        "findUnique"
      ).mockResolvedValue(
        ride as any
      );

      await expect(
        paymentService.createOrder(
          input(ride)
        )
      ).rejects.toMatchObject({
        statusCode: 400,
      });

      const paid = makeRide({
        paymentStatus:
          RidePaymentStatus.CAPTURED,
      });

      vi.spyOn(
        prisma.ride,
        "findUnique"
      ).mockResolvedValue(
        paid as any
      );

      await expect(
        paymentService.createOrder(
          input(paid)
        )
      ).rejects.toMatchObject({
        statusCode: 400,
      });
    }
  );

  it(
    "creates the Razorpay order from the SERVER-side fare and releases the lock",
    async () => {
      const ride = makeRide();

      vi.spyOn(
        prisma.ride,
        "findUnique"
      ).mockResolvedValue(
        ride as any
      );

      vi.spyOn(
        paymentRepository,
        "findByIdempotencyKey"
      ).mockResolvedValue(null);

      const create = vi
        .spyOn(
          razorpayClient.orders,
          "create"
        )
        .mockResolvedValue({
          id: "order_NEW",
        } as any);

      const save = vi
        .spyOn(
          paymentRepository,
          "create"
        )
        .mockImplementation(
          async (d: any) =>
            makePayment({
              ...d,
            })
        );
      const setGatewayOrderId = vi
        .spyOn(paymentRepository, "setGatewayOrderId")
        .mockImplementation(async (_paymentId, gatewayOrderId) =>
          makePayment({ gatewayOrderId })
        );

      const result =
        await paymentService.createOrder(
          input(ride)
        );

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 1000,
          currency: "INR",
          receipt:
            ride._id.toString(),
          payment_capture: true,
        })
      );

      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          status:
            PaymentStatus.CREATED,
          amountPaise: 1000,
          metadata: expect.objectContaining({ orderCreationPending: true }),
          attemptNumber: 1,
        }),
        expect.anything()
      );
      expect(setGatewayOrderId).toHaveBeenCalledWith(
        expect.any(String),
        "order_NEW"
      );

      expect(result).toMatchObject({
        gatewayOrderId:
          "order_NEW",
        amountPaise: 1000,
        currency: "INR",
        razorpayKeyId:
          "rzp_test_key",
      });

      expect(redis.store.size).toBe(0);
    }
  );

  it("does not create a second gateway order after an uncertain provider response", async () => {
    const ride = makeRide();
    const pendingReservation = makePayment({
      gatewayOrderId: undefined,
      status: PaymentStatus.CREATED,
      ride: ride._id,
    });

    vi.spyOn(prisma.ride, "findUnique").mockResolvedValue(ride as any);
    vi.spyOn(paymentRepository, "findByIdempotencyKey")
      .mockResolvedValueOnce(null)
      .mockResolvedValue(pendingReservation);
    vi.spyOn(paymentRepository, "create").mockResolvedValue(pendingReservation);
    vi.spyOn(razorpayClient.orders, "create").mockRejectedValue(
      new Error("network timeout")
    );

    await expect(
      paymentService.createOrder(input(ride))
    ).rejects.toMatchObject({
      statusCode: 502,
      code: "PAYMENT_ORDER_CREATION_UNCERTAIN",
    });

    await expect(
      paymentService.createOrder(input(ride))
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "PAYMENT_ORDER_CREATION_UNCERTAIN",
    });
    expect(razorpayClient.orders.create).toHaveBeenCalledTimes(1);
  });

  it(
    "returns the existing order (no lock, no gateway call) on a repeated request",
    async () => {
      const ride = makeRide();

      vi.spyOn(
        prisma.ride,
        "findUnique"
      ).mockResolvedValue(
        ride as any
      );

      vi.spyOn(
        paymentRepository,
        "findByIdempotencyKey"
      ).mockResolvedValue(
        makePayment({
          status:
            PaymentStatus.PENDING,
        })
      );

      const create = vi.spyOn(
        razorpayClient.orders,
        "create"
      );

      const result =
        await paymentService.createOrder(
          input(ride)
        );

      expect(
        result.gatewayOrderId
      ).toBe("order_TEST1");

      expect(
        create
      ).not.toHaveBeenCalled();
    }
  );

  it(
    "FIXED: after a failed attempt the SAME order is re-opened (FAILED -> CREATED, ride -> PENDING)",
    async () => {
      const ride = makeRide({
        paymentStatus:
          RidePaymentStatus.FAILED,
      });

      const failed = makePayment({
        status: PaymentStatus.FAILED,
        attemptNumber: 2,
        ride: ride._id,
      });

      vi.spyOn(
        prisma.ride,
        "findUnique"
      ).mockResolvedValue(
        ride as any
      );

      vi.spyOn(
        paymentRepository,
        "findByIdempotencyKey"
      ).mockResolvedValue(
        failed
      );

      const t = vi
        .spyOn(
          paymentRepository,
          "transitionStatus"
        )
        .mockResolvedValue({
          ...failed,
          status:
            PaymentStatus.CREATED,
        } as any);

      const rideUpdate = vi
        .spyOn(prisma.ride, "updateMany")
        .mockResolvedValue(
          { count: 1 } as any
        );

      const create = vi.spyOn(
        razorpayClient.orders,
        "create"
      );

      const result =
        await paymentService.createOrder(
          input(ride)
        );

      expect(t).toHaveBeenCalledWith(
        failed._id.toString(),
        PaymentStatus.FAILED,
        {
          status:
            PaymentStatus.CREATED,
        }
      );

      expect(
        rideUpdate
      ).toHaveBeenCalledWith({
        where: {
          id: failed.ride.toString(),
          paymentStatus: RidePaymentStatus.FAILED,
        },
        data: {
          paymentStatus: RidePaymentStatus.PENDING,
        },
      });

      expect(result.status).toBe(
        PaymentStatus.CREATED
      );

      expect(
        result.gatewayOrderId
      ).toBe("order_TEST1");

      expect(
        create
      ).not.toHaveBeenCalled();
    }
  );

  it(
    "stops re-opening after too many failed attempts",
    async () => {
      const ride = makeRide({
        paymentStatus:
          RidePaymentStatus.FAILED,
      });

      vi.spyOn(
        prisma.ride,
        "findUnique"
      ).mockResolvedValue(
        ride as any
      );

      vi.spyOn(
        paymentRepository,
        "findByIdempotencyKey"
      ).mockResolvedValue(
        makePayment({
          status:
            PaymentStatus.FAILED,
          attemptNumber:
            MAX_PAYMENT_ATTEMPTS + 1,
        })
      );

      await expect(
        paymentService.createOrder(
          input(ride)
        )
      ).rejects.toMatchObject({
        statusCode: 409,
      });
    }
  );

  it(
    "refuses to resume an order whose amount no longer matches the ride's fare",
    async () => {
      const ride = makeRide();

      vi.spyOn(
        prisma.ride,
        "findUnique"
      ).mockResolvedValue(
        ride as any
      );

      vi.spyOn(
        paymentRepository,
        "findByIdempotencyKey"
      ).mockResolvedValue(
        makePayment({
          amountPaise: 900,
        })
      );

      await expect(
        paymentService.createOrder(
          input(ride)
        )
      ).rejects.toMatchObject({
        statusCode: 409,
      });
    }
  );

  it(
    "answers 409 when the locked ride is no longer payable, without calling the gateway",
    async () => {
      const ride = makeRide();

      vi.spyOn(
        prisma.ride,
        "findUnique"
      ).mockResolvedValue(
        ride as any
      );

      vi.spyOn(
        paymentRepository,
        "findByIdempotencyKey"
      ).mockResolvedValue(null);

      vi.spyOn(prisma, "$queryRawUnsafe").mockResolvedValue([
        { ...ride, paymentStatus: RidePaymentStatus.CAPTURED },
      ] as any);

      const create = vi.spyOn(
        razorpayClient.orders,
        "create"
      );

      await expect(
        paymentService.createOrder(
          input(ride)
        )
      ).rejects.toMatchObject({
        statusCode: 409,
        message:
          expect.stringMatching(
            /already processed/i
          ),
      });

      expect(
        create
      ).not.toHaveBeenCalled();
    }
  );

  it(
    "FIXED: losing the unique-index race returns the winner instead of a 500",
    async () => {
      const ride = makeRide();

      const winner = makePayment({
        status:
          PaymentStatus.CREATED,
      });

      vi.spyOn(
        prisma.ride,
        "findUnique"
      ).mockResolvedValue(
        ride as any
      );

      vi.spyOn(
        paymentRepository,
        "findByIdempotencyKey"
      )
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValue(
          winner
        );

      vi.spyOn(
        razorpayClient.orders,
        "create"
      ).mockResolvedValue({
        id: "order_LOSER",
      } as any);

      vi.spyOn(
        paymentRepository,
        "create"
      ).mockRejectedValue(
        Object.assign(
          new Error("dup"),
          {
            code: 11000,
          }
        )
      );
      vi.spyOn(paymentRepository, "findByRide")
        .mockResolvedValueOnce([])
        .mockResolvedValue([winner]);

      const result =
        await paymentService.createOrder(
          input(ride)
        );

      expect(
        result.gatewayOrderId
      ).toBe("order_TEST1");
    }
  );

  it.each([
    [
      "fractional paise",
      {
        baseFarePaise: 400.5,
        totalPaise: 1000.5,
      },
    ],
    [
      "components that do not add up",
      {
        baseFarePaise: 399,
      },
    ],
    [
      "driver+platform split that does not add up",
      {
        driverEarningPaise: 600,
      },
    ],
    [
      "amount below the minimum",
      {
        baseFarePaise: 0,
        distanceFarePaise: 0,
        timeFarePaise: 0,
        surgePaise: 50,
        platformCommissionPaise: 10,
        driverEarningPaise: 40,
        totalPaise: 50,
      },
    ],
    [
      "negative component",
      {
        surgePaise: -100,
        baseFarePaise: 600,
      },
    ],
  ])(
    "rejects an invalid fare: %s",
    async (_name, patch) => {
      const ride = makeRide({
        fare: {
          breakdown: {
            ...fare,
            ...patch,
          },
        },
      });

      vi.spyOn(
        prisma.ride,
        "findUnique"
      ).mockResolvedValue(
        ride as any
      );

      vi.spyOn(
        paymentRepository,
        "findByIdempotencyKey"
      ).mockResolvedValue(null);

      const create = vi.spyOn(
        razorpayClient.orders,
        "create"
      );

      await expect(
        paymentService.createOrder(
          input(ride)
        )
      ).rejects.toMatchObject({
        statusCode: 422,
      });

      expect(
        create
      ).not.toHaveBeenCalled();
    }
  );
});

/**
 * --------------------------------------------------------------------------
 * verify
 * --------------------------------------------------------------------------
 */

describe(
  "verifyCheckoutSignature",
  () => {
    const sign = (order: string, pay: string) =>
      createHmac(
        "sha256",
        process.env.RAZORPAY_KEY_SECRET ?? "sample"
      )
        .update(`${order}|${pay}`)
        .digest("hex");
    const base = {
      gatewayOrderId:
        "order_TEST1",
      gatewayPaymentId:
        "pay_TEST1",
    };

    it(
      "rejects a bad signature before touching the database",
      async () => {
        const find = vi.spyOn(
          paymentRepository,
          "findByGatewayOrderId"
        );

        await expect(
          paymentService.verifyCheckoutSignature(
            {
              ...base,
              signature:
                "ab".repeat(32),
            }
          )
        ).rejects.toMatchObject({
          statusCode: 400,
        });

        await expect(
          paymentService.verifyCheckoutSignature(
            {
              ...base,
              signature: "zz",
            }
          )
        ).rejects.toMatchObject({
          statusCode: 400,
        });

        expect(
          find
        ).not.toHaveBeenCalled();
      }
    );

    it(
      "FIXED: only the rider who owns the payment may verify it",
      async () => {
        vi.spyOn(
          paymentRepository,
          "findByGatewayOrderId"
        ).mockResolvedValue(
          makePayment()
        );

        await expect(
          paymentService.verifyCheckoutSignature(
            {
              ...base,
              signature: sign(
                "order_TEST1",
                "pay_TEST1"
              ),
              requesterId: oid(),
            }
          )
        ).rejects.toMatchObject({
          statusCode: 403,
        });
      }
    );

    it(
      "captured at the gateway -> records the capture immediately and answers CAPTURED",
      async () => {
        const payment =
          makePayment({
            status:
              PaymentStatus.CREATED,
          });

        vi.spyOn(
          paymentRepository,
          "findByGatewayOrderId"
        ).mockResolvedValue(
          payment
        );

        vi.spyOn(
          paymentRepository,
          "transitionStatus"
        ).mockResolvedValue({
          ...payment,
          status:
            PaymentStatus.PENDING,
        } as any);

        vi.spyOn(
          razorpayClient.payments,
          "fetch"
        ).mockResolvedValue(
          capturedEntity() as any
        );

        const captured = vi
          .spyOn(
            paymentService,
            "handlePaymentCaptured"
          )
          .mockResolvedValue();

        const status =
          await paymentService.verifyCheckoutSignature(
            {
              ...base,
              signature: sign(
                "order_TEST1",
                "pay_TEST1"
              ),
              requesterId:
                payment.rider,
            }
          );

        expect(status).toBe(
          PaymentStatus.CAPTURED
        );

        expect(
          captured
        ).toHaveBeenCalledTimes(1);
      }
    );

    it(
      "re-opens a FAILED payment to PENDING when the rider verifies a retry on the same order",
      async () => {
        const payment =
          makePayment({
            status:
              PaymentStatus.FAILED,
          });

        vi.spyOn(
          paymentRepository,
          "findByGatewayOrderId"
        ).mockResolvedValue(
          payment
        );

        const t = vi
          .spyOn(
            paymentRepository,
            "transitionStatus"
          )
          .mockResolvedValue({
            ...payment,
            status:
              PaymentStatus.PENDING,
          } as any);

        vi.spyOn(
          razorpayClient.payments,
          "fetch"
        ).mockResolvedValue(
          capturedEntity({
            status:
              "authorized",
            captured: false,
          }) as any
        );

        const status =
          await paymentService.verifyCheckoutSignature(
            {
              ...base,
              signature: sign(
                "order_TEST1",
                "pay_TEST1"
              ),
            }
          );

        expect(
          t.mock.calls[0]![1]
        ).toEqual([
          PaymentStatus.CREATED,
          PaymentStatus.FAILED,
        ]);

        expect(status).toBe(
          PaymentStatus.PENDING
        );
      }
    );

    it(
      "a paid payment is returned as-is; a gateway read error does not fail a valid signature",
      async () => {
        vi.spyOn(
          paymentRepository,
          "findByGatewayOrderId"
        ).mockResolvedValue(
          makePayment({
            status:
              PaymentStatus.CAPTURED,
          })
        );

        const fetch = vi.spyOn(
          razorpayClient.payments,
          "fetch"
        );

        expect(
          await paymentService.verifyCheckoutSignature(
            {
              ...base,
              signature: sign(
                "order_TEST1",
                "pay_TEST1"
              ),
            }
          )
        ).toBe(
          PaymentStatus.CAPTURED
        );

        expect(
          fetch
        ).not.toHaveBeenCalled();

        const pending =
          makePayment({
            status:
              PaymentStatus.CREATED,
          });

        vi.spyOn(
          paymentRepository,
          "findByGatewayOrderId"
        ).mockResolvedValue(
          pending
        );

        vi.spyOn(
          paymentRepository,
          "transitionStatus"
        ).mockResolvedValue({
          ...pending,
          status:
            PaymentStatus.PENDING,
        } as any);

        fetch.mockRejectedValue(
          new TypeError("network")
        );

        expect(
          await paymentService.verifyCheckoutSignature(
            {
              ...base,
              signature: sign(
                "order_TEST1",
                "pay_TEST1"
              ),
            }
          )
        ).toBe(
          PaymentStatus.PENDING
        );
      }
    );

    it(
      "refuses a payment id that belongs to a different order",
      async () => {
        const pending =
          makePayment({
            status:
              PaymentStatus.CREATED,
          });

        vi.spyOn(
          paymentRepository,
          "findByGatewayOrderId"
        ).mockResolvedValue(
          pending
        );

        vi.spyOn(
          paymentRepository,
          "transitionStatus"
        ).mockResolvedValue(
          pending
        );

        vi.spyOn(
          razorpayClient.payments,
          "fetch"
        ).mockResolvedValue(
          capturedEntity({
            order_id:
              "order_OTHER",
          }) as any
        );

        await expect(
          paymentService.verifyCheckoutSignature(
            {
              ...base,
              signature: sign(
                "order_TEST1",
                "pay_TEST1"
              ),
            }
          )
        ).rejects.toMatchObject({
          statusCode: 409,
        });
      }
    );
  }
);