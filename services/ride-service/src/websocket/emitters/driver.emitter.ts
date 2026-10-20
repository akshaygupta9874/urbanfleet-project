import { ServerEvents } from '../event.constants.js';
import { socketRegistry } from '../registry/socket.registry.js';
import { RideCancelledPayload, PaymentCapturedPayload } from '../types.js';

import { Ride } from '../../db/client.js';

export interface NewRideRequestPayload {
  ride: Ride | Record<string, unknown>;
}

export type { RideCancelledPayload, PaymentCapturedPayload };

export function emitToDriver<T>(driverId: string, event: string, payload: T): void {
  const sockets = socketRegistry.getDriverSockets(driverId);
  if (!sockets) return;

  const message = JSON.stringify({
    event,
    data: payload,
  });

  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(message);
    }
  }
}

export function emitNewRideRequest(driverId: string, payload: NewRideRequestPayload): void {
  emitToDriver(driverId, ServerEvents.NEW_RIDE, payload);
}

export function emitRideCancelled(driverId: string, payload: RideCancelledPayload): void {
  emitToDriver(driverId, ServerEvents.RIDE_CANCELLED, payload);
}

export function emitPaymentCaptured(driverId: string, payload: PaymentCapturedPayload): void {
  emitToDriver(driverId, ServerEvents.PAYMENT_CAPTURED, payload);
}
