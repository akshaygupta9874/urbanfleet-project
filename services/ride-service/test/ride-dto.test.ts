import { describe, expect, it } from 'vitest';
import { toRideDto } from '../src/utils/ride-dto.js';

describe('toRideDto fare breakdown', () => {
  it('keeps derived fare components equal to the persisted total', () => {
    const ride = {
      id: 'ride-1',
      riderId: 'rider-1',
      driverId: null,
      pickupLat: 22.5,
      pickupLng: 88.3,
      pickupAddress: 'Pickup',
      destinationLat: 22.6,
      destinationLng: 88.4,
      destinationAddress: 'Destination',
      distanceKm: 200,
      durationMinutes: 60,
      baseFarePaise: 54681,
      totalFarePaise: 136703,
      vehicleCategory: 'SEDAN',
      surgeMultiplier: 1,
      status: 'ARRIVED_AT_DESTINATION',
      paymentStatus: 'PENDING',
      cancelledBy: null,
      cancellationReason: null,
      createdAt: new Date('2026-11-01T21:00:00.000Z'),
      updatedAt: new Date('2026-11-01T21:00:00.000Z'),
    } as never;

    const breakdown = toRideDto(ride).fare.breakdown;

    expect(breakdown).not.toBeNull();
    expect(
      breakdown!.baseFarePaise +
        breakdown!.distanceFarePaise +
        breakdown!.timeFarePaise +
        breakdown!.surgePaise
    ).toBe(breakdown!.totalPaise);
    expect(
      breakdown!.driverEarningPaise + breakdown!.platformCommissionPaise
    ).toBe(breakdown!.totalPaise);
  });
});
