import { describe, expect, it, beforeEach } from 'vitest';
import { H3Repository } from '../src/services/geo/h3.repository.js';
import { DEFAULT_H3_RESOLUTION } from '../src/services/geo/h3.constants.js';

describe('H3Repository Redis Storage & Indexing Suite', () => {
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

  let repo: H3Repository;

  beforeEach(() => {
    store.clear();
    zsets.clear();
    repo = new H3Repository(mockRedis);
  });

  it('generates consistent, well-formed Redis keys', () => {
    expect(repo.getCellKey('8960145b483ffff', 9)).toBe('drivers:h3:r9:8960145b483ffff:available');
    expect(repo.getLocationKey('drv-101')).toBe('driver:drv-101:location');
    expect(repo.getHeartbeatKey('drv-101')).toBe('driver:heartbeat:drv-101');
  });

  it('saves driver location and maintains cell ZSET membership and heartbeat', async () => {
    const res = await repo.saveDriverLocation('drv-101', 12.9716, 77.5946, 'cell-A', 9, {
      sequence: 1,
      isAvailable: true,
    });

    expect(res.success).toBe(true);
    expect(await repo.hasHeartbeat('drv-101')).toBe(true);

    const loc = await repo.getDriverLocation('drv-101');
    expect(loc).toBeDefined();
    expect(loc?.driverId).toBe('drv-101');
    expect(loc?.lat).toBe(12.9716);
    expect(loc?.lng).toBe(77.5946);
    expect(loc?.h3Cell).toBe('cell-A');
    expect(loc?.sequence).toBe(1);

    // Should be member of cell-A's available ZSET
    const driversInCellA = await repo.getCandidateDriverIdsFromCells(['cell-A'], 9);
    expect(driversInCellA).toContain('drv-101');
  });

  it('rejects stale or out-of-order sequence updates', async () => {
    // 1. Initial update with sequence 10
    await repo.saveDriverLocation('drv-seq', 12.97, 77.59, 'cell-A', 9, { sequence: 10 });

    // 2. Out-of-order update with sequence 5 (older)
    const staleResult = await repo.saveDriverLocation('drv-seq', 12.98, 77.60, 'cell-B', 9, {
      sequence: 5,
    });
    expect(staleResult.success).toBe(false);
    expect(staleResult.reason).toBe('STALE_SEQUENCE');

    // Location must still be the sequence 10 data
    const current = await repo.getDriverLocation('drv-seq');
    expect(current?.sequence).toBe(10);
    expect(current?.h3Cell).toBe('cell-A');
  });

  it('handles movement across H3 cells (removes from old cell, adds to new cell)', async () => {
    // 1. Driver in cell-A
    await repo.saveDriverLocation('drv-move', 12.97, 77.59, 'cell-A', 9, { sequence: 1 });
    expect(await repo.getCandidateDriverIdsFromCells(['cell-A'], 9)).toContain('drv-move');

    // 2. Driver moves to cell-B
    const moveRes = await repo.saveDriverLocation('drv-move', 12.98, 77.60, 'cell-B', 9, { sequence: 2 });
    expect(moveRes.success).toBe(true);
    expect(moveRes.oldCell).toBe('cell-A');

    // Must be removed from cell-A and present in cell-B
    expect(await repo.getCandidateDriverIdsFromCells(['cell-A'], 9)).not.toContain('drv-move');
    expect(await repo.getCandidateDriverIdsFromCells(['cell-B'], 9)).toContain('drv-move');
  });

  it('manages driver availability: removes from cell ZSET when BUSY, restores when AVAILABLE', async () => {
    await repo.saveDriverLocation('drv-avail', 12.97, 77.59, 'cell-A', 9);
    expect(await repo.getCandidateDriverIdsFromCells(['cell-A'], 9)).toContain('drv-avail');

    // 1. Driver becomes BUSY
    await repo.setDriverCellAvailability('drv-avail', false, 9);
    expect(await repo.getCandidateDriverIdsFromCells(['cell-A'], 9)).not.toContain('drv-avail');
    // Location hash still remains for tracking
    expect(await repo.getDriverLocation('drv-avail')).not.toBeNull();

    // 2. Driver becomes AVAILABLE again
    await repo.setDriverCellAvailability('drv-avail', true, 9);
    expect(await repo.getCandidateDriverIdsFromCells(['cell-A'], 9)).toContain('drv-avail');
  });

  it('removes driver location completely on clean removal', async () => {
    await repo.saveDriverLocation('drv-rem', 12.97, 77.59, 'cell-A', 9);
    expect(await repo.getCandidateDriverIdsFromCells(['cell-A'], 9)).toContain('drv-rem');

    await repo.removeDriverLocation('drv-rem', 9);
    expect(await repo.getDriverLocation('drv-rem')).toBeNull();
    expect(await repo.hasHeartbeat('drv-rem')).toBe(false);
    expect(await repo.getCandidateDriverIdsFromCells(['cell-A'], 9)).not.toContain('drv-rem');
  });

  it('batch-fetches location hashes and heartbeats for multiple candidates in a single call', async () => {
    await repo.saveDriverLocation('drv-1', 12.91, 77.51, 'c1', 9);
    await repo.saveDriverLocation('drv-2', 12.92, 77.52, 'c2', 9);
    await repo.saveDriverLocation('drv-3', 12.93, 77.53, 'c3', 9);

    const batch = await repo.batchGetDriverLocationsAndHeartbeats(['drv-1', 'drv-2', 'drv-3', 'drv-missing']);
    expect(batch.size).toBe(3);

    expect(batch.get('drv-1')?.location.lat).toBe(12.91);
    expect(batch.get('drv-1')?.hasHeartbeat).toBe(true);

    expect(batch.get('drv-2')?.location.lat).toBe(12.92);
    expect(batch.get('drv-2')?.hasHeartbeat).toBe(true);

    expect(batch.has('drv-missing')).toBe(false);
  });
});
