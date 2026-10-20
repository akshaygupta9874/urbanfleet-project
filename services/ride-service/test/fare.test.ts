import { describe, it, expect } from 'vitest';
import { FareService } from '../src/services/fare.service.js';

describe('Ride Service Fare Calculations', () => {
  const fareService = new FareService();

  it('should compute distance and duration between two coordinates using Haversine', () => {
    const pickup = { latitude: 19.0760, longitude: 72.8777 }; // BKC Mumbai
    const destination = { latitude: 19.0896, longitude: 72.8656 }; // Airport
    const { distanceKm, durationMinutes } = fareService.computeDistanceAndDuration(pickup, destination);

    expect(distanceKm).toBeGreaterThan(1.0);
    expect(durationMinutes).toBeGreaterThanOrEqual(5);
  });

  it('should calculate fare estimates with base fare, dynamic distance, and surge', () => {
    const pickup = { address: 'Mumbai', coordinates: { latitude: 19.0760, longitude: 72.8777 } };
    const destination = { address: 'Andheri', coordinates: { latitude: 19.1136, longitude: 72.8697 } };
    const estimate = fareService.calculateFareEstimate(pickup, destination);

    expect(estimate.baseFarePaise).toBe(5000); // ₹50
    expect(estimate.surgeMultiplier).toBeGreaterThanOrEqual(1.0);
    expect(estimate.totalFarePaise).toBeGreaterThan(estimate.baseFarePaise);
  });

  it('should apply cancellation fees only after 2 minutes', () => {
    expect(fareService.calculateCancellationFee(1)).toBe(0);
    expect(fareService.calculateCancellationFee(3)).toBe(5000); // ₹50
  });
});
