import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RideDto } from '@urbanfleet/common';
import { RideClient } from '../src/clients/ride.client.js';

function makeRideDto(paymentStatus = 'PENDING'): RideDto {
  const breakdown = {
    baseFarePaise: 100,
    distanceFarePaise: 200,
    timeFarePaise: 0,
    surgePaise: 0,
    platformCommissionPaise: 30,
    driverEarningPaise: 270,
    totalPaise: 300,
  };
  return {
    id: 'ride-uuid-123',
    riderId: 'rider-uuid-456',
    driverId: null,
    pickupAddress: 'Pickup',
    pickupLat: 12.9716,
    pickupLng: 77.5946,
    destinationAddress: 'Destination',
    destinationLat: 13.0827,
    destinationLng: 80.2707,
    pickup: { address: 'Pickup', coordinates: { latitude: 12.9716, longitude: 77.5946 } },
    destination: { address: 'Destination', coordinates: { latitude: 13.0827, longitude: 80.2707 } },
    fare: { estimated: 300, final: null, breakdown },
    distance: { estimated: 3, actual: 3 },
    duration: { estimated: 10, actual: null },
    status: 'ARRIVED_AT_DESTINATION',
    paymentStatus,
    driver: null,
  };
}

describe('RideClient Inter-Service HTTP Communication', () => {
  const originalFetch = globalThis.fetch;
  let client: RideClient;

  beforeEach(() => {
    client = new RideClient('http://test-ride-service:4003');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('fetches ride by ID over HTTP GET API', async () => {
    const mockRide = makeRideDto();

    const getSpy = vi.spyOn((client as unknown as { client: { get: Function } }).client, 'get').mockResolvedValue({
      status: 200,
      data: { success: true, data: mockRide },
    });

    const result = await client.getRideById('ride-uuid-123');
    expect(result).toEqual(mockRide);
    expect(getSpy).toHaveBeenCalledWith('/api/rides/ride-uuid-123');
  });

  it('returns null when ride is not found (404)', async () => {
    const notFoundError = new Error('Request failed with status code 404');
    Object.assign(notFoundError, { isAxiosError: true, response: { status: 404 } });

    vi.spyOn((client as unknown as { client: { get: Function } }).client, 'get').mockRejectedValue(notFoundError);

    const result = await client.getRideById('missing-ride');
    expect(result).toBeNull();
  });

  it('updates ride payment status over HTTP PATCH API', async () => {
    const patchSpy = vi.spyOn((client as unknown as { client: { patch: Function } }).client, 'patch').mockResolvedValue({
      status: 200,
      data: { success: true, data: { ...makeRideDto('PAID'), id: 'ride-123' } },
    });

    const result = await client.updatePaymentStatus('ride-123', 'PAID', 'PENDING');
    expect(result).toEqual({ ...makeRideDto('PAID'), id: 'ride-123' });
    expect(patchSpy).toHaveBeenCalledWith(
      '/api/rides/ride-123/payment-status',
      { paymentStatus: 'PAID', currentStatus: 'PENDING' }
    );
  });

  it('throws an error when ride service returns 500 error', async () => {
    const serverError = new Error('Request failed with status code 500');
    Object.assign(serverError, { isAxiosError: true, response: { status: 500 } });

    vi.spyOn((client as unknown as { client: { get: Function } }).client, 'get').mockRejectedValue(serverError);

    await expect(client.getRideById('ride-err')).rejects.toThrow('Ride Service returned HTTP 500');
  });
});
