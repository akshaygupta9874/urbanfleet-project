import { describe, expect, it, beforeEach } from 'vitest';
import { GeoService } from '../src/services/geo.service.js';
import { DriverPresenceService } from '../src/services/driver-presence.service.js';

describe('GeoService Facade & End-to-End Discovery Suite', () => {
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

  const pickup = { lat: 12.9716, lng: 77.5946 }; // MG Road
  const closeDriver = { lat: 12.9730, lng: 77.5960 }; // ~200m away
  const midDriver = { lat: 12.9800, lng: 77.6000 }; // ~1.1 km away
  const farDriver = { lat: 12.8500, lng: 77.5000 }; // ~16 km away (outside 5km)

  beforeEach(async () => {
    store.clear();
    zsets.clear();
    geoService = new GeoService(mockRedis, undefined, { engineMode: 'h3', resolution: 9 });
    presenceService = new DriverPresenceService(mockRedis, geoService);
    geoService.setPresenceService(presenceService);
  });

  it('manages driver location updates and coordinate lookups', async () => {
    await geoService.updateDriverLocation('drv-1', closeDriver.lat, closeDriver.lng);

    const loc = await geoService.getDriverLocation('drv-1');
    expect(loc).toBeDefined();
    expect(loc?.lat).toBeCloseTo(closeDriver.lat, 4);
    expect(loc?.lng).toBeCloseTo(closeDriver.lng, 4);

    await geoService.removeDriverLocation('drv-1');
    expect(await geoService.getDriverLocation('drv-1')).toBeNull();
  });

  it('searches nearby drivers, sorts by closest distance, and filters out drivers outside the radius', async () => {
    // Set all drivers as online & available
    await presenceService.setDriverAvailable('drv-close', true);
    await presenceService.setDriverAvailable('drv-mid', true);
    await presenceService.setDriverAvailable('drv-far', true);

    await geoService.updateDriverLocation('drv-close', closeDriver.lat, closeDriver.lng);
    await geoService.updateDriverLocation('drv-mid', midDriver.lat, midDriver.lng);
    await geoService.updateDriverLocation('drv-far', farDriver.lat, farDriver.lng);

    // Search within 3.0 km
    const results = await geoService.searchNearbyDrivers(pickup.lat, pickup.lng, 3.0);

    // drv-close (~0.2km) and drv-mid (~1.1km) should be returned, drv-far (~16km) excluded
    expect(results).toContain('drv-close');
    expect(results).toContain('drv-mid');
    expect(results).not.toContain('drv-far');

    // drv-close is closer than drv-mid, so it should be first in the array
    expect(results[0]).toBe('drv-close');
    expect(results[1]).toBe('drv-mid');
  });

  it('excludes drivers whose heartbeat has expired', async () => {
    await presenceService.setDriverAvailable('drv-alive', true);
    await presenceService.setDriverAvailable('drv-dead', true);

    await geoService.updateDriverLocation('drv-alive', closeDriver.lat, closeDriver.lng);
    await geoService.updateDriverLocation('drv-dead', midDriver.lat, midDriver.lng);

    // Simulate expired heartbeat for drv-dead by deleting heartbeat key
    await mockRedis.del('driver:heartbeat:drv-dead');

    const results = await geoService.searchNearbyDrivers(pickup.lat, pickup.lng, 5.0);
    expect(results).toContain('drv-alive');
    expect(results).not.toContain('drv-dead');
  });

  it('excludes unavailable or busy drivers', async () => {
    await presenceService.setDriverAvailable('drv-avail', true);
    await presenceService.setDriverBusy('drv-busy');

    await geoService.updateDriverLocation('drv-avail', closeDriver.lat, closeDriver.lng);
    await geoService.updateDriverLocation('drv-busy', midDriver.lat, midDriver.lng);

    const results = await geoService.searchNearbyDrivers(pickup.lat, pickup.lng, 5.0);
    expect(results).toContain('drv-avail');
    expect(results).not.toContain('drv-busy');
  });

  it('returns empty array when no drivers exist in search radius', async () => {
    const results = await geoService.searchNearbyDrivers(pickup.lat, pickup.lng, 1.0);
    expect(results).toEqual([]);
  });

  it('computes accurate geodesic distance between points', () => {
    const dist = geoService.getDistanceBetweenPoints(pickup, closeDriver);
    expect(dist).toBeGreaterThan(0.15);
    expect(dist).toBeLessThan(0.30);
  });
});
