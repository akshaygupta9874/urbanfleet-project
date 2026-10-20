import { GeoService } from './geo.service.js';
import { createLogger } from '@urbanfleet/common';
import { emitNewRideRequest } from '../websocket/emitters/driver.emitter.js';
import { Ride } from '../db/client.js';
import { toRideDto } from '../utils/ride-dto.js';

const logger = createLogger('dispatch-service');

export class DispatchService {
  private readonly rejectedOffers = new Map<string, Set<string>>(); // rideId -> Set of rejected driverIds
  private geoService: GeoService;

  constructor(geoService: GeoService) {
    this.geoService = geoService;
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

  async findNearbyDrivers(lat: number, lng: number, radiusKm = 5.0, excludeDriverIds: string[] = []): Promise<string[]> {
    const nearby = await this.geoService.searchNearbyDrivers(lat, lng, radiusKm);
    if (excludeDriverIds.length === 0) return nearby;
    const excludedSet = new Set(excludeDriverIds);
    return nearby.filter((id) => !excludedSet.has(id));
  }

  async dispatchRideOffer(rideId: string, driverIds: string[], ride: Ride | null): Promise<{ rideId: string; candidates: string[] }> {
    logger.info(`Dispatching ride ${rideId} offer to ${driverIds.length} candidate drivers.`);
    if (ride !== null) {
      const rideDto = toRideDto(ride);
      for (const driverId of driverIds) {
        emitNewRideRequest(driverId, { ride: rideDto });
      }
    }
    return { rideId, candidates: driverIds };
  }

  async broadcastRideRequest(ride: Ride): Promise<{ rideId: string; candidates: string[] }> {
    const rejections = Array.from(this.rejectedOffers.get(ride.id) || []);
    const nearby = await this.findNearbyDrivers(
      Number(ride.pickupLat),
      Number(ride.pickupLng),
      5.0,
      rejections
    );
    return this.dispatchRideOffer(ride.id, nearby, ride);
  }

  async handleDriverResponse(
    rideId: string,
    driverId: string,
    accepted: boolean,
    ride: Ride | null
  ): Promise<{ rideId: string; driverId: string; accepted: boolean }> {
    if (!accepted) {
      await this.recordDriverRejection(rideId, driverId);
      if (ride !== null) {
        const rejections = Array.from(this.rejectedOffers.get(rideId) || []);
        const remainingCandidates = await this.findNearbyDrivers(
          Number(ride.pickupLat),
          Number(ride.pickupLng),
          5.0,
          rejections
        );
        if (remainingCandidates.length > 0) {
          await this.dispatchRideOffer(rideId, remainingCandidates, ride);
        }
      }
    }
    return { rideId, driverId, accepted };
  }

  async expireStaleOffers(rideId: string): Promise<void> {
    this.rejectedOffers.delete(rideId);
    logger.info(`Expiring stale dispatch offers for ride ${rideId}`);
  }
}
