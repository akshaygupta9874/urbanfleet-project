import { describe, expect, it, vi, beforeEach } from 'vitest';
import { requestRideSchema, normalizeLocation, paymentStatusSchema } from '../src/validation/ride.validation.js';
import { OtpService } from '../src/services/otp.service.js';
import { FareService } from '../src/services/fare.service.js';
import { RideService, canCompleteRide } from '../src/services/ride.service.js';
import { AppError, ConflictError } from '@urbanfleet/common';
import { OutboxWorker } from '../src/workers/outbox.worker.js';
import { registerDispatcher } from '../src/websocket/handlers/dispatcher.js';
import { DriverEvents, RiderEvents } from '../src/websocket/event.constants.js';

describe('Ride Service Comprehensive Fixes Test Suite', () => {

  // ==========================================
  // 1. Coordinate Normalization
  // ==========================================
  describe('Coordinate Normalization & Schemas', () => {
    it('normalizes { lat, lng } correctly', () => {
      const loc = normalizeLocation({ lat: 12.9716, lng: 77.5946, address: 'Bangalore' });
      expect(loc).toEqual({ lat: 12.9716, lng: 77.5946, address: 'Bangalore' });
    });

    it('normalizes { latitude, longitude } to { lat, lng }', () => {
      const loc = normalizeLocation({ latitude: 12.9716, longitude: 77.5946, address: 'Bangalore' });
      expect(loc).toEqual({ lat: 12.9716, lng: 77.5946, address: 'Bangalore' });
    });

    it('validates requestRideSchema with either lat/lng or latitude/longitude and case-insensitive categories', () => {
      const payload1 = {
        pickup: { lat: 12.9716, lng: 77.5946 },
        destination: { latitude: 13.0827, longitude: 80.2707 },
        vehicleCategory: 'sedan',
      };
      const result1 = requestRideSchema.safeParse(payload1);
      expect(result1.success).toBe(true);

      const payloadInvalid = {
        pickup: { x: 1, y: 2 },
        destination: { latitude: 13.0827, longitude: 80.2707 },
      };
      const resultInvalid = requestRideSchema.safeParse(payloadInvalid);
      expect(resultInvalid.success).toBe(false);
    });

    it('validates paymentStatusSchema accepts valid statuses and rejects invalid ones', () => {
      expect(paymentStatusSchema.safeParse({ paymentStatus: 'CAPTURED' }).success).toBe(true);
      expect(paymentStatusSchema.safeParse({ paymentStatus: 'FAILED' }).success).toBe(true);
      expect(paymentStatusSchema.safeParse({ paymentStatus: 'PENDING' }).success).toBe(true);
      expect(paymentStatusSchema.safeParse({ paymentStatus: 'REFUNDED' }).success).toBe(true);
      expect(paymentStatusSchema.safeParse({ paymentStatus: 'UNAUTHORIZED_STATUS' }).success).toBe(false);
    });
  });

  // ==========================================
  // 2. Cryptographic OTP Generation & Verification
  // ==========================================
  describe('OtpService (Crypto Random & Timing-Safe)', () => {
    const otpService = new OtpService();

    it('generates a 4-digit numeric OTP in range 1000-9999', () => {
      for (let i = 0; i < 50; i++) {
        const otp = otpService.generateRideOtp();
        expect(otp).toMatch(/^\d{4}$/);
        const num = parseInt(otp, 10);
        expect(num).toBeGreaterThanOrEqual(1000);
        expect(num).toBeLessThanOrEqual(9999);
      }
    });

    it('verifies correct OTP and rejects mismatched or empty OTPs', () => {
      const otp = '4829';
      expect(otpService.verifyRideOtp('4829', otp)).toBe(true);
      expect(otpService.verifyRideOtp('1234', otp)).toBe(false);
      expect(otpService.verifyRideOtp('', otp)).toBe(false);
      expect(otpService.verifyRideOtp('482', otp)).toBe(false);
      expect(otpService.verifyRideOtp(null as any, otp)).toBe(false);
    });
  });

  // ==========================================
  // 3. Pricing, Vehicle Multipliers, Dynamic Surge & Cancellation Fee
  // ==========================================
  describe('FareService Enhancements', () => {
    const fareService = new FareService();

    it('applies vehicle multipliers consistently', () => {
      const bikeFare = fareService.calculateFareForDistance(10, 'bike');
      const autoFare = fareService.calculateFareForDistance(10, 'auto');
      const sedanFare = fareService.calculateFareForDistance(10, 'sedan');

      expect(bikeFare.totalPaise).toBeLessThan(autoFare.totalPaise);
      expect(autoFare.totalPaise).toBeLessThan(sedanFare.totalPaise);
    });

    it('computes dynamic surge within 1.0 - 3.0 range', () => {
      expect(fareService.calculateDynamicSurge(1.0)).toBe(1.0);
      expect(fareService.calculateDynamicSurge(2.5)).toBe(2.5);
      expect(fareService.calculateDynamicSurge(5.0)).toBe(3.0);
      expect(fareService.calculateDynamicSurge(0.5)).toBe(1.0);
    });

    it('computes cancellation fee based on elapsed minutes and initiator', () => {
      // Under 2 mins -> ₹0 fee
      expect(fareService.calculateCancellationFee(1)).toBe(0);
      expect(fareService.calculateCancellationFee(1.9)).toBe(0);

      // Over 2 mins -> ₹50 (5000 paise)
      expect(fareService.calculateCancellationFee(2.1)).toBe(5000);
      expect(fareService.calculateCancellationFee(10)).toBe(5000);
    });
  });

  // ==========================================
  // 4. Lifecycle State Machine, Ownership & OTP Redaction
  // ==========================================
  describe('RideService Lifecycle State Machine & Access Control', () => {
    let mockRideRepo: any;
    let mockRatingRepo: any;
    let mockOutboxRepo: any;
    let mockFareService: any;
    let mockOtpService: any;
    let mockTx: any;
    let rideService: RideService;

    const baseRide = {
      id: 'ride-test-1',
      riderId: 'rider-abc',
      driverId: 'driver-xyz',
      status: 'ACCEPTED',
      otp: '7890',
      paymentStatus: 'PENDING',
      cancellationReason: null,
      cancelledBy: null,
      cancellationFeePaise: 0,
      createdAt: new Date(Date.now() - 300000), // 5 mins ago
      acceptedAt: new Date(Date.now() - 250000), // ~4 mins ago
      pickupLat: 12.97,
      pickupLng: 77.59,
      destinationLat: 13.08,
      destinationLng: 80.27,
      rideSequence: 1,
      totalFarePaise: 45000,
      baseFarePaise: 5000,
      surgeMultiplier: 1.0,
      distanceKm: 5,
      durationMinutes: 15,
    };

    beforeEach(() => {
      mockTx = {
        ride: {
          findUnique: vi.fn().mockImplementation(async () => ({ ...baseRide })),
          findFirst: vi.fn().mockResolvedValue(null),
          update: vi.fn().mockImplementation(async ({ data }: any) => ({ ...baseRide, ...data })),
        },
      };

      mockRideRepo = {
        create: vi.fn(),
        findById: vi.fn().mockImplementation(async () => ({ ...baseRide })),
        update: vi.fn().mockImplementation(async (id: string, data: any) => ({ ...baseRide, ...data, id })),
        findActiveRideForDriver: vi.fn().mockResolvedValue(null),
        findActiveRideForRider: vi.fn().mockResolvedValue(null),
        executeTransaction: vi.fn().mockImplementation(async (cb: any) => cb(mockTx)),
      };

      mockRatingRepo = {
        findByRideAndFrom: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'rating-1' }),
      };

      mockOutboxRepo = {
        stageEvent: vi.fn().mockResolvedValue(undefined),
      };

      mockFareService = new FareService();
      mockOtpService = new OtpService();

      rideService = new RideService(
        mockRideRepo,
        mockRatingRepo,
        mockOutboxRepo,
        mockFareService,
        mockOtpService
      );
    });

    it('redacts OTP on getRideById for assigned driver prior to completion, allows rider and admin to view OTP', async () => {
      mockRideRepo.findById.mockResolvedValue({ ...baseRide, status: 'ACCEPTED', otp: '7890' });

      // 1. Rider can see OTP
      const riderView: any = await rideService.getRideById('ride-test-1', 'rider-abc', 'RIDER');
      expect(riderView.otp).toBe('7890');

      // 2. Assigned driver cannot see OTP while ride is active
      const driverView: any = await rideService.getRideById('ride-test-1', 'driver-xyz', 'DRIVER');
      expect(driverView.otp).toBeNull();

      // 3. Assigned driver CAN see OTP once completed
      mockRideRepo.findById.mockResolvedValue({ ...baseRide, status: 'COMPLETED', otp: '7890' });
      const completedDriverView: any = await rideService.getRideById('ride-test-1', 'driver-xyz', 'DRIVER');
      expect(completedDriverView.otp).toBe('7890');

      // 4. Admin can always see OTP
      mockRideRepo.findById.mockResolvedValue({ ...baseRide, status: 'ACCEPTED', otp: '7890' });
      const adminView: any = await rideService.getRideById('ride-test-1', 'admin-1', 'ADMIN');
      expect(adminView.otp).toBe('7890');

      // 5. Unrelated third-party is Forbidden (403)
      await expect(
        rideService.getRideById('ride-test-1', 'stranger-bob', 'RIDER')
      ).rejects.toThrow(AppError);
    });

    it('driverArrived enforces driver ownership and current status ACCEPTED', async () => {
      mockTx.ride.findUnique.mockResolvedValue({ ...baseRide, status: 'ACCEPTED', driverId: 'driver-xyz' });

      // Wrong driver cannot mark arrived
      await expect(
        rideService.driverArrived('ride-test-1', 'other-driver')
      ).rejects.toThrow(AppError);

      // Wrong status cannot mark arrived
      mockTx.ride.findUnique.mockResolvedValue({ ...baseRide, status: 'IN_PROGRESS', driverId: 'driver-xyz' });
      await expect(
        rideService.driverArrived('ride-test-1', 'driver-xyz')
      ).rejects.toThrow(ConflictError);

      // Success marks ARRIVED and stages RIDE_DRIVER_ARRIVED outbox event
      mockTx.ride.findUnique.mockResolvedValue({ ...baseRide, status: 'ACCEPTED', driverId: 'driver-xyz' });
      const arrived = await rideService.driverArrived('ride-test-1', 'driver-xyz');
      expect(arrived.status).toBe('ARRIVED');
      expect(mockOutboxRepo.stageEvent).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({
          eventType: 'RIDE_DRIVER_ARRIVED',
          aggregateId: 'ride-test-1',
        })
      );
    });

    it('startRide enforces driver ownership, ARRIVED status, and valid OTP verification', async () => {
      mockTx.ride.findUnique.mockResolvedValue({ ...baseRide, status: 'ARRIVED', driverId: 'driver-xyz', otp: '1234' });

      // Wrong driver
      await expect(
        rideService.startRide('ride-test-1', 'other-driver', '1234')
      ).rejects.toThrow(AppError);

      // Invalid OTP
      await expect(
        rideService.startRide('ride-test-1', 'driver-xyz', '9999')
      ).rejects.toThrow(AppError);

      // Invalid status (e.g. still SEARCHING)
      mockTx.ride.findUnique.mockResolvedValue({ ...baseRide, status: 'SEARCHING', driverId: 'driver-xyz', otp: '1234' });
      await expect(
        rideService.startRide('ride-test-1', 'driver-xyz', '1234')
      ).rejects.toThrow(ConflictError);

      // Valid OTP & ARRIVED status starts the ride
      mockTx.ride.findUnique.mockResolvedValue({ ...baseRide, status: 'ARRIVED', driverId: 'driver-xyz', otp: '1234' });
      const started = await rideService.startRide('ride-test-1', 'driver-xyz', '1234');
      expect(started.status).toBe('IN_PROGRESS');
      expect(mockOutboxRepo.stageEvent).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({
          eventType: 'RIDE_STARTED',
        })
      );
    });

    it('arriveAtDestination transitions ride from IN_PROGRESS to ARRIVED_AT_DESTINATION', async () => {
      mockTx.ride.findUnique.mockResolvedValue({ ...baseRide, status: 'IN_PROGRESS', driverId: 'driver-xyz' });

      const atDest = await rideService.arriveAtDestination({ rideId: 'ride-test-1', driverId: 'driver-xyz' });
      expect(atDest.status).toBe('ARRIVED_AT_DESTINATION');
      expect(mockOutboxRepo.stageEvent).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({
          eventType: 'RIDE_ARRIVED_AT_DESTINATION',
        })
      );
    });

    it('canCompleteRide helper verifies completion readiness', () => {
      expect(canCompleteRide({ status: 'ARRIVED_AT_DESTINATION', paymentStatus: 'CAPTURED' })).toBe(true);
      expect(canCompleteRide({ status: 'ARRIVED_AT_DESTINATION', paymentStatus: 'PAID' })).toBe(true);
      expect(canCompleteRide({ status: 'ARRIVED_AT_DESTINATION', paymentStatus: 'PENDING' })).toBe(false);
      expect(canCompleteRide({ status: 'IN_PROGRESS', paymentStatus: 'CAPTURED' })).toBe(false);
    });

    it('cancelRide calculates cancellation fee for rider after grace period, zero fee for driver', async () => {
      // Rider cancels after 4 minutes -> cancellation fee applies
      mockTx.ride.findUnique.mockResolvedValue({
        ...baseRide,
        status: 'ACCEPTED',
        acceptedAt: new Date(Date.now() - 250000), // ~4 mins ago
      });

      const riderCancel: any = await rideService.cancelRide('ride-test-1', 'rider-abc', 'Change of plans');
      expect(riderCancel.status).toBe('CANCELLED');
      expect(riderCancel.cancelledBy).toBe('RIDER');
      expect(riderCancel.cancellationFeePaise).toBe(5000); // ₹50

      // Driver cancels -> ₹0 fee
      mockTx.ride.findUnique.mockResolvedValue({
        ...baseRide,
        status: 'ACCEPTED',
        acceptedAt: new Date(Date.now() - 250000),
      });
      const driverCancel: any = await rideService.cancelRide('ride-test-1', 'driver-xyz', 'Vehicle puncture');
      expect(driverCancel.status).toBe('CANCELLED');
      expect(driverCancel.cancelledBy).toBe('DRIVER');
      expect(driverCancel.cancellationFeePaise).toBe(0);

      // Cannot cancel ride once COMPLETED
      mockTx.ride.findUnique.mockResolvedValue({ ...baseRide, status: 'COMPLETED' });
      await expect(
        rideService.cancelRide('ride-test-1', 'rider-abc', 'Cancel after complete')
      ).rejects.toThrow(ConflictError);
    });

    it('acceptRide prevents driver from accepting multiple active rides concurrently', async () => {
      mockRideRepo.findById.mockResolvedValue({ ...baseRide, status: 'SEARCHING', driverId: null });
      mockRideRepo.findActiveRideForDriver.mockResolvedValue({ id: 'existing-active-ride', status: 'IN_PROGRESS' });

      await expect(
        rideService.acceptRide('ride-test-1', 'driver-xyz')
      ).rejects.toThrow(ConflictError);
    });

    it('submitRating prevents unauthorized users and prevents duplicate ratings', async () => {
      mockRideRepo.findById.mockResolvedValue({
        ...baseRide,
        status: 'COMPLETED',
        riderId: 'rider-abc',
        driverId: 'driver-xyz',
      });

      // Stranger cannot rate
      await expect(
        rideService.submitRating('ride-test-1', 'stranger-1', 5, 'Great!')
      ).rejects.toThrow(AppError);

      // Duplicate rating
      mockRatingRepo.findByRideAndFrom.mockResolvedValue({ id: 'existing-rating', score: 5 });
      await expect(
        rideService.submitRating('ride-test-1', 'rider-abc', 5, 'Great again!')
      ).rejects.toThrow(ConflictError);
    });
  });

  // ==========================================
  // 5. Outbox Worker: KafkaEnvelope & 5-Retry Limit
  // ==========================================
  describe('OutboxWorker Enveloping & Retries', () => {
    it('wraps payloads into standardized KafkaEnvelope and handles 5-retry limit with FAILED status', async () => {
      const mockExecuteRaw = vi.fn().mockResolvedValue(1);
      const mockPrisma: any = {
        $queryRaw: vi.fn().mockResolvedValue([
          {
            id: 'failed-msg-id',
            topic: 'ride.events',
            partition_key: 'ride-999',
            event_type: 'RIDE_COMPLETED',
            aggregate_type: 'RIDE',
            aggregate_id: 'ride-999',
            aggregate_sequence: 5,
            payload: { rideId: 'ride-999', farePaise: 45000 },
            created_at: new Date('2026-10-18T00:00:00Z'),
            retry_count: 4, // 5th attempt
          },
        ]),
        $executeRaw: mockExecuteRaw,
      };

      const mockProducer: any = {
        send: vi.fn().mockRejectedValue(new Error('Broker unreachable')),
      };

      const worker = new OutboxWorker(mockPrisma);
      (worker as any).producer = mockProducer;

      await worker.processPendingEvents();

      expect(mockProducer.send).toHaveBeenCalledWith({
        topic: 'ride.events',
        messages: [
          {
            key: 'ride-999',
            value: JSON.stringify({
              id: 'failed-msg-id',
              version: 1,
              eventType: 'RIDE_COMPLETED',
              producer: 'ride-service',
              timestamp: '2026-10-18T00:00:00.000Z',
              partitionKey: 'ride-999',
              aggregateType: 'RIDE',
              aggregateId: 'ride-999',
              aggregateSequence: 5,
              payload: { rideId: 'ride-999', farePaise: 45000 },
            }),
          },
        ],
      });

      expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
      const [, status, retryCount, lastError, eventId] = mockExecuteRaw.mock.calls[0];
      expect(status).toBe('FAILED');
      expect(retryCount).toBe(5);
      expect(lastError).toBe('Broker unreachable');
      expect(eventId).toBe('failed-msg-id');
    });

    it('publishes message and marks PUBLISHED when producer succeeds', async () => {
      const mockExecuteRaw = vi.fn().mockResolvedValue(1);
      const mockPrisma: any = {
        $queryRaw: vi.fn().mockResolvedValue([
          {
            id: 'success-msg-id',
            topic: 'ride.events',
            partition_key: 'ride-123',
            event_type: 'RIDE_STARTED',
            aggregate_type: 'RIDE',
            aggregate_id: 'ride-123',
            aggregate_sequence: 2,
            payload: { rideId: 'ride-123' },
            created_at: new Date('2026-10-18T00:00:00Z'),
            retry_count: 0,
          },
        ]),
        $executeRaw: mockExecuteRaw,
      };

      let sentPayload: any = null;
      const mockProducer: any = {
        send: vi.fn().mockImplementation(async ({ messages }) => {
          sentPayload = JSON.parse(messages[0].value);
        }),
      };

      const worker = new OutboxWorker(mockPrisma);
      (worker as any).producer = mockProducer;

      await worker.processPendingEvents();

      expect(mockProducer.send).toHaveBeenCalledTimes(1);
      expect(sentPayload).toEqual({
        id: 'success-msg-id',
        version: 1,
        eventType: 'RIDE_STARTED',
        producer: 'ride-service',
        timestamp: '2026-10-18T00:00:00.000Z',
        partitionKey: 'ride-123',
        aggregateType: 'RIDE',
        aggregateId: 'ride-123',
        aggregateSequence: 2,
        payload: { rideId: 'ride-123' },
      });
      expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================
  // 6. WebSocket Role Authorization in Dispatcher
  // ==========================================
  describe('WebSocket Dispatcher Role Authorization', () => {
    function createMockSocket(user: any) {
      const listeners: Record<string, Function[]> = {};
      const sentMessages: string[] = [];

      return {
        user,
        readyState: 1,
        OPEN: 1,
        CLOSED: 3,
        sentMessages,
        send: vi.fn((data: string) => sentMessages.push(data)),
        on: vi.fn((event: string, handler: Function) => {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(handler);
        }),
        emit: (event: string, ...args: any[]) => {
          const handlers = listeners[event] || [];
          for (const fn of handlers) fn(...args);
        },
      };
    }

    it('forbids DRIVER from executing RiderEvents', () => {
      const socket = createMockSocket({ id: 'driver-1', role: 'DRIVER', driverId: 'driver-1' });
      registerDispatcher(socket as any);

      // Driver attempting rider event
      socket.emit('message', JSON.stringify({
        event: RiderEvents.REQUEST_RIDE,
        data: { pickup: { lat: 10, lng: 10 } }
      }));

      expect(socket.send).toHaveBeenCalled();
      const response = JSON.parse(socket.sentMessages[0]);
      expect(response.event).toBe('server:error');
      expect(response.data.code).toBe('FORBIDDEN');
      expect(response.data.message).toMatch(/rider role required/i);
    });

    it('forbids RIDER from executing DriverEvents', () => {
      const socket = createMockSocket({ id: 'rider-1', role: 'RIDER' });
      registerDispatcher(socket as any);

      // Rider attempting driver event
      socket.emit('message', JSON.stringify({
        event: DriverEvents.SET_AVAILABLE,
        data: { available: true }
      }));

      expect(socket.send).toHaveBeenCalled();
      const response = JSON.parse(socket.sentMessages[0]);
      expect(response.event).toBe('server:error');
      expect(response.data.code).toBe('FORBIDDEN');
      expect(response.data.message).toMatch(/driver role required/i);
    });
  });
});
