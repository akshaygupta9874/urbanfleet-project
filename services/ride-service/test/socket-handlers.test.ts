import { describe, expect, it, beforeEach, vi } from 'vitest';
import { SocketRegistry } from '../src/websocket/registry/socket.registry.js';
import {
  emitNewRideRequest,
  emitRideCancelled as emitDriverRideCancelled,
  emitPaymentCaptured as emitDriverPaymentCaptured,
} from '../src/websocket/emitters/driver.emitter.js';
import {
  emitRideAccepted,
  emitDriverLocation,
  emitDriverArrived,
  emitRideStarted,
  emitArrivedAtDestination,
  emitRideCompleted,
  emitPaymentCaptured as emitRiderPaymentCaptured,
  emitRideCancelled as emitRiderRideCancelled,
  emitNoDriversAvailable,
} from '../src/websocket/emitters/rider.emitter.js';
import { ServerEvents } from '../src/websocket/event.constants.js';
import { registerDispatcher } from '../src/websocket/handlers/dispatcher.js';
import { AuthenticatedSocket } from '../src/websocket/types.js';
import { getSocketRoles } from '../src/websocket/ride-socket.server.js';
import type { RideDto } from '@urbanfleet/common';

function makeRideDto(id: string): RideDto {
  const fareBreakdown = {
    baseFarePaise: 100,
    distanceFarePaise: 200,
    timeFarePaise: 0,
    surgePaise: 0,
    platformCommissionPaise: 30,
    driverEarningPaise: 270,
    totalPaise: 300,
  };
  return {
    id,
    riderId: 'rider-1',
    driverId: null,
    pickupAddress: 'Pickup',
    pickupLat: 12.9716,
    pickupLng: 77.5946,
    destinationAddress: 'Destination',
    destinationLat: 13.0827,
    destinationLng: 80.2707,
    pickup: { address: 'Pickup', coordinates: { latitude: 12.9716, longitude: 77.5946 } },
    destination: { address: 'Destination', coordinates: { latitude: 13.0827, longitude: 80.2707 } },
    fare: { estimated: 300, final: null, breakdown: fareBreakdown },
    distance: { estimated: 3, actual: 3 },
    duration: { estimated: 10, actual: null },
    status: 'SEARCHING',
    paymentStatus: 'PENDING',
    driver: null,
    cancelledBy: null,
    cancellationReason: null,
  };
}

describe('WebSocket token role mapping', () => {
  it('uses the roles array when the primary role claim is RIDER', () => {
    expect(getSocketRoles({ role: 'RIDER', roles: ['RIDER', 'DRIVER'] })).toEqual([
      'RIDER',
      'DRIVER',
    ]);
  });

  it('ensures the driver role also includes rider access', () => {
    expect(getSocketRoles({ role: 'DRIVER' })).toEqual(['DRIVER', 'RIDER']);
  });
});

function createMockSocket(user: any): AuthenticatedSocket {
  const listeners: Record<string, Function[]> = {};
  const sentMessages: string[] = [];

  const socket: any = {
    user,
    readyState: 1, // WebSocket.OPEN
    OPEN: 1,
    CLOSED: 3,
    sentMessages,
    send: vi.fn((data: string) => {
      sentMessages.push(data);
    }),
    close: vi.fn(() => {
      socket.readyState = 3;
      const closeListeners = listeners['close'] || [];
      for (const fn of closeListeners) fn();
    }),
    on: vi.fn((event: string, handler: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    }),
    emit: (event: string, ...args: any[]) => {
      const handlers = listeners[event] || [];
      for (const fn of handlers) fn(...args);
    },
  };

  return socket as AuthenticatedSocket;
}

describe('Legacy Socket Registry & Emitters Suite', () => {
  let registry: SocketRegistry;

  beforeEach(() => {
    registry = new SocketRegistry();
  });

  it('manages driver and rider socket registrations and lookups in registry', () => {
    const driverSocket = createMockSocket({
      userId: 'user-drv-1',
      driverId: 'drv-profile-1',
      role: ['DRIVER'],
    });

    const riderSocket = createMockSocket({
      userId: 'user-rider-1',
      role: ['RIDER'],
    });

    // 1. Register sockets
    registry.register(driverSocket);
    registry.register(riderSocket);

    expect(registry.getConnectedDriversCount()).toBe(1);
    expect(registry.getConnectedRidersCount()).toBe(1);
    expect(registry.getTotalConnectedSockets()).toBe(2);

    expect(registry.isDriverOnline('drv-profile-1')).toBe(true);
    expect(registry.isRiderOnline('user-rider-1')).toBe(true);

    expect(registry.getDriverSockets('drv-profile-1')?.has(driverSocket)).toBe(true);
    expect(registry.getRiderSockets('user-rider-1')?.has(riderSocket)).toBe(true);

    // 2. Broadcast to all sockets
    registry.broadcast(JSON.stringify({ event: 'system:ping', data: {} }));
    expect((driverSocket as any).sentMessages.length).toBe(1);
    expect((riderSocket as any).sentMessages.length).toBe(1);

    // 3. Disconnect and unregister
    registry.disconnectDriver('drv-profile-1');
    expect(driverSocket.close).toHaveBeenCalled();

    registry.unregister(driverSocket);
    registry.unregister(riderSocket);

    expect(registry.isDriverOnline('drv-profile-1')).toBe(false);
    expect(registry.isRiderOnline('user-rider-1')).toBe(false);
    expect(registry.getTotalConnectedSockets()).toBe(0);
  });

  it('driver emitters push messages correctly to targeted driver sockets', async () => {
    // Import shared registry for emitter tests
    const { socketRegistry } = await import('../src/websocket/registry/socket.registry.js');
    const mockDriverSocket = createMockSocket({
      userId: 'u-1',
      driverId: 'target-drv-100',
      role: ['DRIVER'],
    });

    socketRegistry.register(mockDriverSocket);

    // 1. emitNewRideRequest
    emitNewRideRequest('target-drv-100', {
      ride: makeRideDto('ride-999'),
    });

    // 2. emitRideCancelled
    emitDriverRideCancelled('target-drv-100', {
      rideId: 'ride-999',
      cancelledBy: 'RIDER',
      reason: 'Change of plans',
    });

    // 3. emitPaymentCaptured
    emitDriverPaymentCaptured('target-drv-100', {
      ride: { id: 'ride-999', paymentStatus: 'CAPTURED' },
    });

    const messages = (mockDriverSocket as any).sentMessages.map((m: string) => JSON.parse(m));
    expect(messages[0].event).toBe(ServerEvents.NEW_RIDE);
    expect(messages[0].data.ride.id).toBe('ride-999');
    expect(messages[0].data.ride.pickup.coordinates).toEqual({ latitude: 12.9716, longitude: 77.5946 });
    expect(messages[0].data.ride).not.toHaveProperty('otp');

    expect(messages[1].event).toBe(ServerEvents.RIDE_CANCELLED);
    expect(messages[1].data.cancelledBy).toBe('RIDER');

    expect(messages[2].event).toBe(ServerEvents.PAYMENT_CAPTURED);
    expect(messages[2].data.ride.paymentStatus).toBe('CAPTURED');

    socketRegistry.unregister(mockDriverSocket);
  });

  it('rider emitters push real-time events to targeted rider sockets', async () => {
    const { socketRegistry } = await import('../src/websocket/registry/socket.registry.js');
    const mockRiderSocket = createMockSocket({
      userId: 'target-rider-200',
      role: ['RIDER'],
    });

    socketRegistry.register(mockRiderSocket);

    // 1. emitRideAccepted
    const ride = makeRideDto('ride-abc');
    emitRideAccepted('target-rider-200', { ride });

    // 2. emitDriverLocation
    emitDriverLocation('target-rider-200', {
      rideId: 'ride-abc',
      latitude: 12.9716,
      longitude: 77.5946,
    });

    // 3. emitDriverArrived
    emitDriverArrived('target-rider-200', { ride });

    // 4. emitRideStarted
    emitRideStarted('target-rider-200', { ride });

    // 5. emitArrivedAtDestination
    emitArrivedAtDestination('target-rider-200', { ride });

    // 6. emitRideCompleted
    emitRideCompleted('target-rider-200', { ride });

    // 7. emitPaymentCaptured
    emitRiderPaymentCaptured('target-rider-200', {
      ride: { id: 'ride-abc', paymentStatus: 'CAPTURED' },
    });

    // 8. emitRideCancelled
    emitRiderRideCancelled('target-rider-200', {
      rideId: 'ride-abc',
      cancelledBy: 'DRIVER',
      reason: 'Flat tire',
    });

    // 9. emitNoDriversAvailable
    emitNoDriversAvailable('target-rider-200', { rideId: 'ride-xyz' });

    const messages = (mockRiderSocket as any).sentMessages.map((m: string) => JSON.parse(m));
    expect(messages[0].event).toBe(ServerEvents.RIDE_ACCEPTED);
    expect(messages[0].data.ride.status).toBe('SEARCHING');
    expect(messages[1].event).toBe(ServerEvents.DRIVER_LOCATION);
    expect(messages[1].data.latitude).toBe(12.9716);
    expect(messages[2].event).toBe(ServerEvents.DRIVER_ARRIVED);
    expect(messages[3].event).toBe(ServerEvents.RIDE_STARTED);
    expect(messages[4].event).toBe(ServerEvents.ARRIVED_AT_DESTINATION);
    expect(messages[5].event).toBe(ServerEvents.RIDE_COMPLETED);
    expect(messages[6].event).toBe(ServerEvents.PAYMENT_CAPTURED);
    expect(messages[7].event).toBe(ServerEvents.RIDE_CANCELLED);
    expect(messages[8].event).toBe(ServerEvents.RIDE_NO_DRIVERS_AVAILABLE);

    socketRegistry.unregister(mockRiderSocket);
  });

  it('dispatcher routes incoming socket messages and rejects malformed or unknown events', async () => {
    const socket = createMockSocket({
      userId: 'user-dispatch-test',
      driverId: 'drv-test',
      role: ['DRIVER'],
    });

    registerDispatcher(socket);

    // 1. Send ping
    (socket as any).emit('message', Buffer.from(JSON.stringify({ type: 'ping' })));
    expect((socket as any).sentMessages[0]).toBe(JSON.stringify({ type: 'pong' }));

    // 2. Send unknown event
    (socket as any).emit(
      'message',
      Buffer.from(JSON.stringify({ event: 'unknown:weird-event', data: {} }))
    );
    const errPayload = JSON.parse((socket as any).sentMessages[1]);
    expect(errPayload.event).toBe(ServerEvents.ERROR);
    expect(errPayload.data.message).toBe('Unknown event.');

    // 3. Send malformed message (invalid JSON)
    (socket as any).emit('message', Buffer.from('NOT_VALID_JSON'));
    const invalidPayload = JSON.parse((socket as any).sentMessages[2]);
    expect(invalidPayload.event).toBe(ServerEvents.ERROR);
    expect(invalidPayload.data.message).toBe('Invalid WebSocket message.');
  });
});
