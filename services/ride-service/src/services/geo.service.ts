import { RedisClientType } from 'redis';
import { createLogger } from '@urbanfleet/common';
import type { DriverPresenceService } from './driver-presence.service.js';

const logger = createLogger('geo-service');
const GEO_KEY = 'ride:drivers:locations';

export class GeoService {
  private presenceService?: DriverPresenceService;
  private redis: RedisClientType;

  constructor(redis: RedisClientType, presenceService?: DriverPresenceService) {
    this.redis = redis;
    this.presenceService = presenceService;
  }

  setPresenceService(presenceService: DriverPresenceService) {
    this.presenceService = presenceService;
  }

  async updateDriverLocation(driverId: string, lat: number, lng: number) {
    // 1. Add/Update coordinate in Redis GEO
    await this.redis.geoAdd(GEO_KEY, {
      longitude: lng,
      latitude: lat,
      member: driverId
    });

    // 2. Set ephemeral heartbeat TTL key (60s) for stale driver cleanup
    await this.redis.set(`driver:heartbeat:${driverId}`, '1', { EX: 60 });
  }

  async getDriverLocation(driverId: string) {
    const coords = await this.redis.geoPos(GEO_KEY, driverId);
    if (!coords || !coords[0]) return null;
    return { lat: Number(coords[0].latitude), lng: Number(coords[0].longitude) };
  }

  async removeDriverLocation(driverId: string) {
    await this.redis.zRem(GEO_KEY, driverId);
    await this.redis.del(`driver:heartbeat:${driverId}`);
  }

  async searchNearbyDrivers(lat: number, lng: number, radiusKm = 5.0): Promise<string[]> {
    // Modern Redis 7 GEOSEARCH replaces legacy GEORADIUS
    const results = await this.redis.geoSearch(
      GEO_KEY,
      { latitude: lat, longitude: lng },
      { radius: radiusKm, unit: 'km' }
    );

    // Filter out drivers whose heartbeat expired or who are not available
    const activeDrivers: string[] = [];
    for (const driverId of results) {
      const isAlive = await this.redis.exists(`driver:heartbeat:${driverId}`);
      let isAvailable = true;
      if (this.presenceService) {
        isAvailable = await this.presenceService.isDriverAvailable(driverId);
      }

      if (isAlive && isAvailable) {
        activeDrivers.push(driverId);
      } else if (!isAlive) {
        // Asynchronously evict stale location
        await this.redis.zRem(GEO_KEY, driverId);
      }
    }

    return activeDrivers;
  }

  getDistanceBetweenPoints(p1: { lat: number; lng: number }, p2: { lat: number; lng: number }): number {
    const R = 6371;
    const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
    const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((p1.lat * Math.PI) / 180) *
        Math.cos((p2.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }
}
