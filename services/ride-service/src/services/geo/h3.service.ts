import {
  latLngToCell as h3LatLngToCell,
  cellToLatLng as h3CellToLatLng,
  gridDisk as h3GridDisk,
  greatCircleDistance as h3GreatCircleDistance,
  isValidCell as h3IsValidCell,
  getHexagonEdgeLengthAvg,
  getHexagonAreaAvg,
  UNITS,
} from 'h3-js';
import {
  DEFAULT_H3_RESOLUTION,
  MAX_SEARCH_RADIUS_KM,
  SUPPORTED_H3_RESOLUTIONS,
  type SupportedH3Resolution,
} from './h3.constants.js';
import type { Coordinates, H3CellInfo } from './h3.types.js';

/**
 * Pure geospatial computation service powered by Uber's H3 hierarchical indexing.
 *
 * Responsibilities:
 * - Coordinates <-> H3 cell conversions.
 * - Conservative radius-to-cell coverage calculations (safe against false negatives).
 * - Exact great-circle geographic distance calculations.
 * - Spatial cell validation and resolution configurations.
 *
 * Note: This service contains zero Redis or database logic.
 */
export class H3Service {
  private resolution: number;

  constructor(resolution: number = DEFAULT_H3_RESOLUTION) {
    this.resolution = this.validateResolution(resolution);
  }

  getResolution(): number {
    return this.resolution;
  }

  setResolution(resolution: number): void {
    this.resolution = this.validateResolution(resolution);
  }

  private validateResolution(res: number): number {
    if (!Number.isInteger(res) || res < 0 || res > 15) {
      throw new Error(`Invalid H3 resolution: ${res}. Must be an integer between 0 and 15.`);
    }
    return res;
  }

  /**
   * Validates latitude and longitude ranges.
   * Throws an error if coordinates are NaN, Infinite, or out of standard WGS84 bounds.
   */
  validateCoordinates(lat: number, lng: number): void {
    if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new Error(`Invalid latitude: ${lat}. Must be a finite number between -90 and 90.`);
    }
    if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new Error(`Invalid longitude: ${lng}. Must be a finite number between -180 and 180.`);
    }
  }

  /**
   * Indexes a geographic coordinate (lat, lng) to an H3 cell identifier.
   */
  latLngToCell(lat: number, lng: number, resolution: number = this.resolution): string {
    this.validateCoordinates(lat, lng);
    const res = this.validateResolution(resolution);
    return h3LatLngToCell(lat, lng, res);
  }

  /**
   * Calculates the centroid coordinate (lat, lng) of an H3 cell.
   */
  cellToLatLng(cellId: string): Coordinates {
    if (!this.isValidCell(cellId)) {
      throw new Error(`Invalid H3 cell index: ${cellId}`);
    }
    const [lat, lng] = h3CellToLatLng(cellId);
    return { lat, lng };
  }

  /**
   * Returns cell metadata including resolution and centroid coordinates.
   */
  getCellInfo(cellId: string): H3CellInfo {
    const center = this.cellToLatLng(cellId);
    return {
      cellId,
      resolution: this.resolution,
      center,
    };
  }

  /**
   * Checks whether a string represents a valid H3 cell identifier.
   */
  isValidCell(cellId: string): boolean {
    return typeof cellId === 'string' && cellId.length > 0 && h3IsValidCell(cellId);
  }

  /**
   * Computes the exact great-circle distance between two geographic points in kilometers.
   */
  getDistanceKm(p1: Coordinates, p2: Coordinates): number {
    this.validateCoordinates(p1.lat, p1.lng);
    this.validateCoordinates(p2.lat, p2.lng);
    return h3GreatCircleDistance([p1.lat, p1.lng], [p2.lat, p2.lng], UNITS.km);
  }

  /**
   * Returns the average hexagon edge length in kilometers for a given resolution.
   */
  getHexagonEdgeLength(resolution: number = this.resolution): number {
    return getHexagonEdgeLengthAvg(this.validateResolution(resolution), UNITS.km);
  }

  /**
   * Returns the average hexagon area in square kilometers for a given resolution.
   */
  getHexagonArea(resolution: number = this.resolution): number {
    return getHexagonAreaAvg(this.validateResolution(resolution), UNITS.km2);
  }

  /**
   * Conservative Radius-to-Cell Coverage Strategy
   *
   * Problem:
   * `gridDisk(cell, k)` traverses grid steps (hexagonal rings), NOT kilometers.
   * Treating grid steps as kilometers would cause catastrophic under-coverage
   * (e.g. gridDisk(cell, 5) at resolution 9 only covers ~1.5 km!).
   *
   * Solution & Mathematical Safety Guarantee:
   * 1. At resolution `r`, the average hexagon edge length is $L = \text{getHexagonEdgeLengthAvg}(r)$.
   * 2. The in-radius (distance from cell center to edge midpoint) of a regular hexagon is:
   *    $r_{\text{in}} = L \cdot \frac{\sqrt{3}}{2} \approx 0.866 \cdot L$
   * 3. The center-to-center distance between two adjacent hexagons in the grid is:
   *    $d_{\text{adj}} = 2 \cdot r_{\text{in}} = \sqrt{3} \cdot L \approx 1.732 \cdot L$
   * 4. Due to Earth's spherical projection onto an icosahedron, individual hexagon edge lengths
   *    vary across faces by up to ~15%. To guard against the worst-case compressed hexagon,
   *    we bound the minimum effective step distance conservatively:
   *    $d_{\text{step, min}} = L \cdot \sqrt{3} \cdot 0.85 \approx 1.472 \cdot L$
   * 5. An eligible driver at distance $R$ might reside in a hexagon whose center is at distance
   *    up to $R + R_{\text{circum}} = R + L$ from the pickup coordinate.
   * 6. Therefore, the minimum number of rings $k$ required to guarantee 100% coverage
   *    (zero false negatives) is:
   *    $k = \left\lceil \frac{R}{d_{\text{step, min}}} \right\rceil + 1$
   * 7. Post-retrieval, candidate drivers fetched from these cells are strictly filtered
   *    by exact great-circle distance ($d \le R$). This guarantees zero false negatives
   *    while eliminating false positives.
   */
  getCellsCoveringRadius(
    lat: number,
    lng: number,
    radiusKm: number,
    resolution: number = this.resolution
  ): string[] {
    this.validateCoordinates(lat, lng);
    const res = this.validateResolution(resolution);

    if (typeof radiusKm !== 'number' || !Number.isFinite(radiusKm) || radiusKm <= 0) {
      throw new Error(`Search radius must be a positive number. Received: ${radiusKm}`);
    }

    if (radiusKm > MAX_SEARCH_RADIUS_KM) {
      throw new Error(
        `Search radius ${radiusKm}km exceeds maximum allowed limit of ${MAX_SEARCH_RADIUS_KM}km.`
      );
    }

    // 1. Find origin center cell
    const originCell = this.latLngToCell(lat, lng, res);

    // 2. Calculate average edge length in km
    const edgeLengthKm = this.getHexagonEdgeLength(res);

    // 3. Conservative minimal center-to-center step with 15% distortion margin
    const minCenterStepKm = edgeLengthKm * Math.sqrt(3) * 0.85;

    // 4. Required grid ring distance k with boundary buffer (+1)
    const kRings = Math.max(1, Math.ceil(radiusKm / minCenterStepKm) + 1);

    // 5. Retrieve all cells in the disk
    const cells = h3GridDisk(originCell, kRings);

    return cells;
  }
}
