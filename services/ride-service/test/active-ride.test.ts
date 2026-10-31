import { describe, expect, it, vi } from 'vitest';
import { RideController } from '../src/controllers/ride.controller.js';

describe('Active Ride Resolution for Dual-Role Users and Refresh', () => {
  it('returns active rider ride with OTP even when user has DRIVER in roles array', async () => {
    const mockRide = {
      id: 'ride-dual-123',
      riderId: 'user-dual-id',
      driverId: null,
      pickupAddress: 'Pickup Address',
      pickupLat: 12.9716,
      pickupLng: 77.5946,
      destinationAddress: 'Destination Address',
      destinationLat: 13.0827,
      destinationLng: 80.2707,
      distanceKm: 15.5,
      totalFarePaise: 45000,
      baseFarePaise: 18000,
      status: 'SEARCHING',
      paymentStatus: 'PENDING',
      otp: '789123',
      createdAt: new Date('2026-10-30T12:00:00Z'),
      updatedAt: new Date('2026-10-30T12:00:00Z'),
    };

    const mockRideService = {
      getActiveRideForUser: vi.fn(async (userId: string, isDriver: boolean) => {
        if (!isDriver && userId === 'user-dual-id') {
          return mockRide;
        }
        return null;
      }),
    } as any;

    const controller = new RideController(mockRideService, {} as any);

    const req: any = {
      userId: 'user-dual-id',
      roles: ['DRIVER', 'RIDER'],
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await controller.getActiveRide(req, res, () => {});

    // Must check rider ride first
    expect(mockRideService.getActiveRideForUser).toHaveBeenCalledWith('user-dual-id', false);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        id: 'ride-dual-123',
        riderId: 'user-dual-id',
        status: 'SEARCHING',
        otp: '789123',
      }),
    });
  });

  it('falls back to driver ride if user is a driver and has no rider ride', async () => {
    const mockDriverRide = {
      id: 'ride-driver-456',
      riderId: 'some-other-rider',
      driverId: 'user-driver-id',
      pickupAddress: 'Pickup Address',
      pickupLat: 12.9716,
      pickupLng: 77.5946,
      destinationAddress: 'Destination Address',
      destinationLat: 13.0827,
      destinationLng: 80.2707,
      distanceKm: 10,
      totalFarePaise: 30000,
      baseFarePaise: 12000,
      status: 'DRIVER_ARRIVING',
      paymentStatus: 'PENDING',
      otp: '999999',
      createdAt: new Date('2026-10-30T12:00:00Z'),
      updatedAt: new Date('2026-10-30T12:00:00Z'),
    };

    const mockRideService = {
      getActiveRideForUser: vi.fn(async (userId: string, isDriver: boolean) => {
        if (!isDriver) return null;
        if (isDriver && userId === 'user-driver-id') return mockDriverRide;
        return null;
      }),
    } as any;

    const controller = new RideController(mockRideService, {} as any);

    const req: any = {
      userId: 'user-driver-id',
      roles: ['DRIVER'],
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await controller.getActiveRide(req, res, () => {});

    expect(mockRideService.getActiveRideForUser).toHaveBeenNthCalledWith(1, 'user-driver-id', false);
    expect(mockRideService.getActiveRideForUser).toHaveBeenNthCalledWith(2, 'user-driver-id', true);
    expect(res.status).toHaveBeenCalledWith(200);
    // Driver view should not leak rider OTP
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        id: 'ride-driver-456',
        driverId: 'user-driver-id',
        status: 'DRIVER_ARRIVING',
      }),
    });
  });

  it('returns null data when user has neither rider nor driver active ride', async () => {
    const mockRideService = {
      getActiveRideForUser: vi.fn(async () => null),
    } as any;

    const controller = new RideController(mockRideService, {} as any);

    const req: any = {
      userId: 'user-idle-id',
      roles: ['RIDER'],
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await controller.getActiveRide(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: null,
    });
  });

  it('does NOT fallback to driver ride for dual-role user (roles: [RIDER, DRIVER]) on rider active-ride query', async () => {
    const mockDriverRide: any = {
      id: 'ride-driver-789',
      riderId: 'passenger-user-id',
      driverId: 'dual-role-user-id',
      pickupAddress: 'Pickup',
      pickupLat: 12.9716,
      pickupLng: 77.5946,
      destinationAddress: 'Destination',
      destinationLat: 13.0827,
      destinationLng: 80.2707,
      distanceKm: 10,
      totalFarePaise: 30000,
      baseFarePaise: 12000,
      status: 'DRIVER_ARRIVING',
      paymentStatus: 'PENDING',
      otp: '999999',
      createdAt: new Date('2026-10-30T12:00:00Z'),
      updatedAt: new Date('2026-10-30T12:00:00Z'),
    };

    const mockRideService = {
      getActiveRideForUser: vi.fn(async (userId: string, isDriver: boolean) => {
        if (!isDriver) return null; // No ride as passenger
        return mockDriverRide; // Has a ride as driver
      }),
    } as any;

    const controller = new RideController(mockRideService, {} as any);

    const req: any = {
      userId: 'dual-role-user-id',
      roles: ['RIDER', 'DRIVER'],
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await controller.getActiveRide(req, res, () => {});

    // Must NOT check driver ride for dual-role user on /ride/current
    expect(mockRideService.getActiveRideForUser).toHaveBeenCalledTimes(1);
    expect(mockRideService.getActiveRideForUser).toHaveBeenCalledWith('dual-role-user-id', false);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: null,
    });
  });
});
