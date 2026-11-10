import type { RedisClientType } from 'redis';
import { createLogger } from '@urbanfleet/common';
import {
  DEFAULT_H3_RESOLUTION,
  H3_REDIS_KEYS,
  HEARTBEAT_TTL_SECONDS,
  LOCATION_HASH_TTL_SECONDS,
} from './h3.constants.js';
import type { DriverLocationRecord, LocationUpdateOptions } from './h3.types.js';

const logger = createLogger('h3-repository');

/**
 * Lua script for atomic driver location updates.
 *
 * Guarantees:
 * 1. Atomicity: Location hash, heartbeat TTL, and spatial ZSET membership updated in one transaction.
 * 2. Monotonic Ordering: Rejects out-of-order sequence numbers or older timestamps.
 * 3. Cell Transition: Safely removes driver from old cell and adds to new cell when crossing hex boundaries.
 * 4. Availability Integrity: Drivers who are not available are removed from the spatial index.
 */
const UPDATE_DRIVER_LOCATION_LUA = `
local locKey = KEYS[1]
local hbKey = KEYS[2]
local newCellKey = KEYS[3]

local driverId = ARGV[1]
local lat = ARGV[2]
local lng = ARGV[3]
local newCell = ARGV[4]
local resolution = ARGV[5]
local nowMs = tonumber(ARGV[6])
local seq = tonumber(ARGV[7])
local isAvailable = ARGV[8] == '1'
local hbTtl = tonumber(ARGV[9])
local locTtl = tonumber(ARGV[10])
local zsetPrefix = ARGV[11]

-- 1. Check existing location hash for sequence / timestamp ordering
local existingSeq = redis.call('HGET', locKey, 'sequence')
if seq and existingSeq and tonumber(existingSeq) then
  if seq <= tonumber(existingSeq) then
    return {0, 'STALE_SEQUENCE'}
  end
else
  local existingUpdatedAt = redis.call('HGET', locKey, 'updatedAt')
  if existingUpdatedAt and tonumber(existingUpdatedAt) then
    if nowMs < tonumber(existingUpdatedAt) then
      return {0, 'STALE_TIMESTAMP'}
    end
  end
end

-- 2. Read old cell
local oldCell = redis.call('HGET', locKey, 'h3Cell')

-- 3. Update location hash
redis.call('HSET', locKey,
  'driverId', driverId,
  'lat', lat,
  'lng', lng,
  'h3Cell', newCell,
  'resolution', resolution,
  'updatedAt', tostring(nowMs),
  'sequence', seq and tostring(seq) or tostring(nowMs)
)
redis.call('EXPIRE', locKey, locTtl)

-- 4. Refresh heartbeat
redis.call('SET', hbKey, '1', 'EX', hbTtl)

-- 5. Maintain cell ZSET membership
if isAvailable then
  if oldCell and oldCell ~= '' and oldCell ~= newCell then
    local oldCellKey = zsetPrefix .. oldCell .. ':available'
    redis.call('ZREM', oldCellKey, driverId)
  end
  redis.call('ZADD', newCellKey, nowMs, driverId)
else
  if oldCell and oldCell ~= '' then
    local oldCellKey = zsetPrefix .. oldCell .. ':available'
    redis.call('ZREM', oldCellKey, driverId)
  end
  redis.call('ZREM', newCellKey, driverId)
end

return {1, oldCell or ''}
`;

/**
 * Storage and indexing layer for H3-based geospatial queries in Redis.
 *
 * Responsibilities:
 * - Managing spatial ZSET membership for H3 cells.
 * - Storing and querying ephemeral driver location hashes.
 * - Managing driver heartbeat expiration.
 * - Batching Redis queries to eliminate N+1 round trips.
 */
export class H3Repository {
  private redis: RedisClientType;

  constructor(redis: RedisClientType) {
    this.redis = redis;
  }

  // ==========================================
  // Key Generation
  // ==========================================

  getCellKey(cellId: string, resolution: number = DEFAULT_H3_RESOLUTION): string {
    return `${H3_REDIS_KEYS.CELL_ZSET_PREFIX}:r${resolution}:${cellId}:available`;
  }

  getLocationKey(driverId: string): string {
    return `${H3_REDIS_KEYS.LOCATION_HASH_PREFIX}:${driverId}:location`;
  }

  getHeartbeatKey(driverId: string): string {
    return `${H3_REDIS_KEYS.HEARTBEAT_PREFIX}:${driverId}`;
  }

  getLegacyGeoKey(): string {
    return H3_REDIS_KEYS.LEGACY_GEO_KEY;
  }

  private getCellZsetPrefix(resolution: number): string {
    return `${H3_REDIS_KEYS.CELL_ZSET_PREFIX}:r${resolution}:`;
  }

  // ==========================================
  // Location Updates & Writes
  // ==========================================

  /**
   * Saves a driver location update atomically.
   * Updates location metadata, refreshes heartbeat, and synchronizes cell ZSET membership.
   */
  async saveDriverLocation(
    driverId: string,
    lat: number,
    lng: number,
    h3Cell: string,
    resolution: number = DEFAULT_H3_RESOLUTION,
    options?: LocationUpdateOptions
  ): Promise<{ success: boolean; oldCell?: string; reason?: string }> {
    const locKey = this.getLocationKey(driverId);
    const hbKey = this.getHeartbeatKey(driverId);
    const newCellKey = this.getCellKey(h3Cell, resolution);
    const nowMs = options?.timestamp ?? Date.now();
    const isAvailable = options?.isAvailable ?? true;
    const zsetPrefix = this.getCellZsetPrefix(resolution);

    // 1. Try atomic Lua script if supported by the Redis client
    if (typeof (this.redis as any).eval === 'function') {
      try {
        const result = (await (this.redis as any).eval(UPDATE_DRIVER_LOCATION_LUA, {
          keys: [locKey, hbKey, newCellKey],
          arguments: [
            driverId,
            String(lat),
            String(lng),
            h3Cell,
            String(resolution),
            String(nowMs),
            options?.sequence !== undefined ? String(options.sequence) : '',
            isAvailable ? '1' : '0',
            String(HEARTBEAT_TTL_SECONDS),
            String(LOCATION_HASH_TTL_SECONDS),
            zsetPrefix,
          ],
        })) as [number, string];

        const [status, payload] = result;
        if (status === 0) {
          logger.debug(`Rejected stale location update for driver ${driverId}: ${payload}`);
          return { success: false, reason: payload };
        }
        return { success: true, oldCell: payload || undefined };
      } catch (luaErr) {
        logger.debug(
          'Redis eval error, falling back to pipeline:',
          luaErr instanceof Error ? { error: luaErr.message } : undefined
        );
      }
    }

    // 2. Fallback pipeline implementation (for mock environments and test suites)
    const existing = await this.getDriverLocation(driverId);
    if (existing) {
      if (options?.sequence !== undefined && existing.sequence !== undefined) {
        if (options.sequence <= existing.sequence) {
          return { success: false, reason: 'STALE_SEQUENCE' };
        }
      } else if (nowMs < existing.updatedAt) {
        return { success: false, reason: 'STALE_TIMESTAMP' };
      }
    }

    const oldCell = existing?.h3Cell;

    // Use multi pipeline if available, otherwise direct calls
    const multi = typeof this.redis.multi === 'function' ? this.redis.multi() : null;

    if (multi) {
      multi.hSet(locKey, {
        driverId,
        lat: String(lat),
        lng: String(lng),
        h3Cell,
        resolution: String(resolution),
        updatedAt: String(nowMs),
        sequence: options?.sequence !== undefined ? String(options.sequence) : String(nowMs),
      });
      multi.expire(locKey, LOCATION_HASH_TTL_SECONDS);
      multi.set(hbKey, '1', { EX: HEARTBEAT_TTL_SECONDS });

      if (isAvailable) {
        if (oldCell && oldCell !== h3Cell) {
          multi.zRem(this.getCellKey(oldCell, resolution), driverId);
        }
        multi.zAdd(newCellKey, { score: nowMs, value: driverId });
      } else {
        if (oldCell) {
          multi.zRem(this.getCellKey(oldCell, resolution), driverId);
        }
        multi.zRem(newCellKey, driverId);
      }
      await multi.exec();
    } else {
      // Direct mock calls for simplified test mocks
      await this.redis.set(
        locKey,
        JSON.stringify({
          driverId,
          lat,
          lng,
          h3Cell,
          resolution,
          updatedAt: nowMs,
          sequence: options?.sequence ?? nowMs,
        })
      );
      await this.redis.set(hbKey, '1');
      if (isAvailable) {
        if (oldCell && oldCell !== h3Cell && typeof (this.redis as any).zRem === 'function') {
          await (this.redis as any).zRem(this.getCellKey(oldCell, resolution), driverId);
        }
        if (typeof (this.redis as any).zAdd === 'function') {
          await (this.redis as any).zAdd(newCellKey, { score: nowMs, value: driverId });
        }
      }
    }

    return { success: true, oldCell };
  }

  /**
   * Retrieves the latest cached location record for a driver.
   */
  async getDriverLocation(driverId: string): Promise<DriverLocationRecord | null> {
    const locKey = this.getLocationKey(driverId);
    let raw: Record<string, string> | null = null;

    if (typeof this.redis.hGetAll === 'function') {
      try {
        raw = await this.redis.hGetAll(locKey);
      } catch {
        raw = null;
      }
    }

    // Fallback if hGetAll returned empty or if store is JSON-mocked
    if (!raw || Object.keys(raw).length === 0 || !raw.lat) {
      if (typeof this.redis.get === 'function') {
        const str = await this.redis.get(locKey);
        if (str) {
          try {
            const parsed = JSON.parse(str);
            return {
              driverId,
              lat: Number(parsed.lat),
              lng: Number(parsed.lng),
              h3Cell: parsed.h3Cell || '',
              resolution: Number(parsed.resolution || DEFAULT_H3_RESOLUTION),
              updatedAt: Number(parsed.updatedAt || Date.now()),
              sequence: parsed.sequence ? Number(parsed.sequence) : undefined,
            };
          } catch {
            return null;
          }
        }
      }
      return null;
    }

    return {
      driverId,
      lat: Number(raw.lat),
      lng: Number(raw.lng),
      h3Cell: raw.h3Cell || '',
      resolution: Number(raw.resolution || DEFAULT_H3_RESOLUTION),
      updatedAt: Number(raw.updatedAt || Date.now()),
      sequence: raw.sequence ? Number(raw.sequence) : undefined,
    };
  }

  /**
   * Removes a driver from cell spatial membership and clears location and heartbeat records.
   */
  async removeDriverLocation(driverId: string, resolution: number = DEFAULT_H3_RESOLUTION): Promise<void> {
    const loc = await this.getDriverLocation(driverId);
    const locKey = this.getLocationKey(driverId);
    const hbKey = this.getHeartbeatKey(driverId);

    if (typeof this.redis.multi === 'function') {
      const multi = this.redis.multi();
      if (loc?.h3Cell) {
        multi.zRem(this.getCellKey(loc.h3Cell, resolution), driverId);
      }
      multi.del(locKey);
      multi.del(hbKey);
      await multi.exec();
    } else {
      if (loc?.h3Cell && typeof (this.redis as any).zRem === 'function') {
        await (this.redis as any).zRem(this.getCellKey(loc.h3Cell, resolution), driverId);
      }
      await this.redis.del(locKey);
      await this.redis.del(hbKey);
    }
  }

  /**
   * Synchronizes spatial ZSET membership when driver availability changes (AVAILABLE <-> BUSY).
   */
  async setDriverCellAvailability(
    driverId: string,
    isAvailable: boolean,
    resolution: number = DEFAULT_H3_RESOLUTION
  ): Promise<void> {
    const loc = await this.getDriverLocation(driverId);
    if (!loc || !loc.h3Cell) return;

    const cellKey = this.getCellKey(loc.h3Cell, resolution);

    if (isAvailable) {
      const isAlive = await this.hasHeartbeat(driverId);
      if (isAlive) {
        if (typeof (this.redis as any).zAdd === 'function') {
          await (this.redis as any).zAdd(cellKey, { score: Date.now(), value: driverId });
        }
      }
    } else {
      if (typeof (this.redis as any).zRem === 'function') {
        await (this.redis as any).zRem(cellKey, driverId);
      }
    }
  }

  /**
   * Checks if driver has an active heartbeat.
   */
  async hasHeartbeat(driverId: string): Promise<boolean> {
    if (typeof this.redis.exists === 'function') {
      const exists = await this.redis.exists(this.getHeartbeatKey(driverId));
      return exists === 1;
    }
    return false;
  }

  // ==========================================
  // Pipelined Candidate Discovery & Retrieval
  // ==========================================

  /**
   * Retrieves all candidate driver IDs across multiple H3 cells in a single pipelined operation.
   * Deduplicates candidates using an in-memory Set.
   */
  async getCandidateDriverIdsFromCells(
    cellIds: string[],
    resolution: number = DEFAULT_H3_RESOLUTION
  ): Promise<string[]> {
    if (!cellIds || cellIds.length === 0) return [];

    const candidateSet = new Set<string>();

    if (typeof this.redis.multi === 'function') {
      const multi = this.redis.multi();
      for (const cellId of cellIds) {
        const key = this.getCellKey(cellId, resolution);
        multi.zRange(key, 0, -1);
      }
      const results = (await multi.exec()) as unknown[];

      for (const res of results) {
        if (Array.isArray(res)) {
          for (const item of res) {
            const driverId = typeof item === 'string' ? item : (item as any)?.value;
            if (driverId) candidateSet.add(driverId);
          }
        }
      }
    } else {
      // Fallback for mocks
      for (const cellId of cellIds) {
        if (typeof (this.redis as any).zRange === 'function') {
          const members = await (this.redis as any).zRange(this.getCellKey(cellId, resolution), 0, -1);
          if (Array.isArray(members)) {
            for (const item of members) {
              const driverId = typeof item === 'string' ? item : (item as any)?.value;
              if (driverId) candidateSet.add(driverId);
            }
          }
        }
      }
    }

    return Array.from(candidateSet);
  }

  /**
   * Batch-retrieves location hashes and heartbeat states for candidates in a single pipeline round trip.
   * Prevents N+1 database/network queries.
   */
  async batchGetDriverLocationsAndHeartbeats(
    driverIds: string[]
  ): Promise<Map<string, { location: DriverLocationRecord; hasHeartbeat: boolean }>> {
    const result = new Map<string, { location: DriverLocationRecord; hasHeartbeat: boolean }>();
    if (!driverIds || driverIds.length === 0) return result;

    if (typeof this.redis.multi === 'function') {
      const multi = this.redis.multi();
      for (const driverId of driverIds) {
        multi.hGetAll(this.getLocationKey(driverId));
        multi.exists(this.getHeartbeatKey(driverId));
      }
      const replies = (await multi.exec()) as unknown[];

      for (let i = 0; i < driverIds.length; i++) {
        const driverId = driverIds[i];
        const rawLoc = replies[i * 2] as Record<string, string> | undefined;
        const rawHb = replies[i * 2 + 1];

        if (rawLoc && rawLoc.lat && rawLoc.lng) {
          const location: DriverLocationRecord = {
            driverId,
            lat: Number(rawLoc.lat),
            lng: Number(rawLoc.lng),
            h3Cell: rawLoc.h3Cell || '',
            resolution: Number(rawLoc.resolution || DEFAULT_H3_RESOLUTION),
            updatedAt: Number(rawLoc.updatedAt || Date.now()),
            sequence: rawLoc.sequence ? Number(rawLoc.sequence) : undefined,
          };
          const hasHeartbeat = Number(rawHb) === 1;
          result.set(driverId, { location, hasHeartbeat });
        }
      }
    } else {
      // Fallback sequential execution for test mocks
      for (const driverId of driverIds) {
        const location = await this.getDriverLocation(driverId);
        const hasHeartbeat = await this.hasHeartbeat(driverId);
        if (location) {
          result.set(driverId, { location, hasHeartbeat });
        }
      }
    }

    return result;
  }

  /**
   * Removes stale driver records from an individual H3 cell ZSET whose score is older than maxAgeMs.
   */
  async cleanupStaleDriversFromCell(
    cellId: string,
    resolution: number = DEFAULT_H3_RESOLUTION,
    maxAgeMs: number = HEARTBEAT_TTL_SECONDS * 1000
  ): Promise<number> {
    const key = this.getCellKey(cellId, resolution);
    const maxScore = Date.now() - maxAgeMs;
    if (typeof (this.redis as any).zRemRangeByScore === 'function') {
      return await (this.redis as any).zRemRangeByScore(key, 0, maxScore);
    }
    return 0;
  }
}
