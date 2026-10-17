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

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: mockRide }),
    } as any);

    const result = await client.getRideById('ride-uuid-123');
    expect(result).toEqual(mockRide);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://test-ride-service:4003/api/rides/ride-uuid-123',
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'application/json' }),
      })
    );
  });

  it('returns null when ride is not found (404)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    } as any);

    const result = await client.getRideById('missing-ride');
    expect(result).toBeNull();
  });

  it('updates ride payment status over HTTP PATCH API', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { id: 'ride-123', paymentStatus: 'PAID' } }),
    } as any);

    const result = await client.updatePaymentStatus('ride-123', 'PAID', 'PENDING');
    expect(result).toEqual({ id: 'ride-123', paymentStatus: 'PAID' });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://test-ride-service:4003/api/rides/ride-123/payment-status',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ paymentStatus: 'PAID', currentStatus: 'PENDING' }),
      })
    );
  });

  it('throws an error when ride service returns 500 error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as any);

    await expect(client.getRideById('ride-err')).rejects.toThrow('Ride Service returned HTTP 500');
  });
});
