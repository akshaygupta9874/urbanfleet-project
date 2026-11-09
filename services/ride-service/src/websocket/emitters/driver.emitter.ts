import type { RedisClientType } from 'redis';
import { createLogger, type RideDto } from '@urbanfleet/common';
import { ServerEvents, ServerEvent } from '../event.constants.js';
import { RideCancelledPayload, PaymentCapturedPayload } from '../types/index.js';
import { socketRegistry } from '../registry/socket.registry.js';

const logger = createLogger('driver-emitter');

export interface NewRideRequestPayload {
  ride: RideDto;
}

export type { RideCancelledPayload, PaymentCapturedPayload };

let globalRedisPublisher: RedisClientType | null = null;

export function configureDriverEmitter(redisPub?: RedisClientType | null): void {
  globalRedisPublisher = redisPub ?? null;
}

/**
 * Publishes an event to `ws:driver:<driverId>` across the cluster via Redis Pub/Sub.
 * Falls back to local socket delivery if Redis is unavailable or in unit tests.
 */
export function emitToDriver<T>(driverId: string, event: ServerEvent | string, payload: T): void {
  const message = JSON.stringify({ event, data: payload });

  if (!globalRedisPublisher?.isOpen) {
    logger.debug('Redis publisher unavailable; falling back to local driver delivery');
    socketRegistry.deliverToDriver(driverId, message);
    return;
  }

  const channel = `ws:driver:${driverId}`;
  globalRedisPublisher.publish(channel, message).catch((err) => {
    logger.error(`Failed to publish message to ${channel}; delivering locally`, { error: err });
    socketRegistry.deliverToDriver(driverId, message);
  });
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