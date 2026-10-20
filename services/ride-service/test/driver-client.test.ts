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

    const getSpy = vi.spyOn((client as unknown as { client: { get: Function } }).client, 'get').mockResolvedValue({
      status: 200,
      data: { success: true, data: mockDriver },
    });

    const result = await client.getDriverById('drv-uuid-1');
    expect(result).toEqual(mockDriver);
    expect(getSpy).toHaveBeenCalledWith('/api/drivers/drv-uuid-1');
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

    const getSpy = vi.spyOn((client as unknown as { client: { get: Function } }).client, 'get').mockResolvedValue({
      status: 200,
      data: { success: true, data: mockDriver },
    });

    const result = await client.getDriverByUserId('usr-uuid-2');
    expect(result).toEqual(mockDriver);
    expect(getSpy).toHaveBeenCalledWith('/api/drivers/by-user/usr-uuid-2');
  });

  it('returns null when driver is not found (404)', async () => {
    const notFoundError = new Error('Request failed with status code 404');
    Object.assign(notFoundError, { isAxiosError: true, response: { status: 404 } });

    vi.spyOn((client as unknown as { client: { get: Function } }).client, 'get').mockRejectedValue(notFoundError);

    const result = await client.getDriverById('non-existent');
    expect(result).toBeNull();
  });
});
