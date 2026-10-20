import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RideClient } from '../src/clients/ride.client.js';

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
    const mockRide = {
      id: 'ride-uuid-123',
      riderId: 'rider-uuid-456',
      status: 'ARRIVED_AT_DESTINATION',
      totalFarePaise: 25000,
    };

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
      data: { success: true, data: { id: 'ride-123', paymentStatus: 'PAID' } },
    });

    const result = await client.updatePaymentStatus('ride-123', 'PAID', 'PENDING');
    expect(result).toEqual({ id: 'ride-123', paymentStatus: 'PAID' });
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
