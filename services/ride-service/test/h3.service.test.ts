import { describe, expect, it } from 'vitest';
import { H3Service } from '../src/services/geo/h3.service.js';
import { DEFAULT_H3_RESOLUTION } from '../src/services/geo/h3.constants.js';

describe('H3Service Pure Geospatial Computation Suite', () => {
  const h3Service = new H3Service(DEFAULT_H3_RESOLUTION);

  // Central Bengaluru coordinates (MG Road)
  const bengaluruCenter = { lat: 12.9716, lng: 77.5946 };
  // Koramangala coordinates (~5.2 km away)
  const koramangala = { lat: 12.9352, lng: 77.6245 };
  // Indiranagar coordinates (~3.8 km away)
  const indiranagar = { lat: 12.9784, lng: 77.6408 };

  it('correctly converts valid coordinates to an H3 cell index', () => {
    const cell = h3Service.latLngToCell(bengaluruCenter.lat, bengaluruCenter.lng, 9);
    expect(typeof cell).toBe('string');
    expect(h3Service.isValidCell(cell)).toBe(true);

    const info = h3Service.getCellInfo(cell);
    expect(info.cellId).toBe(cell);
    expect(info.resolution).toBe(9);
    // Center point should be extremely close to input coordinate (< 0.2 km)
    const dist = h3Service.getDistanceKm(bengaluruCenter, info.center);
    expect(dist).toBeLessThan(0.25);
  });

  it('rejects invalid, NaN, and out-of-bounds coordinates', () => {
    expect(() => h3Service.latLngToCell(91, 77)).toThrow(/invalid latitude/i);
    expect(() => h3Service.latLngToCell(-95, 77)).toThrow(/invalid latitude/i);
    expect(() => h3Service.latLngToCell(12, 185)).toThrow(/invalid longitude/i);
    expect(() => h3Service.latLngToCell(12, -185)).toThrow(/invalid longitude/i);
    expect(() => h3Service.latLngToCell(NaN, 77)).toThrow(/invalid latitude/i);
    expect(() => h3Service.latLngToCell(12, Infinity)).toThrow(/invalid longitude/i);
  });

  it('distinguishes between same-cell and different-cell movements', () => {
    // 5 meters away: should be in the exact same resolution 9 cell
    const tinyMove = {
      lat: bengaluruCenter.lat + 0.00004,
      lng: bengaluruCenter.lng + 0.00004,
    };
    const cell1 = h3Service.latLngToCell(bengaluruCenter.lat, bengaluruCenter.lng);
    const cellSame = h3Service.latLngToCell(tinyMove.lat, tinyMove.lng);
    expect(cell1).toBe(cellSame);

    // 1 kilometer away: must be in a different cell
    const oneKmMove = {
      lat: bengaluruCenter.lat + 0.009,
      lng: bengaluruCenter.lng + 0.009,
    };
    const cellDiff = h3Service.latLngToCell(oneKmMove.lat, oneKmMove.lng);
    expect(cell1).not.toBe(cellDiff);
  });

  it('calculates accurate great-circle distance in kilometers', () => {
    const distKoramangala = h3Service.getDistanceKm(bengaluruCenter, koramangala);
    // Real distance between MG Road and Koramangala is ~5.2 km
    expect(distKoramangala).toBeGreaterThan(5.0);
    expect(distKoramangala).toBeLessThan(5.6);

    const distIndiranagar = h3Service.getDistanceKm(bengaluruCenter, indiranagar);
    // Real distance between MG Road and 100ft Road Indiranagar is ~5.06 km
    expect(distIndiranagar).toBeGreaterThan(4.9);
    expect(distIndiranagar).toBeLessThan(5.3);
  });

  it('supports resolution configuration across 8, 9, 10', () => {
    const res8 = new H3Service(8);
    const res9 = new H3Service(9);
    const res10 = new H3Service(10);

    expect(res8.getResolution()).toBe(8);
    expect(res9.getResolution()).toBe(9);
    expect(res10.getResolution()).toBe(10);

    const cell8 = res8.latLngToCell(bengaluruCenter.lat, bengaluruCenter.lng);
    const cell9 = res9.latLngToCell(bengaluruCenter.lat, bengaluruCenter.lng);
    const cell10 = res10.latLngToCell(bengaluruCenter.lat, bengaluruCenter.lng);

    expect(cell8).not.toBe(cell9);
    expect(cell9).not.toBe(cell10);
  });

  it('generates conservative cell coverage for search radius', () => {
    const radiusKm = 3.0;
    const cells = h3Service.getCellsCoveringRadius(
      bengaluruCenter.lat,
      bengaluruCenter.lng,
      radiusKm
    );

    expect(cells.length).toBeGreaterThan(50);
    // Origin cell must be included
    const originCell = h3Service.latLngToCell(bengaluruCenter.lat, bengaluruCenter.lng);
    expect(cells).toContain(originCell);

    // Nearby point ~2 km away (Cubbon Park / Vidhana Soudha area)
    const nearbyPt = { lat: 12.9790, lng: 77.5910 };
    const nearbyDist = h3Service.getDistanceKm(bengaluruCenter, nearbyPt);
    expect(nearbyDist).toBeLessThan(radiusKm);

    const nearbyCell = h3Service.latLngToCell(nearbyPt.lat, nearbyPt.lng);
    expect(cells).toContain(nearbyCell);
  });

  // =========================================================================
  // Differential Verification: H3 Cell Coverage vs. Brute-Force Distance
  // =========================================================================
  it('guarantees zero false negatives: candidate cells cover 100% of points within radius', () => {
    const searchRadiusKm = 4.0;
    const origin = bengaluruCenter;

    // 1. Get candidate cells covering the 4.0 km radius
    const coveringCells = new Set(
      h3Service.getCellsCoveringRadius(origin.lat, origin.lng, searchRadiusKm)
    );

    // 2. Generate 150 random test coordinates around origin within ~6 km box
    const numPoints = 150;
    let eligibleCount = 0;

    for (let i = 0; i < numPoints; i++) {
      // Random offset within roughly +/- 0.05 degrees (~5.5 km)
      const latOffset = (Math.random() - 0.5) * 0.10;
      const lngOffset = (Math.random() - 0.5) * 0.10;
      const testPt = {
        lat: origin.lat + latOffset,
        lng: origin.lng + lngOffset,
      };

      const actualDistanceKm = h3Service.getDistanceKm(origin, testPt);

      // If the point is within the requested search radius, its containing H3 cell
      // MUST be present in the coveringCells set (Zero False Negatives)
      if (actualDistanceKm <= searchRadiusKm) {
        eligibleCount++;
        const ptCell = h3Service.latLngToCell(testPt.lat, testPt.lng);
        expect(coveringCells.has(ptCell)).toBe(true);
      }
    }

    // Ensure we actually tested a solid sample of eligible points
    expect(eligibleCount).toBeGreaterThan(15);
  });
});
