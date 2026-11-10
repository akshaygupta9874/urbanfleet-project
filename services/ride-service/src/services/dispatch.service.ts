import { GeoService } from './geo.service.js';
import { createLogger } from '@urbanfleet/common';
import {
  emitNewRideRequest,
  emitRideCancelled,
  emitOfferExpired,
  emitToDriver,
} from '../websocket/emitters/driver.emitter.js';
import { emitNoDriversAvailable } from '../websocket/emitters/rider.emitter.js';
import { ServerEvents } from '../websocket/event.constants.js';
import { Ride } from '../db/client.js';
import { toRideDto } from '../utils/ride-dto.js';
import { driverClient } from '../clients/driver.client.js';
import type { RideService } from './ride.service.js';

const logger = createLogger('dispatch-service');

export interface DispatchServiceOptions {
  batchSize?: number;
  batchTimeoutMs?: number;
  dispatchRadiusKm?: number;
}

export interface DispatchSession {
  rideId: string;
  riderId: string;
  ride: Ride;
  queue: string[];
  currentBatch: Set<string>;
  batchIndex: number;
  batchExpiresAt: number;
  batchTimer: NodeJS.Timeout | null;
  attemptedDrivers: Set<string>;
  rejectedDrivers: Set<string>;
  isFinished: boolean;
}

export class DispatchService {
  private readonly rejectedOffers = new Map<string, Set<string>>(); // rideId -> Set of rejected driverIds
  private readonly activeDispatches = new Map<string, DispatchSession>(); // rideId -> DispatchSession
  private geoService: GeoService;
  private rideService?: RideService;
  private readonly batchSize: number;
  private readonly batchTimeoutMs: number;
  private readonly dispatchRadiusKm: number;

  constructor(
    geoService: GeoService,
    options?: DispatchServiceOptions,
    rideService?: RideService
  ) {
    this.geoService = geoService;
    this.rideService = rideService;
    this.batchSize = options?.batchSize ?? 5;
    this.batchTimeoutMs = options?.batchTimeoutMs ?? 30000;
    this.dispatchRadiusKm = options?.dispatchRadiusKm ?? 5.0;
  }

  setRideService(rideService: RideService): void {
    this.rideService = rideService;
  }

  getActiveSession(rideId: string): DispatchSession | undefined {
    return this.activeDispatches.get(rideId);
  }

  async recordDriverRejection(rideId: string, driverId: string): Promise<void> {
    let rejections = this.rejectedOffers.get(rideId);
    if (!rejections) {
      rejections = new Set();
      this.rejectedOffers.set(rideId, rejections);
    }
    rejections.add(driverId);
    logger.info(`Recorded rejection for ride ${rideId} by driver ${driverId}`);
  }

  async findNearbyDrivers(
    lat: number,
    lng: number,
    radiusKm = this.dispatchRadiusKm,
    excludeDriverIds: string[] = []
  ): Promise<string[]> {
    const nearby = await this.geoService.searchNearbyDrivers(lat, lng, radiusKm);
    if (excludeDriverIds.length === 0) return nearby;
    const excludedSet = new Set(excludeDriverIds);
    return nearby.filter((id) => !excludedSet.has(id));
  }

  async dispatchRideOffer(
    rideId: string,
    driverIds: string[],
    ride: Ride | null
  ): Promise<{ rideId: string; candidates: string[] }> {
    logger.info(`Dispatching ride ${rideId} offer to ${driverIds.length} candidate drivers.`);
    if (ride !== null) {
      const rideDto = toRideDto(ride);
      for (const driverId of driverIds) {
        emitNewRideRequest(driverId, {
          ride: rideDto,
          expiresInSeconds: Math.round(this.batchTimeoutMs / 1000),
        });
      }
    }
    return { rideId, candidates: driverIds };
  }

  async broadcastRideRequest(ride: Ride): Promise<{ rideId: string; candidates: string[] }> {
    // If an existing dispatch session is active for this ride, cancel it first
    if (this.activeDispatches.has(ride.id)) {
      await this.cancelDispatch(ride.id, 'New dispatch cycle started');
    }

    const rejections = Array.from(this.rejectedOffers.get(ride.id) || []);
    // Exclude rider themselves and rider's driver profile ID from dispatch candidates
    const excludedIds = [...rejections, ride.riderId];
    try {
      const riderDriver = await driverClient.getDriverByUserId(ride.riderId);
      if (riderDriver?.id) excludedIds.push(riderDriver.id);
    } catch {
      // ignore
    }

    const candidates = await this.findNearbyDrivers(
      Number(ride.pickupLat),
      Number(ride.pickupLng),
      this.dispatchRadiusKm,
      excludedIds
    );

    if (candidates.length === 0) {
      logger.info(`No candidate drivers found within ${this.dispatchRadiusKm}km for ride ${ride.id}`);
      emitNoDriversAvailable(ride.riderId, {
        rideId: ride.id,
        message: 'No drivers available in your area. Please increase the tip amount or try again.',
        suggestion: 'INCREASE_TIP',
      });
      return { rideId: ride.id, candidates: [] };
    }

    const session: DispatchSession = {
      rideId: ride.id,
      riderId: ride.riderId,
      ride,
      queue: [...candidates],
      currentBatch: new Set<string>(),
      batchIndex: 0,
      batchExpiresAt: 0,
      batchTimer: null,
      attemptedDrivers: new Set<string>(),
      rejectedDrivers: new Set<string>(rejections),
      isFinished: false,
    };

    this.activeDispatches.set(ride.id, session);
    logger.info(
      `Initialized wave dispatch session for ride ${ride.id} with ${candidates.length} candidate drivers (Batch size: ${this.batchSize}, Timeout: ${this.batchTimeoutMs}ms).`
    );

    await this.dispatchNextBatch(ride.id);

    return { rideId: ride.id, candidates };
  }

  async dispatchNextBatch(rideId: string): Promise<void> {
    const session = this.activeDispatches.get(rideId);
    if (!session || session.isFinished) return;

    // Check if ride is still in SEARCHING status if rideService is available
    if (this.rideService) {
      try {
        const freshRide = await this.rideService.getRideById(rideId);
        if (!freshRide || freshRide.status !== 'SEARCHING') {
          logger.info(`Ride ${rideId} is no longer SEARCHING (status: ${freshRide?.status}). Aborting dispatch.`);
          this.cleanupSession(rideId);
          return;
        }
      } catch (err) {
        logger.warn(
          `Could not verify ride ${rideId} status before dispatching next batch:`,
          err instanceof Error ? { error: err.message } : undefined
        );
      }
    }

    // Clear any previous timer
    if (session.batchTimer) {
      clearTimeout(session.batchTimer);
      session.batchTimer = null;
    }

    // Filter queue to remove any drivers who were already attempted or rejected
    const remainingQueue = session.queue.filter(
      (driverId) => !session.attemptedDrivers.has(driverId) && !session.rejectedDrivers.has(driverId)
    );
    session.queue = remainingQueue;

    if (remainingQueue.length === 0) {
      logger.info(`All candidate drivers exhausted for ride ${rideId}. No driver accepted.`);
      session.isFinished = true;
      this.cleanupSession(rideId);

      emitNoDriversAvailable(session.riderId, {
        rideId,
        message: 'No one is accepting your ride. Please increase the tip amount or try again.',
        suggestion: 'INCREASE_TIP',
      });
      return;
    }

    // Pick next batch of drivers (up to batchSize, e.g. 5)
    const batchDrivers = remainingQueue.slice(0, this.batchSize);
    session.queue = remainingQueue.slice(this.batchSize);
    session.currentBatch = new Set(batchDrivers);
    session.batchExpiresAt = Date.now() + this.batchTimeoutMs;
    session.batchIndex += 1;

    for (const dId of batchDrivers) {
      session.attemptedDrivers.add(dId);
    }

    const rideDto = toRideDto(session.ride);
    const expiresInSeconds = Math.round(this.batchTimeoutMs / 1000);

    logger.info(
      `Dispatching wave ${session.batchIndex} for ride ${rideId} to ${batchDrivers.length} drivers: [${batchDrivers.join(', ')}]. Expires in ${expiresInSeconds}s.`
    );

    for (const driverId of batchDrivers) {
      emitNewRideRequest(driverId, {
        ride: rideDto,
        expiresInSeconds,
      });
    }

    // Schedule 30-second timeout for this wave
    session.batchTimer = setTimeout(() => {
      void this.handleBatchTimeout(rideId);
    }, this.batchTimeoutMs);
  }

  async handleBatchTimeout(rideId: string): Promise<void> {
    const session = this.activeDispatches.get(rideId);
    if (!session || session.isFinished) return;

    logger.info(
      `Batch ${session.batchIndex} timed out after ${this.batchTimeoutMs}ms for ride ${rideId}. Expiring offers for ${session.currentBatch.size} drivers.`
    );

    // Expire offers for all drivers in current batch
    const expiredDriverIds = Array.from(session.currentBatch);
    session.currentBatch.clear();

    for (const driverId of expiredDriverIds) {
      session.rejectedDrivers.add(driverId);
      await this.recordDriverRejection(rideId, driverId);

      // Remove from driver screen in real time via WebSocket
      emitOfferExpired(driverId, {
        rideId,
        message: 'The time limit is expired and you cannot accept the ride.',
      });
    }

    // Advance to the next batch of drivers
    await this.dispatchNextBatch(rideId);
  }

  validateDriverOffer(
    rideId: string,
    driverId: string
  ): { valid: boolean; reason?: string } {
    const session = this.activeDispatches.get(rideId);
    if (!session) {
      return {
        valid: false,
        reason: 'The time limit is expired and you cannot accept the ride.',
      };
    }

    if (session.isFinished) {
      return {
        valid: false,
        reason: 'This ride has already been accepted or finished.',
      };
    }

    if (!session.currentBatch.has(driverId)) {
      if (session.attemptedDrivers.has(driverId) || session.rejectedDrivers.has(driverId)) {
        return {
          valid: false,
          reason: 'The time limit is expired and you cannot accept the ride.',
        };
      }
      return {
        valid: false,
        reason: 'You do not have an active offer for this ride.',
      };
    }

    if (Date.now() > session.batchExpiresAt) {
      return {
        valid: false,
        reason: 'The time limit is expired and you cannot accept the ride.',
      };
    }

    return { valid: true };
  }

  async handleDriverAccepted(rideId: string, driverId: string): Promise<void> {
    const session = this.activeDispatches.get(rideId);
    if (!session) return;

    session.isFinished = true;
    if (session.batchTimer) {
      clearTimeout(session.batchTimer);
      session.batchTimer = null;
    }

    // For all other drivers in current batch, dismiss offer immediately from their screens
    for (const otherDriverId of session.currentBatch) {
      if (otherDriverId !== driverId) {
        emitRideCancelled(otherDriverId, {
          rideId,
          cancelledBy: 'SYSTEM',
          reason: 'Ride accepted by another driver.',
        });
        emitToDriver(otherDriverId, ServerEvents.RIDE_REJECTED, { rideId });
      }
    }

    this.cleanupSession(rideId);
    logger.info(`Ride ${rideId} successfully accepted by driver ${driverId}. Dispatch session ended.`);
  }

  async handleDriverResponse(
    rideId: string,
    driverId: string,
    accepted: boolean,
    ride: Ride | null
  ): Promise<{ rideId: string; driverId: string; accepted: boolean }> {
    if (accepted) {
      await this.handleDriverAccepted(rideId, driverId);
      return { rideId, driverId, accepted: true };
    }

    // Driver explicitly declined
    await this.recordDriverRejection(rideId, driverId);

    const session = this.activeDispatches.get(rideId);
    if (session && !session.isFinished) {
      session.rejectedDrivers.add(driverId);
      session.currentBatch.delete(driverId);

      // If all drivers in this wave have explicitly declined, move immediately to next batch
      if (session.currentBatch.size === 0) {
        logger.info(
          `All drivers in wave ${session.batchIndex} declined ride ${rideId}. Triggering next batch immediately.`
        );
        if (session.batchTimer) {
          clearTimeout(session.batchTimer);
          session.batchTimer = null;
        }
        await this.dispatchNextBatch(rideId);
      }
    }

    return { rideId, driverId, accepted: false };
  }

  async cancelDispatch(rideId: string, reason = 'Cancelled by user'): Promise<void> {
    const session = this.activeDispatches.get(rideId);
    if (!session) return;

    session.isFinished = true;
    if (session.batchTimer) {
      clearTimeout(session.batchTimer);
      session.batchTimer = null;
    }

    // Dismiss offers from all drivers in currentBatch
    for (const driverId of session.currentBatch) {
      emitRideCancelled(driverId, {
        rideId,
        cancelledBy: 'RIDER',
        reason,
      });
      emitToDriver(driverId, ServerEvents.RIDE_REJECTED, { rideId });
    }

    this.cleanupSession(rideId);
    logger.info(`Dispatch session for ride ${rideId} cancelled. Reason: ${reason}`);
  }

  private cleanupSession(rideId: string): void {
    const session = this.activeDispatches.get(rideId);
    if (session) {
      if (session.batchTimer) {
        clearTimeout(session.batchTimer);
        session.batchTimer = null;
      }
      this.activeDispatches.delete(rideId);
    }
  }

  async expireStaleOffers(rideId: string): Promise<void> {
    this.cleanupSession(rideId);
    this.rejectedOffers.delete(rideId);
    logger.info(`Expiring stale dispatch offers for ride ${rideId}`);
  }
}
