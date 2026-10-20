import { socketRegistry } from '../registry/socket.registry.js';
import { ServerEvent, ServerEvents } from '../event.constants.js';
import { DriverLocationPayload, RideCancelledPayload, PaymentCapturedPayload, RideLifecyclePayload } from '../types.js';

export type { DriverLocationPayload };

export type { RideCancelledPayload };

export type { PaymentCapturedPayload };

export interface NoDriversAvailablePayload {
  rideId: string;
}

export function emitToRider<T>(riderId: string, event: ServerEvent, data: T): void {
  const sockets = socketRegistry.getRiderSockets(riderId);
  if (!sockets) return;

  const message = JSON.stringify({
    event,
    data,
  });

  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(message);
    }
  }
}

export function emitRideAccepted(riderId: string, payload: RideLifecyclePayload): void {
  emitToRider(riderId, ServerEvents.RIDE_ACCEPTED, payload);
}

export function emitDriverLocation(riderId: string, payload: DriverLocationPayload): void {
  emitToRider(riderId, ServerEvents.DRIVER_LOCATION, payload);
}

export function emitDriverArrived(riderId: string, payload: RideLifecyclePayload): void {
  emitToRider(riderId, ServerEvents.DRIVER_ARRIVED, payload);
}

export function emitRideStarted(riderId: string, payload: RideLifecyclePayload): void {
  emitToRider(riderId, ServerEvents.RIDE_STARTED, payload);
}

export function emitArrivedAtDestination(riderId: string, payload: RideLifecyclePayload): void {
  emitToRider(riderId, ServerEvents.ARRIVED_AT_DESTINATION, payload);
}

export function emitRideCompleted(riderId: string, payload: RideLifecyclePayload): void {
  emitToRider(riderId, ServerEvents.RIDE_COMPLETED, payload);
}

export function emitPaymentCaptured(riderId: string, payload: PaymentCapturedPayload): void {
  emitToRider(riderId, ServerEvents.PAYMENT_CAPTURED, payload);
}

export function emitRideCancelled(riderId: string, payload: RideCancelledPayload): void {
  emitToRider(riderId, ServerEvents.RIDE_CANCELLED, payload);
}

export function emitNoDriversAvailable(riderId: string, payload: NoDriversAvailablePayload): void {
  emitToRider(riderId, ServerEvents.RIDE_NO_DRIVERS_AVAILABLE, payload);
}
