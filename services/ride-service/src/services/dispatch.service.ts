import { GeoService } from './geo.service.js';
import { createLogger } from '@urbanfleet/common';

const logger = createLogger('dispatch-service');

export class DispatchService {
  constructor(private geoService: GeoService) {}

  async findNearbyDrivers(lat: number, lng: number, radiusKm = 5.0) {
    return this.geoService.searchNearbyDrivers(lat, lng, radiusKm);
  }

  async dispatchRideOffer(rideId: string, driverIds: string[]) {
    logger.info(`Dispatching ride ${rideId} offer to ${driverIds.length} candidate drivers.`);
    return { rideId, candidates: driverIds };
  }

  async broadcastRideRequest(ride: any) {
    const nearby = await this.findNearbyDrivers(Number(ride.pickupLat), Number(ride.pickupLng));
    return this.dispatchRideOffer(ride.id, nearby);
  }

  async handleDriverResponse(rideId: string, driverId: string, accepted: boolean) {
    return { rideId, driverId, accepted };
  }

  async expireStaleOffers(rideId: string) {
    logger.info(`Expiring stale dispatch offers for ride ${rideId}`);
  }
}
