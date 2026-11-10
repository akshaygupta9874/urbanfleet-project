/**
 * H3 Geospatial Type Definitions for UrbanFleet
 */

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface DriverLocationRecord {
  driverId: string;
  lat: number;
  lng: number;
  h3Cell: string;
  resolution: number;
  updatedAt: number;
  sequence?: number;
}

export interface CandidateDriver {
  driverId: string;
  lat: number;
  lng: number;
  h3Cell: string;
  distanceKm: number;
  updatedAt: number;
}

export interface GeoSearchOptions {
  radiusKm?: number;
  resolution?: number;
  maxCandidates?: number;
  requireAvailable?: boolean;
}

export interface LocationUpdateOptions {
  sequence?: number;
  timestamp?: number;
  isAvailable?: boolean;
}

export interface H3CellInfo {
  cellId: string;
  resolution: number;
  center: Coordinates;
}

export type SpatialEngineMode = 'h3' | 'dual' | 'redis-geo';
