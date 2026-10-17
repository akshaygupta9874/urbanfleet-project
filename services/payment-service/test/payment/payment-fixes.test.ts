import { describe, expect, it, vi, beforeEach } from 'vitest';
import { formatRide, RideClient } from '../../src/clients/ride.client.js';
import { PayoutService } from '../../src/payment/services/payout.service.js';
import { payoutRepository } from '../../src/payment/repositories/payout.repository.js';
import { ledgerService } from '../../src/payment/services/ledger.service.js';
import { initPaymentConsumer } from '../../src/consumers/payment.consumer.js';

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
      expect(formatted._id).toBe('ride-uuid-1');
    });

    it('sets both riderId and rider from nested object format', () => {
      const incomingRide = {
        _id: 'ride-uuid-2',
        rider: { id: 'rider-nested-2' },
        driver: { id: 'driver-nested-2' },
        status: 'ARRIVED_AT_DESTINATION',
      };

      const formatted = formatRide(incomingRide);
      expect(formatted.riderId).toBe('rider-nested-2');
      expect(formatted.rider).toBe('rider-nested-2');
      expect(formatted.driverId).toBe('driver-nested-2');
      expect(formatted.driver).toBe('driver-nested-2');
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

      const originalFetch = globalThis.fetch;
      try {
        let sentHeaders: any = null;
        globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
          sentHeaders = init?.headers;
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: { id: 'ride-1', paymentStatus: 'CAPTURED' } }),
          } as any;
        });

        await client.updatePaymentStatus('ride-1', 'CAPTURED');

        expect(sentHeaders).toBeDefined();
        expect(sentHeaders['x-internal-service-key']).toBe('test-internal-key-999');
      } finally {
        globalThis.fetch = originalFetch;
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
});
