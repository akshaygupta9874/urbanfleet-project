import { describe, expect, it, beforeEach } from 'vitest';
import { DriverPresenceService } from '../src/services/driver-presence.service.js';
import { GeoService } from '../src/services/geo.service.js';

describe('DriverPresenceService and Geo Filtering Suite', () => {
  const redisStore = new Map<string, string>();
  const mockRedis: any = {
    get: async (key: string) => redisStore.get(key) || null,
    set: async (key: string, val: string) => {
      redisStore.set(key, val);
      return 'OK';
    },
    del: async (key: string) => {
      const existed = redisStore.has(key);
      redisStore.delete(key);
      return existed ? 1 : 0;
    },
    exists: async (key: string) => (redisStore.has(key) ? 1 : 0),
    geoAdd: async () => 1,
    geoPos: async () => [{ latitude: 12.97, longitude: 77.59 }],
    zRem: async () => 1,
    geoSearch: async () => ['driver-1', 'driver-2', 'driver-3'],
  };

  let geoService: GeoService;
  let presenceService: DriverPresenceService;

  beforeEach(() => {
    redisStore.clear();
    geoService = new GeoService(mockRedis);
    presenceService = new DriverPresenceService(mockRedis, geoService);
    geoService.setPresenceService(presenceService);
  });

  it('manages full presence lifecycle: online, available, busy, offline', async () => {
    const driverId = 'drv-presence-test';

    // 1. Initially offline
    expect(await presenceService.isDriverOnline(driverId)).toBe(false);
    expect(await presenceService.isDriverAvailable(driverId)).toBe(false);

    // 2. Set Online
    const onlinePresence = await presenceService.setDriverOnline(driverId);
    expect(onlinePresence.online).toBe(true);
    expect(onlinePresence.available).toBe(false);
    expect(await presenceService.isDriverOnline(driverId)).toBe(true);
    expect(await presenceService.isDriverAvailable(driverId)).toBe(false);

    // 3. Set Available
    const availablePresence = await presenceService.setDriverAvailable(driverId, true);
    expect(availablePresence.online).toBe(true);
    expect(availablePresence.available).toBe(true);
    expect(await presenceService.isDriverAvailable(driverId)).toBe(true);

    // 4. Set Busy
    const busyPresence = await presenceService.setDriverBusy(driverId);
    expect(busyPresence.online).toBe(true);
    expect(busyPresence.available).toBe(false);
    expect(await presenceService.isDriverAvailable(driverId)).toBe(false);

    // 5. Update Heartbeat
    const hbPresence = await presenceService.updateHeartbeat(driverId);
    expect(hbPresence).not.toBeNull();
    expect(hbPresence?.online).toBe(true);

    // 6. Set Offline
    await presenceService.setDriverOffline(driverId);
    expect(await presenceService.isDriverOnline(driverId)).toBe(false);
    expect(await presenceService.isDriverAvailable(driverId)).toBe(false);
  });

  it('filters nearby drivers in GeoService: only active AND available drivers returned', async () => {
    // driver-1: online and available with heartbeat
    await presenceService.setDriverAvailable('driver-1', true);
    await mockRedis.set('driver:heartbeat:driver-1', '1');

    // driver-2: online but BUSY (not available) with heartbeat
    await presenceService.setDriverBusy('driver-2');
    await mockRedis.set('driver:heartbeat:driver-2', '1');

    // driver-3: heartbeat expired (stale)
    await presenceService.setDriverAvailable('driver-3', true);
    await mockRedis.del('driver:heartbeat:driver-3');

    const candidates = await geoService.searchNearbyDrivers(12.9716, 77.5946, 5.0);

    // Only driver-1 should match!
    expect(candidates).toEqual(['driver-1']);
  });
});
