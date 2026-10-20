import { AuthenticatedSocket } from '../types.js';
import { RiderEvents, ServerEvents } from '../event.constants.js';
import { sendSocketError } from '../utils/send-error.js';
import { emitRideCancelled, emitToDriver } from '../emitters/driver.emitter.js';
import type { RideService } from '../../services/ride.service.js';
import type { DispatchService } from '../../services/dispatch.service.js';

export interface RiderHandlerDeps {
  rideService?: RideService;
  dispatchService?: DispatchService;
}

let globalRiderDeps: RiderHandlerDeps | undefined = undefined;

export function configureRiderHandlers(deps: RiderHandlerDeps) {
  globalRiderDeps = deps;
}

export type RiderEventHandler = (
  socket: AuthenticatedSocket,
  data: unknown,
  deps?: RiderHandlerDeps
) => Promise<void>;

const handlers: Record<string, RiderEventHandler> = {
  [RiderEvents.CANCEL_RIDE]: handleCancelRide,
  [RiderEvents.REQUEST_RIDE]: handleRequestRide,
  [RiderEvents.UPDATE_LOCATION]: handleRiderLocationUpdate,
};

import type { CoordinatePoint } from '../../services/fare.service.js';

async function handleCancelRide(
  socket: AuthenticatedSocket,
  data: unknown,
  deps = globalRiderDeps
): Promise<void> {
  const riderId = socket.user.userId;
  const dataRecord = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const rideId = typeof dataRecord.rideId === 'string' ? dataRecord.rideId : undefined;
  const reason = typeof dataRecord.reason === 'string' ? dataRecord.reason : 'Cancelled by rider';

  if (!rideId) {
    sendSocketError(socket, 'Ride ID is required to cancel a ride.');
    return;
  }

  if (deps?.rideService) {
    try {
      const cancelled = await deps.rideService.cancelRide(rideId, riderId, reason);
      if (cancelled.driverId) {
        emitRideCancelled(cancelled.driverId, {
          rideId: cancelled.id,
          cancelledBy: 'RIDER',
          reason,
        });
      }
      socket.send(
        JSON.stringify({
          event: ServerEvents.RIDE_CANCELLED,
          data: { rideId: cancelled.id, cancelledBy: 'RIDER', reason },
        })
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to cancel ride.';
      sendSocketError(socket, message);
    }
  }
}

async function handleRequestRide(
  socket: AuthenticatedSocket,
  data: unknown,
  deps = globalRiderDeps
): Promise<void> {
  const riderId = socket.user.userId;
  const dataRecord = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const pickup = dataRecord.pickup as CoordinatePoint;
  const destination = dataRecord.destination as CoordinatePoint;

  if (!pickup || !destination) {
    sendSocketError(socket, 'Pickup and destination are required.');
    return;
  }

  if (deps?.rideService && deps?.dispatchService) {
    try {
      const ride = await deps.rideService.createRide({
        riderId,
        pickup,
        destination,
        vehicleCategory: typeof dataRecord.vehicleCategory === 'string' ? dataRecord.vehicleCategory : undefined,
      });

      socket.send(JSON.stringify({ event: 'server:ride-created', data: { ride } }));
      await deps.dispatchService.broadcastRideRequest(ride);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to request ride.';
      sendSocketError(socket, message);
    }
  }
}

async function handleRiderLocationUpdate(
  socket: AuthenticatedSocket,
  data: unknown,
  deps = globalRiderDeps
): Promise<void> {
  const riderId = socket.user.userId;
  const dataRecord = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const rideId = typeof dataRecord.rideId === 'string' ? dataRecord.rideId : undefined;
  const location = dataRecord.location;

  if (rideId && location && deps?.rideService) {
    try {
      const ride = await deps.rideService.getRideById(rideId);
      if (ride && ride.driverId) {
        emitToDriver(ride.driverId, 'server:rider-location', {
          rideId,
          riderId,
          location,
          timestamp: Date.now()
        });
      }
    } catch {}
  }

  // Acknowledge telemetry
  socket.send(
    JSON.stringify({
      event: 'server:rider-location-ack',
      data: { timestamp: Date.now() },
    })
  );
}

export async function handleRiderEvent(
  socket: AuthenticatedSocket,
  event: string,
  data: unknown,
  deps = globalRiderDeps
) {
  const handler = handlers[event];
  if (!handler) {
    sendSocketError(socket, 'Unknown rider event.');
    return;
  }
  await handler(socket, data, deps);
}
