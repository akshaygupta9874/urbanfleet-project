import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { DispatchService } from '../src/services/dispatch.service.js';
import { GeoService } from '../src/services/geo.service.js';
import { socketRegistry } from '../src/websocket/registry/socket.registry.js';
import { ServerEvents } from '../src/websocket/event.constants.js';
import { AuthenticatedSocket } from '../src/websocket/types/index.js';
import { Ride } from '../src/db/client.js';

function createMockSocket(user: { userId: string; role: string[]; driverId?: string }): AuthenticatedSocket {
  const sentMessages: string[] = [];
  return {
    user,
    readyState: 1, // OPEN
    OPEN: 1,
    CLOSED: 3,
    sentMessages,
    send: vi.fn((data: string) => sentMessages.push(data)),
    close: vi.fn(),
    on: vi.fn(),
  } as unknown as AuthenticatedSocket;
}

describe('Enterprise Wave-Based Dispatching Suite (Uber-style)', () => {
  let geoService: GeoService;
  let dispatchService: DispatchService;
  const mockDrivers: string[] = [
    'driver-1', 'driver-2', 'driver-3', 'driver-4', 'driver-5',
    'driver-6', 'driver-7', 'driver-8', 'driver-9', 'driver-10',
    'driver-11', 'driver-12'
  ];

  const mockRide: Ride = {
    id: 'ride-wave-101',
    riderId: 'rider-abc',
    driverId: null,
    vehicleCategory: 'SEDAN',
    status: 'SEARCHING',
    paymentStatus: 'PENDING',
    rideSequence: 1,
    pickupLat: 12.9716 as any,
    pickupLng: 77.5946 as any,
    pickupAddress: 'MG Road, Bangalore',
    destinationLat: 12.9352 as any,
    destinationLng: 77.6245 as any,
    destinationAddress: 'Koramangala, Bangalore',
    distanceKm: 5.5 as any,
    durationMinutes: 18,
    baseFarePaise: 15000,
    surgeMultiplier: 1.0 as any,
    totalFarePaise: 15000,
    cancelledBy: null,
    cancellationReason: null,
    acceptedAt: null,
    arrivedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const registeredSockets: AuthenticatedSocket[] = [];

  beforeEach(() => {
    vi.useFakeTimers();

    const mockRedis: any = {
      geoSearch: async () => [...mockDrivers],
      exists: async () => 1,
      get: async () => null,
    };
    geoService = new GeoService(mockRedis);
    // Configured with batchSize: 5 and batchTimeoutMs: 30000
    dispatchService = new DispatchService(geoService, {
      batchSize: 5,
      batchTimeoutMs: 30000,
      dispatchRadiusKm: 5.0,
    });

    // Register rider and driver sockets in socketRegistry
    const riderSocket = createMockSocket({ userId: 'rider-abc', role: ['RIDER'] });
    socketRegistry.register(riderSocket);
    registeredSockets.push(riderSocket);

    for (const dId of mockDrivers) {
      const dSocket = createMockSocket({ userId: `user-${dId}`, driverId: dId, role: ['DRIVER'] });
      socketRegistry.register(dSocket);
      registeredSockets.push(dSocket);
    }
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    for (const s of registeredSockets) {
      socketRegistry.unregister(s);
    }
    registeredSockets.length = 0;
  });

  it('dispatches the first wave to exactly 5 drivers with 30s expiration', async () => {
    const result = await dispatchService.broadcastRideRequest(mockRide);
    expect(result.candidates.length).toBe(mockDrivers.length);

    const session = dispatchService.getActiveSession(mockRide.id);
    expect(session).toBeDefined();
    expect(session?.batchIndex).toBe(1);
    expect(Array.from(session!.currentBatch)).toEqual(['driver-1', 'driver-2', 'driver-3', 'driver-4', 'driver-5']);

    // Check that exactly the first 5 drivers received server:new-ride
    for (let i = 1; i <= 5; i++) {
      const dSocket = Array.from(socketRegistry.getDriverSockets(`driver-${i}`) || [])[0] as any;
      expect(dSocket.sentMessages.length).toBe(1);
      const msg = JSON.parse(dSocket.sentMessages[0]);
      expect(msg.event).toBe(ServerEvents.NEW_RIDE);
      expect(msg.data.ride.id).toBe(mockRide.id);
      expect(msg.data.expiresInSeconds).toBe(30);
    }

    // Driver 6 should NOT have received the offer yet (waiting for wave 2)
    const d6Socket = Array.from(socketRegistry.getDriverSockets('driver-6') || [])[0] as any;
    expect(d6Socket.sentMessages.length).toBe(0);
  });

  it('after 30s timeout, vanishes offer from wave 1 drivers and dispatches wave 2 to next 5 drivers', async () => {
    await dispatchService.broadcastRideRequest(mockRide);

    // Fast-forward 30 seconds
    await vi.advanceTimersByTimeAsync(30000);

    const session = dispatchService.getActiveSession(mockRide.id);
    expect(session).toBeDefined();
    expect(session?.batchIndex).toBe(2);
    expect(Array.from(session!.currentBatch)).toEqual(['driver-6', 'driver-7', 'driver-8', 'driver-9', 'driver-10']);

    // Verify wave 1 drivers (driver-1 .. driver-5) received offer revocation/expiration events
    for (let i = 1; i <= 5; i++) {
      const dSocket = Array.from(socketRegistry.getDriverSockets(`driver-${i}`) || [])[0] as any;
      const events = dSocket.sentMessages.map((m: string) => JSON.parse(m).event);
      expect(events).toContain(ServerEvents.RIDE_OFFER_EXPIRED);
      expect(events).toContain(ServerEvents.RIDE_REJECTED); // Immediately clears currentRide on frontend
      expect(events).toContain(ServerEvents.RIDE_CANCELLED);
    }

    // Verify wave 2 drivers (driver-6 .. driver-10) received server:new-ride
    for (let i = 6; i <= 10; i++) {
      const dSocket = Array.from(socketRegistry.getDriverSockets(`driver-${i}`) || [])[0] as any;
      expect(dSocket.sentMessages.length).toBe(1);
      const msg = JSON.parse(dSocket.sentMessages[0]);
      expect(msg.event).toBe(ServerEvents.NEW_RIDE);
      expect(msg.data.expiresInSeconds).toBe(30);
    }
  });

  it('strictly rejects late acceptance by an expired driver with "The time limit is expired and you cannot accept the ride."', async () => {
    await dispatchService.broadcastRideRequest(mockRide);

    // Fast-forward 30s so wave 1 expires
    await vi.advanceTimersByTimeAsync(30000);

    // Driver 1 (from wave 1) tries to accept now
    const validation = dispatchService.validateDriverOffer(mockRide.id, 'driver-1');
    expect(validation.valid).toBe(false);
    expect(validation.reason).toBe('The time limit is expired and you cannot accept the ride.');

    // Meanwhile, Driver 7 (current wave 2) can accept
    const validationDriver7 = dispatchService.validateDriverOffer(mockRide.id, 'driver-7');
    expect(validationDriver7.valid).toBe(true);
  });

  it('when a driver in active wave accepts, assigns ride, dismisses other drivers in wave, and cancels timer', async () => {
    await dispatchService.broadcastRideRequest(mockRide);

    // Driver 3 accepts within the 30-second window
    const validation = dispatchService.validateDriverOffer(mockRide.id, 'driver-3');
    expect(validation.valid).toBe(true);

    await dispatchService.handleDriverAccepted(mockRide.id, 'driver-3');

    // The other 4 drivers in wave 1 (driver-1, 2, 4, 5) must have offer cancelled immediately
    for (const otherId of ['driver-1', 'driver-2', 'driver-4', 'driver-5']) {
      const dSocket = Array.from(socketRegistry.getDriverSockets(otherId) || [])[0] as any;
      const events = dSocket.sentMessages.map((m: string) => JSON.parse(m).event);
      expect(events).toContain(ServerEvents.RIDE_REJECTED);
      expect(events).toContain(ServerEvents.RIDE_CANCELLED);
    }

    // Active session should be cleaned up
    expect(dispatchService.getActiveSession(mockRide.id)).toBeUndefined();

    // Advancing timer further should not trigger wave 2 because ride was accepted!
    await vi.advanceTimersByTimeAsync(60000);
    const d6Socket = Array.from(socketRegistry.getDriverSockets('driver-6') || [])[0] as any;
    expect(d6Socket.sentMessages.length).toBe(0);
  });

  it('advances immediately to next wave if all drivers in current wave explicitly decline before 30s', async () => {
    await dispatchService.broadcastRideRequest(mockRide);

    // Drivers 1, 2, 3, 4 explicitly decline
    await dispatchService.handleDriverResponse(mockRide.id, 'driver-1', false, mockRide);
    await dispatchService.handleDriverResponse(mockRide.id, 'driver-2', false, mockRide);
    await dispatchService.handleDriverResponse(mockRide.id, 'driver-3', false, mockRide);
    await dispatchService.handleDriverResponse(mockRide.id, 'driver-4', false, mockRide);

    // Wave 1 still has driver-5, so wave 2 hasn't started yet
    expect(dispatchService.getActiveSession(mockRide.id)?.batchIndex).toBe(1);

    // Driver 5 declines: now all 5 in wave 1 have declined!
    await dispatchService.handleDriverResponse(mockRide.id, 'driver-5', false, mockRide);

    // Wave 2 starts immediately without waiting for 30s!
    const session = dispatchService.getActiveSession(mockRide.id);
    expect(session?.batchIndex).toBe(2);
    expect(Array.from(session!.currentBatch)).toEqual(['driver-6', 'driver-7', 'driver-8', 'driver-9', 'driver-10']);
  });

  it('notifies rider with tip increase recommendation when all drivers in region are exhausted', async () => {
    // Only 3 candidate drivers in this region
    const localRedis: any = {
      geoSearch: async () => ['driver-1', 'driver-2', 'driver-3'],
      exists: async () => 1,
      get: async () => null,
    };
    const localGeo = new GeoService(localRedis);
    const localDispatch = new DispatchService(localGeo, {
      batchSize: 5,
      batchTimeoutMs: 30000,
    });

    await localDispatch.broadcastRideRequest(mockRide);

    // 30 seconds pass and nobody accepts
    await vi.advanceTimersByTimeAsync(30000);

    // Rider socket should have received server:ride-no-drivers-available with tip recommendation
    const riderSocket = Array.from(socketRegistry.getRiderSockets('rider-abc') || [])[0] as any;
    const lastMessage = JSON.parse(riderSocket.sentMessages[riderSocket.sentMessages.length - 1]);
    expect(lastMessage.event).toBe(ServerEvents.RIDE_NO_DRIVERS_AVAILABLE);
    expect(lastMessage.data.rideId).toBe(mockRide.id);
    expect(lastMessage.data.message).toMatch(/increase the tip/i);
    expect(lastMessage.data.suggestion).toBe('INCREASE_TIP');

    // Session cleaned up
    expect(localDispatch.getActiveSession(mockRide.id)).toBeUndefined();
  });

  it('cancels active dispatch and dismisses current batch when rider cancels the ride', async () => {
    await dispatchService.broadcastRideRequest(mockRide);

    // Rider cancels after 10 seconds
    await vi.advanceTimersByTimeAsync(10000);
    await dispatchService.cancelDispatch(mockRide.id, 'Changed mind');

    // Wave 1 drivers receive cancellation
    for (let i = 1; i <= 5; i++) {
      const dSocket = Array.from(socketRegistry.getDriverSockets(`driver-${i}`) || [])[0] as any;
      const events = dSocket.sentMessages.map((m: string) => JSON.parse(m).event);
      expect(events).toContain(ServerEvents.RIDE_CANCELLED);
      expect(events).toContain(ServerEvents.RIDE_REJECTED);
    }

    // Advancing past 30s should not start wave 2
    await vi.advanceTimersByTimeAsync(30000);
    const d6Socket = Array.from(socketRegistry.getDriverSockets('driver-6') || [])[0] as any;
    expect(d6Socket.sentMessages.length).toBe(0);
  });
});
