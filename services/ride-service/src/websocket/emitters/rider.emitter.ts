import type { RedisClientType } from 'redis';
import { createLogger } from '@urbanfleet/common';
import { ServerEvent, ServerEvents } from '../event.constants.js';
import {
  DriverLocationPayload,
  RideCancelledPayload,
  PaymentCapturedPayload,
  RideLifecyclePayload,
} from '../types/index.js';
import { socketRegistry } from '../registry/socket.registry.js';

const logger = createLogger('rider-emitter');

export type { DriverLocationPayload, RideCancelledPayload, PaymentCapturedPayload };

export interface NoDriversAvailablePayload {
  rideId: string;
  message?: string;
  suggestion?: string;
}

let globalRedisPublisher: RedisClientType | null = null;

export function configureRiderEmitter(redisPub?: RedisClientType | null): void {
  globalRedisPublisher = redisPub ?? null;
}

/**
 * Publishes an event to `ws:rider:<riderId>` across the cluster via Redis Pub/Sub.
 * Falls back to local socket delivery if Redis is unavailable or in unit tests.
 */
export function emitToRider<T>(riderId: string, event: ServerEvent | string, data: T): void {
  const message = JSON.stringify({ event, data });

  if (!globalRedisPublisher?.isOpen) {
    logger.debug('Redis publisher unavailable; falling back to local rider delivery');
    socketRegistry.deliverToRider(riderId, message);
    return;
  }

  const channel = `ws:rider:${riderId}`;
  globalRedisPublisher.publish(channel, message).catch((err) => {
    logger.error(`Failed to publish message to ${channel}; delivering locally`, { error: err });
    socketRegistry.deliverToRider(riderId, message);
  });
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