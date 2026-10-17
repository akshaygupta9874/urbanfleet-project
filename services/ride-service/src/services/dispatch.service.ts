import { GeoService } from './geo.service.js';
import { createLogger } from '@urbanfleet/common';
import { emitNewRideRequest } from '../websocket/emitters/driver.emitter.js';

const logger = createLogger('dispatch-service');

export class DispatchService {
  private readonly rejectedOffers = new Map<string, Set<string>>(); // rideId -> Set of rejected driverIds

  constructor(private geoService: GeoService) {}

  async recordDriverRejection(rideId: string, driverId: string) {
    let rejections = this.rejectedOffers.get(rideId);
    if (!rejections) {
      rejections = new Set();
      this.rejectedOffers.set(rideId, rejections);
    }
    rejections.add(driverId);
    logger.info(`Recorded rejection for ride ${rideId} by driver ${driverId}`);
  }

  async findNearbyDrivers(lat: number, lng: number, radiusKm = 5.0, excludeDriverIds: string[] = []) {
    const nearby = await this.geoService.searchNearbyDrivers(lat, lng, radiusKm);
    if (excludeDriverIds.length === 0) return nearby;
    const excludedSet = new Set(excludeDriverIds);
    return nearby.filter((id) => !excludedSet.has(id));
  }

  async dispatchRideOffer(rideId: string, driverIds: string[], ride?: any) {
    logger.info(`Dispatching ride ${rideId} offer to ${driverIds.length} candidate drivers.`);
    if (ride) {
      for (const driverId of driverIds) {
        emitNewRideRequest(driverId, { ride });
      }
    }
    return { rideId, candidates: driverIds };
  }

  async broadcastRideRequest(ride: any) {
    const rejections = Array.from(this.rejectedOffers.get(ride.id) || []);
    const nearby = await this.findNearbyDrivers(
      Number(ride.pickupLat),
      Number(ride.pickupLng),
      5.0,
      rejections
    );
    return this.dispatchRideOffer(ride.id, nearby, ride);
  }

  async handleDriverResponse(rideId: string, driverId: string, accepted: boolean, ride?: any) {
    if (!accepted) {
      await this.recordDriverRejection(rideId, driverId);
      if (ride) {
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

  async expireStaleOffers(rideId: string) {
    this.rejectedOffers.delete(rideId);
    logger.info(`Expiring stale dispatch offers for ride ${rideId}`);
  }
}
