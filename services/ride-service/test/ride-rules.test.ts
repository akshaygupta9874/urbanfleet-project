import { describe, expect, it } from 'vitest';
import { canCompleteRide } from '../src/services/ride.service.js';

describe('Ride Lifecycle State Rules', () => {
  it('allows completion only when destination is reached and payment is captured', () => {
    expect(
      canCompleteRide({
        status: 'ARRIVED_AT_DESTINATION',
        paymentStatus: 'CAPTURED'
      })
    ).toBe(true);

    expect(
      canCompleteRide({
        status: 'ARRIVED_AT_DESTINATION',
        paymentStatus: 'PENDING'
      })
    ).toBe(false);

    expect(
      canCompleteRide({
        status: 'RIDE_STARTED',
        paymentStatus: 'CAPTURED'
      })
    ).toBe(false);
  });
});
