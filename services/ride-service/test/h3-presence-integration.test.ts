import { describe, expect, it, beforeEach } from 'vitest';
import { GeoService } from '../src/services/geo.service.js';
import { DriverPresenceService } from '../src/services/driver-presence.service.js';

describe('H3 Spatial Index & Driver Presence State Transitions Suite', () => {
  const store = new Map<string, any>();
  const zsets = new Map<string, Map<string, number>>();

  const mockRedis: any = {
    get: async (k: string) => store.get(k) || null,
    set: async (k: string, v: string) => {
      store.set(k, v);
      return 'OK';
    },
    del: async (k: string) => {
      const existed = store.has(k) || zsets.has(k);
      store.delete(k);
      zsets.delete(k);
      return existed ? 1 : 0;
    },
    exists: async (k: string) => (store.has(k) ? 1 : 0),
    hSet: async (k: string, fields: Record<string, string>) => {
      const existing = store.get(k) || {};
      store.set(k, { ...existing, ...fields });
      return Object.keys(fields).length;
    },
    hGet: async (k: string, field: string) => {
      const obj = store.get(k);
      return obj ? obj[field] ?? null : null;
    },
    hGetAll: async (k: string) => {
      return store.get(k) || {};
    },
    expire: async () => 1,
    zAdd: async (k: string, entry: { score: number; value: string }) => {
      if (!zsets.has(k)) zsets.set(k, new Map());
      zsets.get(k)!.set(entry.value, entry.score);
      return 1;
    },
    zRem: async (k: string, member: string) => {
      if (!zsets.has(k)) return 0;
      const existed = zsets.get(k)!.delete(member);
      return existed ? 1 : 0;
    },
    zRange: async (k: string) => {
      if (!zsets.has(k)) return [];
      return Array.from(zsets.get(k)!.keys());
    },
    multi: () => {
      const operations: (() => Promise<any>)[] = [];
      const multiProxy = {
        hSet: (k: string, fields: any) => {
          operations.push(() => mockRedis.hSet(k, fields));
          return multiProxy;
        },
        expire: (k: string, ttl: number) => {
          operations.push(() => mockRedis.expire(k, ttl));
          return multiProxy;
        },
        set: (k: string, v: string, opts?: any) => {
          operations.push(() => mockRedis.set(k, v, opts));
          return multiProxy;
        },
        del: (k: string) => {
          operations.push(() => mockRedis.del(k));
          return multiProxy;
        },
        hGetAll: (k: string) => {
          operations.push(() => mockRedis.hGetAll(k));
          return multiProxy;
        },
        exists: (k: string) => {
          operations.push(() => mockRedis.exists(k));
          return multiProxy;
        },
        zAdd: (k: string, entry: any) => {
          operations.push(() => mockRedis.zAdd(k, entry));
          return multiProxy;
        },
        zRem: (k: string, member: string) => {
          operations.push(() => mockRedis.zRem(k, member));
          return multiProxy;
        },
        zRange: (k: string) => {
          operations.push(() => mockRedis.zRange(k));
          return multiProxy;
        },
        exec: async () => {
          const results = [];
          for (const op of operations) {
            results.push(await op());
          }
          return results;
        },
      };
      return multiProxy;
    },
  };

  let geoService: GeoService;
  let presenceService: DriverPresenceService;

  const testCoords = { lat: 12.9716, lng: 77.5946 };
  const driverId = 'drv-lifecycle-1';

  beforeEach(() => {
    store.clear();
    zsets.clear();
    geoService = new GeoService(mockRedis, undefined, { engineMode: 'h3', resolution: 9 });
    presenceService = new DriverPresenceService(mockRedis, geoService);
    geoService.setPresenceService(presenceService);
  });

  it('handles complete presence lifecycle: Online -> Available -> Busy -> Available -> Offline', async () => {
    // 1. Driver goes ONLINE (not available yet)
    await presenceService.setDriverOnline(driverId);
    await geoService.updateDriverLocation(driverId, testCoords.lat, testCoords.lng);

    // Not available yet, so searchNearbyDrivers should NOT return them
    let nearby = await geoService.searchNearbyDrivers(testCoords.lat, testCoords.lng, 2.0);
    expect(nearby).not.toContain(driverId);

    // 2. Driver sets AVAILABLE
    await presenceService.setDriverAvailable(driverId, true);
    nearby = await geoService.searchNearbyDrivers(testCoords.lat, testCoords.lng, 2.0);
    expect(nearby).toContain(driverId);

    // 3. Driver accepts a ride -> sets BUSY
    // Must immediately be evicted from available dispatch spatial index
    await presenceService.setDriverBusy(driverId);
    nearby = await geoService.searchNearbyDrivers(testCoords.lat, testCoords.lng, 2.0);
    expect(nearby).not.toContain(driverId);

    // BUT their location hash must remain intact for active trip navigation!
    const activeLoc = await geoService.getDriverLocation(driverId);
    expect(activeLoc).toBeDefined();
    expect(activeLoc?.lat).toBeCloseTo(testCoords.lat, 4);

    // 4. Trip completes -> Driver sets AVAILABLE again
    // Must restore spatial index membership from cached location
    await presenceService.setDriverAvailable(driverId, true);
    nearby = await geoService.searchNearbyDrivers(testCoords.lat, testCoords.lng, 2.0);
    expect(nearby).toContain(driverId);

    // 5. Driver goes OFFLINE
    // Clears spatial index and removes heartbeat
    await presenceService.setDriverOffline(driverId);
    nearby = await geoService.searchNearbyDrivers(testCoords.lat, testCoords.lng, 2.0);
    expect(nearby).not.toContain(driverId);
    expect(await geoService.getDriverLocation(driverId)).toBeNull();
  });
});
