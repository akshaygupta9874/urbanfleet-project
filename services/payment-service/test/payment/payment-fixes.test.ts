import { describe, expect, it, vi, beforeEach } from 'vitest';
import { formatRide, RideClient, rideClient } from '../../src/clients/ride.client.js';
import { PayoutService } from '../../src/payment/services/payout.service.js';
import { payoutRepository } from '../../src/payment/repositories/payout.repository.js';
import { paymentRepository } from '../../src/payment/repositories/payment.repository.js';
import { ledgerService } from '../../src/payment/services/ledger.service.js';
import { initPaymentConsumer } from '../../src/consumers/payment.consumer.js';
import { authClient } from '../../src/clients/auth.client.js';
import { requireAdmin } from '../../src/payment/middlewares/require-admin.middleware.js';
import { prisma, UserRole } from '../../src/db/client.js';
import { redisClient } from '../../src/redis/client.js';

const { mockKafkaConsumer, getCapturedHandler } = vi.hoisted(() => {
  let capturedHandler: any = null;
  const consumer = {
    connect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockImplementation(async ({ eachMessage }: any) => {
      capturedHandler = eachMessage;
    }),
  };
  return {
    mockKafkaConsumer: consumer,
    getCapturedHandler: () => capturedHandler,
  };
});

vi.mock('kafkajs', () => ({
  Kafka: vi.fn().mockImplementation(() => ({
    consumer: () => mockKafkaConsumer,
  })),
}));

describe('Payment Service Comprehensive Fixes Test Suite', () => {

  // ==========================================
  // 1. Ride Client & Normalization
  // ==========================================
  describe('formatRide Dual Aliases & Resilient Properties', () => {
    it('sets both riderId and rider, driverId and driver from standard ride-service response', () => {
      const incomingRide = {
        id: 'ride-uuid-1',
        riderId: 'rider-uuid-1',
        driverId: 'driver-uuid-1',
        status: 'ARRIVED_AT_DESTINATION',
        paymentStatus: 'PENDING',
        totalFarePaise: 45000,
      };

      const formatted = formatRide(incomingRide);
      expect(formatted.riderId).toBe('rider-uuid-1');
      expect(formatted.rider).toBe('rider-uuid-1');
      expect(formatted.driverId).toBe('driver-uuid-1');
      expect(formatted.driver).toBe('driver-uuid-1');
      expect(formatted.id).toBe('ride-uuid-1');
    });

    it('sets both riderId and driverId', () => {
      const incomingRide = {
        id: 'ride-uuid-2',
        riderId: 'rider-nested-2',
        driverId: 'driver-nested-2',
        status: 'ARRIVED_AT_DESTINATION',
      };

      const formatted = formatRide(incomingRide);
      expect(formatted.riderId).toBe('rider-nested-2');
      expect(formatted.driverId).toBe('driver-nested-2');
    });

    it('handles null driver gracefully', () => {
      const incomingRide = {
        id: 'ride-uuid-3',
        riderId: 'rider-uuid-3',
        driverId: null,
      };

      const formatted = formatRide(incomingRide);
      expect(formatted.driverId).toBeNull();
      expect(formatted.driver).toBeNull();
    });
  });

  // ==========================================
  // 2. Inter-Service Communication & Headers
  // ==========================================
  describe('RideClient Inter-Service Communication', () => {
    it('transmits x-internal-service-key when INTERNAL_SERVICE_KEY is configured', async () => {
      process.env.INTERNAL_SERVICE_KEY = 'test-internal-key-999';
      const client = new RideClient('http://test-ride-service:4003');

      try {
        const patchSpy = vi.spyOn((client as unknown as { client: { patch: Function } }).client, 'patch').mockResolvedValue({
          status: 200,
          data: { success: true, data: { id: 'ride-1', paymentStatus: 'CAPTURED' } },
        });

        await client.updatePaymentStatus('ride-1', 'CAPTURED');

        expect(patchSpy).toHaveBeenCalled();
        const headers = (client as unknown as { client: { defaults: { headers: Record<string, string> } } }).client.defaults.headers;
        expect(headers['x-internal-service-key']).toBe('test-internal-key-999');
      } finally {
        delete process.env.INTERNAL_SERVICE_KEY;
      }
    });
  });

  // ==========================================
  // 3. Resilient Kafka Consumer Message Processing
  // ==========================================
  describe('Payment Consumer Resilient Unwrapping', () => {
    let mockPrisma: any;
    let mockPaymentService: any;
    let recordedEvents: any[];

    beforeEach(() => {
      recordedEvents = [];
      mockPrisma = {
        $transaction: vi.fn().mockImplementation(async (cb: any) => {
          const tx = {
            processedEvent: {
              findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
                const found = recordedEvents.find(e => e.eventId === where.eventId_consumerGroup.eventId);
                return found || null;
              }),
              create: vi.fn().mockImplementation(async ({ data }: any) => {
                recordedEvents.push(data);
                return data;
              }),
            },
            payment: {
              findUnique: vi.fn().mockResolvedValue(null),
              update: vi.fn().mockResolvedValue({}),
            },
          };
          return cb(tx);
        }),
      };

      mockPaymentService = {
        createOrder: vi.fn().mockResolvedValue({ id: 'order-1' }),
        issueRefund: vi.fn().mockResolvedValue({ id: 'refund-1' }),
      };
    });

    it('processes standard KafkaEnvelope without error', async () => {
      await initPaymentConsumer(mockPrisma, mockPaymentService);
      const messageHandler = getCapturedHandler();
      expect(messageHandler).toBeDefined();

      // Deliver standard envelope
      const envelope = {
        id: 'evt-uuid-1',
        version: 1,
        eventType: 'RIDE_COMPLETED',
        producer: 'ride-service',
        timestamp: '2026-10-18T00:00:00Z',
        partitionKey: 'ride-123',
        aggregateType: 'RIDE',
        aggregateId: 'ride-123',
        aggregateSequence: 1,
        payload: {
          rideId: 'ride-123',
          riderId: 'rider-456',
          totalFarePaise: 50000,
          driverId: 'driver-789',
        },
      };

      await messageHandler({
        message: {
          key: Buffer.from('ride-123'),
          value: Buffer.from(JSON.stringify(envelope)),
        },
      });

      expect(mockPaymentService.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          rideId: 'ride-123',
          riderId: 'rider-456',
        })
      );
      expect(recordedEvents).toHaveLength(1);
      expect(recordedEvents[0].eventId).toBe('evt-uuid-1');
    });

    it('processes raw unwrapped message payload without crashing or undefined eventId', async () => {
      await initPaymentConsumer(mockPrisma, mockPaymentService);
      const messageHandler = getCapturedHandler();
      expect(messageHandler).toBeDefined();

      // Deliver raw payload without envelope
      const rawPayload = {
        rideId: 'ride-raw-999',
        riderId: 'rider-raw-888',
        totalFarePaise: 30000,
        eventType: 'RIDE_COMPLETED',
        status: 'COMPLETED',
      };

      await messageHandler({
        message: {
          key: Buffer.from('ride-raw-999'),
          value: Buffer.from(JSON.stringify(rawPayload)),
        },
      });

      expect(mockPaymentService.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          rideId: 'ride-raw-999',
          riderId: 'rider-raw-888',
        })
      );
      expect(recordedEvents).toHaveLength(1);
      expect(recordedEvents[0].eventId).toBeDefined();
      expect(typeof recordedEvents[0].eventId).toBe('string');
    });

    it('RIDE_ARRIVED_AT_DESTINATION: creates payment order at arrival stage with dual aliases', async () => {
      await initPaymentConsumer(mockPrisma, mockPaymentService);
      const messageHandler = getCapturedHandler();
      expect(messageHandler).toBeDefined();

      const arrivedEnvelope = {
        id: 'evt-arrived-1',
        version: 1,
        eventType: 'RIDE_ARRIVED_AT_DESTINATION',
        producer: 'ride-service',
        timestamp: '2026-10-18T00:00:00Z',
        partitionKey: 'ride-arr-1',
        aggregateType: 'RIDE',
        aggregateId: 'ride-arr-1',
        aggregateSequence: 1,
        payload: {
          rideId: 'ride-arr-1',
          riderId: 'rider-arr-1',
          totalFarePaise: 42000,
          driverId: 'driver-arr-1',
        },
      };

      await messageHandler({
        message: {
          key: Buffer.from('ride-arr-1'),
          value: Buffer.from(JSON.stringify(arrivedEnvelope)),
        },
      });

      expect(mockPaymentService.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          rideId: 'ride-arr-1',
          riderId: 'rider-arr-1',
          idempotencyKey: 'ride-order-ride-arr-1',
        })
      );
    });

    it('RIDE_COMPLETED: acknowledges completion without creating duplicate order when payment exists', async () => {
      mockPrisma = {
        $transaction: vi.fn().mockImplementation(async (cb: any) => {
          const tx = {
            processedEvent: {
              findUnique: vi.fn().mockResolvedValue(null),
              create: vi.fn().mockResolvedValue({}),
            },
            payment: {
              findUnique: vi.fn().mockResolvedValue({
                id: 'pay-existing-99',
                rideId: 'ride-comp-99',
                status: 'CAPTURED',
              }),
              update: vi.fn().mockResolvedValue({}),
            },
          };
          return cb(tx);
        }),
      };

      await initPaymentConsumer(mockPrisma, mockPaymentService);
      const messageHandler = getCapturedHandler();

      const completedEnvelope = {
        id: 'evt-completed-99',
        version: 1,
        eventType: 'RIDE_COMPLETED',
        producer: 'ride-service',
        timestamp: '2026-10-18T00:00:00Z',
        partitionKey: 'ride-comp-99',
        aggregateType: 'RIDE',
        aggregateId: 'ride-comp-99',
        aggregateSequence: 2,
        payload: {
          rideId: 'ride-comp-99',
          riderId: 'rider-comp-99',
          totalFarePaise: 60000,
          driverId: 'driver-comp-99',
        },
      };

      await messageHandler({
        message: {
          key: Buffer.from('ride-comp-99'),
          value: Buffer.from(JSON.stringify(completedEnvelope)),
        },
      });

      // Should NOT have created a new order because payment already existed!
      expect(mockPaymentService.createOrder).not.toHaveBeenCalled();
    });

    it('RIDE_CANCELLED: deducts cancellation fee from captured payment and issues partial refund', async () => {
      mockPrisma = {
        $transaction: vi.fn().mockImplementation(async (cb: any) => {
          const tx = {
            processedEvent: {
              findUnique: vi.fn().mockResolvedValue(null),
              create: vi.fn().mockResolvedValue({}),
            },
            payment: {
              findUnique: vi.fn().mockResolvedValue({
                id: 'pay-captured-1',
                rideId: 'ride-cancel-1',
                amountPaise: 50000, // ₹500
                status: 'CAPTURED',
              }),
              update: vi.fn().mockResolvedValue({}),
            },
          };
          return cb(tx);
        }),
      };

      await initPaymentConsumer(mockPrisma, mockPaymentService);
      const messageHandler = getCapturedHandler();

      const cancelEnvelope = {
        id: 'evt-cancel-1',
        version: 1,
        eventType: 'RIDE_CANCELLED',
        aggregateType: 'RIDE',
        aggregateId: 'ride-cancel-1',
        aggregateSequence: 2,
        timestamp: new Date().toISOString(),
        payload: {
          rideId: 'ride-cancel-1',
          riderId: 'rider-1',
          cancelledBy: 'RIDER',
          cancellationFeePaise: 5000, // ₹50 fee
          cancelledAt: new Date().toISOString(),
        },
      };

      await messageHandler({
        message: {
          key: Buffer.from('ride-cancel-1'),
          value: Buffer.from(JSON.stringify(cancelEnvelope)),
        },
      });

      // Captured amount 50000 - 5000 fee = 45000 refund
      expect(mockPaymentService.issueRefund).toHaveBeenCalledWith(
        'pay-captured-1',
        45000,
        expect.stringContaining('fee deducted: 5000')
      );
    });

    it('RIDE_CANCELLED: bills cancellation fee when payment was not captured', async () => {
      mockPrisma = {
        $transaction: vi.fn().mockImplementation(async (cb: any) => {
          const tx = {
            processedEvent: {
              findUnique: vi.fn().mockResolvedValue(null),
              create: vi.fn().mockResolvedValue({}),
            },
            payment: {
              findUnique: vi.fn().mockResolvedValue({
                id: 'pay-pending-1',
                rideId: 'ride-cancel-2',
                status: 'PENDING',
              }),
              update: vi.fn().mockResolvedValue({}),
            },
          };
          return cb(tx);
        }),
      };

      await initPaymentConsumer(mockPrisma, mockPaymentService);
      const messageHandler = getCapturedHandler();

      const cancelEnvelope = {
        id: 'evt-cancel-2',
        version: 1,
        eventType: 'RIDE_CANCELLED',
        aggregateType: 'RIDE',
        aggregateId: 'ride-cancel-2',
        aggregateSequence: 2,
        timestamp: new Date().toISOString(),
        payload: {
          rideId: 'ride-cancel-2',
          riderId: 'rider-2',
          cancelledBy: 'RIDER',
          cancellationFeePaise: 5000,
          cancelledAt: new Date().toISOString(),
        },
      };

      await messageHandler({
        message: {
          key: Buffer.from('ride-cancel-2'),
          value: Buffer.from(JSON.stringify(cancelEnvelope)),
        },
      });

      expect(mockPaymentService.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          rideId: 'ride-cancel-2',
          riderId: 'rider-2',
          amountPaise: 5000,
          idempotencyKey: 'cancellation-fee-ride-cancel-2',
        })
      );
    });
  });

  // ==========================================
  // 4. Driver Payout Management & Queries
  // ==========================================
  describe('Driver Payout Management & Balance Calculation', () => {
    it('computes driver balance correctly from ledger credits and debits', async () => {
      vi.spyOn(ledgerService, 'getOwnerBalance').mockResolvedValue({
        totalCreditPaise: 100000, // ₹1,000 earned
        totalDebitPaise: 20000,   // ₹200 already paid out
        netCreditPaise: 80000,    // ₹800 balance
      });

      vi.spyOn(payoutRepository, 'sumAmountByDriver').mockResolvedValue(10000); // ₹100 pending/reserved

      const payoutService = new PayoutService();
      const balance = await payoutService.getDriverBalance('driver-test-1');

      expect(balance).toEqual({
        earnedPaise: 100000,
        debitedPaise: 20000,
        balancePaise: 80000,
        reservedPaise: 10000,
        availablePaise: 70000, // ₹700 available for new payout
      });
    });

    it('rejects invalid payout amounts <= 0 or non-integer', async () => {
      const payoutService = new PayoutService();

      await expect(
        payoutService.createPayout({
          driverId: 'drv-1',
          paymentId: 'pay-1',
          rideId: 'ride-1',
          amountPaise: 0,
        })
      ).rejects.toThrow(/Payout amount must be a positive integer/);

      await expect(
        payoutService.createPayout({
          driverId: 'drv-1',
          paymentId: 'pay-1',
          rideId: 'ride-1',
          amountPaise: -500,
        })
      ).rejects.toThrow(/Payout amount must be a positive integer/);
    });

    it('payoutRepository exports findByDriver and findPending query methods', () => {
      expect(typeof payoutRepository.findByDriver).toBe('function');
      expect(typeof payoutRepository.findPending).toBe('function');
    });
  });

  // ==========================================
  // 5. Payment Data Model Decoupling & Requester Resolution
  // ==========================================
  describe('Payment Data Model Decoupling & Isolation', () => {
    it('queryRideRaw calls rideClient and does not query payments database when unmocked', async () => {
      const getSpy = vi.spyOn(rideClient, 'getRideById').mockResolvedValue({
        id: 'ride-decoupled-1',
        riderId: 'rider-1',
        paymentStatus: 'PENDING',
      });

      const rows = await paymentRepository.queryRideRaw('ride-decoupled-1');
      expect(getSpy).toHaveBeenCalledWith('ride-decoupled-1');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe('ride-decoupled-1');

      getSpy.mockRestore();
    });

    it('findRideById and updateRide delegate to rideClient in runtime', async () => {
      const getSpy = vi.spyOn(rideClient, 'getRideById').mockResolvedValue({
        id: 'ride-decoupled-2',
        status: 'ARRIVED_AT_DESTINATION',
      });
      const updateSpy = vi.spyOn(rideClient, 'updatePaymentStatus').mockResolvedValue({
        id: 'ride-decoupled-2',
        paymentStatus: 'CAPTURED',
      });

      const ride = await paymentRepository.findRideById('ride-decoupled-2');
      expect(ride.id).toBe('ride-decoupled-2');
      expect(getSpy).toHaveBeenCalledWith('ride-decoupled-2');

      await paymentRepository.updateRide('ride-decoupled-2', { paymentStatus: 'CAPTURED' });
      expect(updateSpy).toHaveBeenCalledWith('ride-decoupled-2', 'CAPTURED');

      getSpy.mockRestore();
      updateSpy.mockRestore();
    });

    it('findUserById checks Redis cache first, then falls back to authClient', async () => {
      const redisSpy = vi.spyOn(redisClient, 'get').mockResolvedValue(
        JSON.stringify({ id: 'user-cached-1', roles: [UserRole.RIDER] })
      );

      const userFromCache = await paymentRepository.findUserById('user-cached-1');
      expect(userFromCache.id).toBe('user-cached-1');
      expect(userFromCache.roles).toContain(UserRole.RIDER);
      expect(redisSpy).toHaveBeenCalledWith('auth:user:user-cached-1');

      redisSpy.mockRestore();

      // Now test fallback to authClient when not cached
      vi.spyOn(redisClient, 'get').mockResolvedValue(null);
      const authSpy = vi.spyOn(authClient, 'getUserById').mockResolvedValue({
        id: 'user-auth-2',
        email: 'user2@example.com',
        firstName: 'User',
        lastName: 'Two',
        role: 'ADMIN',
        roles: ['ADMIN'],
        isEmailVerified: true,
      });

      const userFromAuth = await paymentRepository.findUserById('user-auth-2');
      expect(userFromAuth.id).toBe('user-auth-2');
      expect(userFromAuth.roles).toContain('ADMIN');
      expect(authSpy).toHaveBeenCalledWith('user-auth-2');

      authSpy.mockRestore();
    });

    it('requireAdmin reads roles from request context without querying database', async () => {
      const req: any = {
        userId: 'admin-1',
        role: ['ADMIN'],
        user: { userId: 'admin-1', roles: ['ADMIN'] },
      };
      const res: any = {};
      const next = vi.fn();

      await requireAdmin(req, res, next);
      expect(next).toHaveBeenCalledWith();

      // Rejects non-admin user
      const riderReq: any = {
        userId: 'rider-1',
        role: ['RIDER'],
        user: { userId: 'rider-1', roles: ['RIDER'] },
      };
      const riderNext = vi.fn();

      await requireAdmin(riderReq, res, riderNext);
      expect(riderNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          code: 'FORBIDDEN',
        })
      );
    });

    it('prisma.$transaction attaches ride and user delegates to transactional client', async () => {
      await prisma.$transaction(async (tx: any) => {
        expect(tx.ride).toBeDefined();
        expect(tx.user).toBeDefined();
        expect(typeof tx.ride.findUnique).toBe('function');
        expect(typeof tx.user.findUnique).toBe('function');
      });
    });
  });
});
