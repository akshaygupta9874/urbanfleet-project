import { AuthenticatedSocket } from '../types.js';
import { DriverEvents, ServerEvents } from '../event.constants.js';
import {
  UpdateDriverLocationSchema,
  DriverHeartbeatSchema,
  DriverAvailabilitySchema,
  RideActionSchema,
  RideCancelSchema,
} from '../validators/driver.validator.js';
import { sendSocketError } from '../utils/send-error.js';
import { emitDriverLocation, emitRideAccepted, emitDriverArrived, emitRideStarted, emitArrivedAtDestination, emitRideCompleted, emitRideCancelled } from '../emitters/rider.emitter.js';
import type { GeoService } from '../../services/geo.service.js';
import type { DriverPresenceService } from '../../services/driver-presence.service.js';
import type { RideService } from '../../services/ride.service.js';
import type { DispatchService } from '../../services/dispatch.service.js';

export interface DriverHandlerDeps {
  geoService: GeoService;
  presenceService: DriverPresenceService;
  rideService?: RideService;
  dispatchService?: DispatchService;
}

let globalDeps: DriverHandlerDeps | undefined = undefined;

export function configureDriverHandlers(deps: DriverHandlerDeps) {
  globalDeps = deps;
}

export type DriverEventHandler = (
  socket: AuthenticatedSocket,
  data: unknown,
  deps?: DriverHandlerDeps
) => Promise<void>;

const handlers: Record<string, DriverEventHandler> = {
  [DriverEvents.GO_ONLINE]: handleGoOnline,
  [DriverEvents.GO_OFFLINE]: handleGoOffline,
  [DriverEvents.SET_OFFLINE]: handleGoOffline,
  [DriverEvents.UPDATE_LOCATION]: handleUpdateLocation,
  [DriverEvents.HEARTBEAT]: handleHeartbeat,
  [DriverEvents.SET_AVAILABLE]: handleSetAvailability,
  [DriverEvents.SET_BUSY]: handleSetBusy,
  [DriverEvents.ACCEPT_RIDE]: handleAcceptRide,
  [DriverEvents.REJECT_RIDE]: handleRejectRide,
  [DriverEvents.ARRIVED_AT_PICKUP]: handleArrived,
  [DriverEvents.ARRIVED_AT_DESTINATION]: handleArrivedAtDestination,
  [DriverEvents.START_RIDE]: handleStartRide,
  [DriverEvents.COMPLETE_RIDE]: handleCompleteRide,
  [DriverEvents.CANCEL_RIDE_BY_DRIVER]: handleCancelRideByDriver,
};

async function handleGoOnline(
  socket: AuthenticatedSocket,
  data: unknown,
  deps = globalDeps
) {
  const driverId = socket.user.driverId || socket.user.userId;
  if (!driverId) {
    sendSocketError(socket, 'Driver profile not found.');
    return;
  }

  if (deps?.presenceService) {
    const current = await deps.presenceService.setDriverOnline(driverId);
    socket.send(
      JSON.stringify({
        event: ServerEvents.DRIVER_STATUS,
        data: {
          status: 'ONLINE',
          isOnline: current.online,
          isAvailable: current.available,
          driverId,
          timestamp: current.lastSeen,
        },
      })
    );
  }
}

async function handleGoOffline(
  socket: AuthenticatedSocket,
  data: unknown,
  deps = globalDeps
) {
  const driverId = socket.user.driverId || socket.user.userId;
  if (!driverId) {
    sendSocketError(socket, 'Driver profile not found.');
    return;
  }

  if (deps?.presenceService) {
    await deps.presenceService.setDriverOffline(driverId);
  }
  socket.send(
    JSON.stringify({
      event: ServerEvents.DRIVER_STATUS,
      data: {
        status: 'OFFLINE',
        isOnline: false,
        isAvailable: false,
        driverId,
        timestamp: Date.now(),
      },
    })
  );
}

async function handleSetAvailability(
  socket: AuthenticatedSocket,
  data: unknown,
  deps = globalDeps
) {
  const result = DriverAvailabilitySchema.safeParse(data || {});
  if (!result.success) {
    sendSocketError(socket, 'Invalid availability payload.');
    return;
  }

  const driverId = socket.user.driverId || socket.user.userId;
  if (!driverId) {
    sendSocketError(socket, 'Driver profile not found.');
    return;
  }

  const isAvailable = result.data?.available !== false;
  if (deps?.presenceService) {
    const current = await deps.presenceService.setDriverAvailable(driverId, isAvailable);
    socket.send(
      JSON.stringify({
        event: ServerEvents.DRIVER_STATUS,
        data: {
          status: isAvailable ? 'AVAILABLE' : 'ONLINE',
          isOnline: current.online,
          isAvailable: current.available,
          driverId,
          timestamp: current.lastSeen,
        },
      })
    );
  }
}

async function handleSetBusy(
  socket: AuthenticatedSocket,
  data: unknown,
  deps = globalDeps
) {
  const driverId = socket.user.driverId || socket.user.userId;
  if (!driverId) {
    sendSocketError(socket, 'Driver profile not found.');
    return;
  }

  if (deps?.presenceService) {
    const current = await deps.presenceService.setDriverBusy(driverId);
    socket.send(
      JSON.stringify({
        event: ServerEvents.DRIVER_STATUS,
        data: {
          status: 'BUSY',
          isOnline: current.online,
          isAvailable: current.available,
          driverId,
          timestamp: current.lastSeen,
        },
      })
    );
  }
}

async function handleHeartbeat(
  socket: AuthenticatedSocket,
  data: unknown,
  deps = globalDeps
) {
  const result = DriverHeartbeatSchema.safeParse(data || {});
  if (!result.success) {
    sendSocketError(socket, 'Invalid heartbeat payload.');
    return;
  }

  const driverId = socket.user.driverId || socket.user.userId;
  if (!driverId) return;

  if (deps?.presenceService) {
    const current = await deps.presenceService.updateHeartbeat(driverId);
    socket.send(
      JSON.stringify({
        event: ServerEvents.HEARTBEAT_ACK,
        data: {
          timestamp: current?.lastSeen || Date.now(),
          isOnline: current?.online ?? false,
          isAvailable: current?.available ?? false,
        },
      })
    );
  }
}

async function handleUpdateLocation(
  socket: AuthenticatedSocket,
  data: unknown,
  deps = globalDeps
) {
  const result = UpdateDriverLocationSchema.safeParse(data);
  if (!result.success) {
    sendSocketError(socket, 'Invalid location payload.');
    return;
  }

  const driverId = socket.user.driverId || socket.user.userId;
  if (!driverId) {
    sendSocketError(socket, 'Driver profile not found.');
    return;
  }

  if (deps?.geoService) {
    await deps.geoService.updateDriverLocation(
      driverId,
      result.data.latitude,
      result.data.longitude
    );
  }
  if (deps?.presenceService) {
    await deps.presenceService.updateHeartbeat(driverId);
  }

  if (deps?.rideService) {
    try {
      const ride = await deps.rideService.getDriverCurrentRide(driverId);
      if (ride && ['ACCEPTED', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'ARRIVED', 'STARTED', 'IN_PROGRESS'].includes(ride.status)) {
        emitDriverLocation(ride.riderId, {
          rideId: ride.id,
          latitude: result.data.latitude,
          longitude: result.data.longitude,
        });
      }
    } catch {
      // Ignored for non-active ride location telemetry
    }
  }
}

async function handleAcceptRide(
  socket: AuthenticatedSocket,
  data: unknown,
  deps = globalDeps
) {
  const result = RideActionSchema.safeParse(data);
  if (!result.success) {
    sendSocketError(socket, 'Invalid ride payload.');
    return;
  }

  const driverId = socket.user.driverId || socket.user.userId;
  if (!driverId) {
    sendSocketError(socket, 'Driver profile not found.');
    return;
  }

  if (deps?.rideService) {
    try {
      const ride = await deps.rideService.acceptRide(result.data.rideId, driverId);
      emitRideAccepted(ride.riderId, { ride });
      socket.send(JSON.stringify({ event: ServerEvents.RIDE_ACCEPTED, data: { ride } }));
      if (deps.presenceService) {
        await deps.presenceService.setDriverBusy(driverId);
      }
    } catch (err: any) {
      sendSocketError(socket, err.message || 'Failed to accept ride.');
    }
  }
}

async function handleRejectRide(
  socket: AuthenticatedSocket,
  data: unknown,
  deps = globalDeps
) {
  const result = RideActionSchema.safeParse(data);
  if (!result.success) {
    sendSocketError(socket, 'Invalid ride payload.');
    return;
  }

  const driverId = socket.user.driverId || socket.user.userId;
  if (deps?.dispatchService) {
    let ride: any = null;
    if (deps.rideService) {
      try {
        ride = await deps.rideService.getRideById(result.data.rideId);
      } catch {}
    }
    await deps.dispatchService.handleDriverResponse(result.data.rideId, driverId, false, ride);
  }

  // Acknowledge rejection
  socket.send(JSON.stringify({ event: 'server:ride-rejected', data: { rideId: result.data.rideId } }));
}

async function handleArrived(
  socket: AuthenticatedSocket,
  data: unknown,
  deps = globalDeps
) {
  const result = RideActionSchema.safeParse(data);
  if (!result.success) {
    sendSocketError(socket, 'Invalid ride payload.');
    return;
  }

  const driverId = socket.user.driverId || socket.user.userId;
  if (!driverId) {
    sendSocketError(socket, 'Driver profile not found.');
    return;
  }

  if (deps?.rideService) {
    try {
      const ride = await deps.rideService.arriveAtPickup({
        rideId: result.data.rideId,
        driverId,
      });
      emitDriverArrived(ride.riderId, { rideId: ride.id });
      socket.send(JSON.stringify({ event: ServerEvents.DRIVER_ARRIVED, data: { ride } }));
    } catch (err: any) {
      sendSocketError(socket, err.message || 'Failed to record arrival.');
    }
  }
}

async function handleArrivedAtDestination(
  socket: AuthenticatedSocket,
  data: unknown,
  deps = globalDeps
) {
  const result = RideActionSchema.safeParse(data);
  if (!result.success) {
    sendSocketError(socket, 'Invalid ride payload.');
    return;
  }

  const driverId = socket.user.driverId || socket.user.userId;
  if (!driverId) {
    sendSocketError(socket, 'Driver profile not found.');
    return;
  }

  if (deps?.rideService) {
    try {
      const ride = await deps.rideService.arriveAtDestination({
        rideId: result.data.rideId,
        driverId,
      });
      emitArrivedAtDestination(ride.riderId, { rideId: ride.id });
      socket.send(JSON.stringify({ event: ServerEvents.ARRIVED_AT_DESTINATION, data: { ride } }));
    } catch (err: any) {
      sendSocketError(socket, err.message || 'Failed to record destination arrival.');
    }
  }
}

async function handleStartRide(
  socket: AuthenticatedSocket,
  data: unknown,
  deps = globalDeps
) {
  const result = RideActionSchema.safeParse(data);
  if (!result.success) {
    sendSocketError(socket, 'Invalid ride payload.');
    return;
  }

  const driverId = socket.user.driverId || socket.user.userId;
  if (!driverId) {
    sendSocketError(socket, 'Driver profile not found.');
    return;
  }

  if (deps?.rideService) {
    try {
      const ride = await deps.rideService.startRide(
        result.data.rideId,
        driverId,
        result.data.otp || ''
      );
      emitRideStarted(ride.riderId, { rideId: ride.id });
      socket.send(JSON.stringify({ event: ServerEvents.RIDE_STARTED, data: { ride } }));
    } catch (err: any) {
      sendSocketError(socket, err.message || 'Failed to start ride.');
    }
  }
}

async function handleCompleteRide(
  socket: AuthenticatedSocket,
  data: unknown,
  deps = globalDeps
) {
  const result = RideActionSchema.safeParse(data);
  if (!result.success) {
    sendSocketError(socket, 'Invalid ride payload.');
    return;
  }

  const driverId = socket.user.driverId || socket.user.userId;
  if (!driverId) {
    sendSocketError(socket, 'Driver profile not found.');
    return;
  }

  if (deps?.rideService) {
    try {
      const ride = await deps.rideService.completeRide(result.data.rideId, driverId);
      emitRideCompleted(ride.riderId, { rideId: ride.id, ride });
      socket.send(JSON.stringify({ event: ServerEvents.RIDE_COMPLETED, data: { ride } }));
      if (deps.presenceService) {
        await deps.presenceService.setDriverAvailable(driverId, true);
      }
    } catch (err: any) {
      sendSocketError(socket, err.message || 'Failed to complete ride.');
    }
  }
}

async function handleCancelRideByDriver(
  socket: AuthenticatedSocket,
  data: unknown,
  deps = globalDeps
) {
  const result = RideCancelSchema.safeParse(data);
  if (!result.success) {
    sendSocketError(socket, 'Invalid ride payload.');
    return;
  }

  const driverId = socket.user.driverId || socket.user.userId;
  if (!driverId) {
    sendSocketError(socket, 'Driver profile not found.');
    return;
  }

  if (deps?.rideService) {
    try {
      const ride = await deps.rideService.cancelRideByDriver({
        rideId: result.data.rideId,
        driverId,
        reason: result.data.reason,
      });
      emitRideCancelled(ride.riderId, {
        rideId: ride.id,
        cancelledBy: 'DRIVER',
        reason: result.data.reason,
      });
      socket.send(
        JSON.stringify({
          event: ServerEvents.RIDE_CANCELLED,
          data: { rideId: ride.id, cancelledBy: 'DRIVER', reason: result.data.reason },
        })
      );
      if (deps.presenceService) {
        await deps.presenceService.setDriverAvailable(driverId, true);
      }
    } catch (err: any) {
      sendSocketError(socket, err.message || 'Failed to cancel ride.');
    }
  }
}

export async function handleDriverEvent(
  socket: AuthenticatedSocket,
  event: string,
  data: unknown,
  deps = globalDeps
) {
  const handler = handlers[event];
  if (!handler) {
    sendSocketError(socket, 'Unknown driver event.');
    return;
  }
  await handler(socket, data, deps);
}
