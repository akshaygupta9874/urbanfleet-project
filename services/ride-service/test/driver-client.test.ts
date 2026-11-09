import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DriverClient, DriverProfile } from '../src/clients/driver.client.js';

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
    const mockDriver: DriverProfile = {
      id: 'drv-uuid-1',
      userId: 'usr-uuid-1',
      licenseNumber: 'DL-987654321',
      verificationStatus: 'VERIFIED',
      isAvailable: true,
      isOnline: true,
      rating: 4.9,
      totalTrips: 150,
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@example.com',
      profilePhoto: 'https://res.cloudinary.com/urbanfleet/image/upload/v1/driver.jpg',
      profilePhotoUrl: 'https://res.cloudinary.com/urbanfleet/image/upload/v1/driver.jpg',
      vehicleNumber: 'KA-01-AB-1234',
      vehicle: {
        id: 'veh-1',
        type: 'SEDAN',
        category: 'SEDAN',
        brand: 'Toyota',
        make: 'Toyota',
        model: 'Etios',
        color: 'White',
        plateNumber: 'KA-01-AB-1234',
        registrationNumber: 'KA-01-AB-1234',
        year: 2022,
      },
      vehicles: [
        {
          id: 'veh-1',
          type: 'SEDAN',
          category: 'SEDAN',
          brand: 'Toyota',
          make: 'Toyota',
          model: 'Etios',
          color: 'White',
          plateNumber: 'KA-01-AB-1234',
          registrationNumber: 'KA-01-AB-1234',
          year: 2022,
        },
      ],
      user: {
        id: 'usr-uuid-1',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
      },
    };

    const getSpy = vi.spyOn((client as unknown as { client: { get: Function } }).client, 'get').mockResolvedValue({
      status: 200,
      data: { success: true, data: mockDriver },
    });

    const result = await client.getDriverById('drv-uuid-1');
    expect(result).toEqual(mockDriver);
    expect(getSpy).toHaveBeenCalledWith('/v1/drivers/drv-uuid-1');
  });

  it('fetches driver profile by userId over HTTP GET API', async () => {
    const mockDriver: DriverProfile = {
      id: 'drv-uuid-2',
      userId: 'usr-uuid-2',
      licenseNumber: 'DL-123456789',
      verificationStatus: 'VERIFIED',
      isAvailable: true,
      isOnline: true,
      rating: 5.0,
      totalTrips: 80,
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane.smith@example.com',
      profilePhoto: null,
      profilePhotoUrl: null,
      vehicleNumber: 'KA-01-XY-5678',
      vehicle: {
        id: 'veh-2',
        type: 'SUV',
        category: 'SUV',
        brand: 'Honda',
        make: 'Honda',
        model: 'CR-V',
        color: 'Black',
        plateNumber: 'KA-01-XY-5678',
        registrationNumber: 'KA-01-XY-5678',
        year: 2023,
      },
      vehicles: [
        {
          id: 'veh-2',
          type: 'SUV',
          category: 'SUV',
          brand: 'Honda',
          make: 'Honda',
          model: 'CR-V',
          color: 'Black',
          plateNumber: 'KA-01-XY-5678',
          registrationNumber: 'KA-01-XY-5678',
          year: 2023,
        },
      ],
      user: {
        id: 'usr-uuid-2',
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane.smith@example.com',
      },
    };

    const getSpy = vi.spyOn((client as unknown as { client: { get: Function } }).client, 'get').mockResolvedValue({
      status: 200,
      data: { success: true, data: mockDriver },
    });

    const result = await client.getDriverByUserId('usr-uuid-2');
    expect(result).toEqual(mockDriver);
    expect(getSpy).toHaveBeenCalledWith('/v1/drivers/by-user/usr-uuid-2');
  });

  it('returns null when driver is not found (404)', async () => {
    const notFoundError = new Error('Request failed with status code 404');
    Object.assign(notFoundError, { isAxiosError: true, response: { status: 404 } });

    vi.spyOn((client as unknown as { client: { get: Function } }).client, 'get').mockRejectedValue(notFoundError);

    const result = await client.getDriverById('non-existent');
    expect(result).toBeNull();
  });
});
