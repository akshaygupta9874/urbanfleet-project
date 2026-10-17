import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DriverClient } from '../src/clients/driver.client.js';

describe('DriverClient Inter-Service HTTP Communication in ride-service', () => {
  const originalFetch = globalThis.fetch;
  let client: DriverClient;

  beforeEach(() => {
    client = new DriverClient('http://test-driver-service:4002');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('fetches driver profile by driver ID over HTTP GET API', async () => {
    const mockDriver = {
      id: 'drv-uuid-1',
      userId: 'usr-uuid-1',
      licenseNumber: 'DL-987654321',
      verificationStatus: 'VERIFIED',
      isAvailable: true,
      rating: 4.9,
      totalTrips: 150,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: mockDriver }),
    } as any);

    const result = await client.getDriverById('drv-uuid-1');
    expect(result).toEqual(mockDriver);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://test-driver-service:4002/api/drivers/drv-uuid-1',
      expect.objectContaining({
        headers: { Accept: 'application/json' },
      })
    );
  });

  it('fetches driver profile by userId over HTTP GET API', async () => {
    const mockDriver = {
      id: 'drv-uuid-2',
      userId: 'usr-uuid-2',
      licenseNumber: 'DL-123456789',
      verificationStatus: 'VERIFIED',
      isAvailable: true,
      rating: 5.0,
      totalTrips: 80,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: mockDriver }),
    } as any);

    const result = await client.getDriverByUserId('usr-uuid-2');
    expect(result).toEqual(mockDriver);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://test-driver-service:4002/api/drivers/by-user/usr-uuid-2',
      expect.objectContaining({
        headers: { Accept: 'application/json' },
      })
    );
  });

  it('returns null when driver is not found (404)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    } as any);

    const result = await client.getDriverById('non-existent');
    expect(result).toBeNull();
  });
});
