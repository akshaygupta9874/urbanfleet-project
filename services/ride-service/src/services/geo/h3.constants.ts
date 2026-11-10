/**
 * H3 Geospatial Indexing Constants for UrbanFleet
 *
 * Centralizes H3 resolutions, Redis spatial key structures, heartbeat intervals,
 * and spatial search boundary configurations.
 */

/**
 * Default H3 grid resolution for UrbanFleet urban driver indexing.
 *
 * Resolution 9 characteristics:
 * - Average hexagon area: ~0.105 km² (~105,000 m²)
 * - Average edge length: ~0.201 km (~201 meters)
 * - Average hexagon diameter / center-to-center distance: ~0.35 km
 *
 * Why Resolution 9 is the default:
 * Resolution 9 provides the optimal spatial granularity for urban ride-hailing:
 * it roughly corresponds to 1-2 standard urban city blocks. This keeps individual
 * cell ZSETs small (~10-50 drivers in dense metropolitan centers) while keeping
 * the total number of cells for a 5 km dispatch radius within a manageable
 * candidate pool (~800-900 cells), well within Redis pipeline performance budgets.
 */
export const DEFAULT_H3_RESOLUTION = 9;

/**
 * Supported resolutions for benchmarking and multi-tier spatial indexing.
 * - Res 8: suburban/intercity (~0.74 km² area, edge ~461m)
 * - Res 9: urban core default (~0.105 km² area, edge ~201m)
 * - Res 10: high-density micro-zones (~0.015 km² area, edge ~76m)
 */
export const SUPPORTED_H3_RESOLUTIONS = [8, 9, 10] as const;
export type SupportedH3Resolution = (typeof SUPPORTED_H3_RESOLUTIONS)[number];

/**
 * Driver heartbeat TTL in seconds.
 * Matches UrbanFleet presence convention (60 seconds).
 */
export const HEARTBEAT_TTL_SECONDS = 60;

/**
 * Driver location metadata hash TTL in seconds (5 minutes).
 * Preserves the latest coordinates even if the driver is momentarily BUSY,
 * but evicts records if the driver has completely vanished without a clean disconnect.
 */
export const LOCATION_HASH_TTL_SECONDS = 300;

/**
 * Default nearby search radius in kilometers.
 */
export const DEFAULT_SEARCH_RADIUS_KM = 5.0;

/**
 * Maximum permissible search radius in kilometers to prevent denial-of-service.
 */
export const MAX_SEARCH_RADIUS_KM = 50.0;

/**
 * Redis key prefixes for H3 spatial indexing.
 */
export const H3_REDIS_KEYS = {
  /**
   * ZSET of available drivers for a specific H3 cell:
   * Pattern: `drivers:h3:r<resolution>:<cellId>:available`
   * Member: driverId, Score: last update timestamp (ms)
   */
  CELL_ZSET_PREFIX: 'drivers:h3',

  /**
   * Location Hash for a specific driver:
   * Pattern: `driver:<driverId>:location`
   * Fields: driverId, lat, lng, h3Cell, resolution, updatedAt, sequence
   */
  LOCATION_HASH_PREFIX: 'driver',

  /**
   * Heartbeat key for driver freshness:
   * Pattern: `driver:heartbeat:<driverId>`
   */
  HEARTBEAT_PREFIX: 'driver:heartbeat',

  /**
   * Legacy Redis GEO key for dual-indexing / rollback compatibility:
   */
  LEGACY_GEO_KEY: 'ride:drivers:locations',
} as const;
