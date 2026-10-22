import { DriverRepository } from '../repositories/driver.repository.js';
import { NotFoundError, ConflictError } from '@urbanfleet/common';
import { DriverProfile, Vehicle, Prisma } from '../db/client.js';

export class DriverService {
  private driverRepo: DriverRepository;

  constructor(driverRepo: DriverRepository) {
    this.driverRepo = driverRepo;
  }

  async createDriverProfile(userId: string, licenseNumber: string) {
    const existing = await this.driverRepo.findByUserId(userId);
    if (existing) {
      throw new ConflictError('Driver profile already exists for this account');
    }
    try {
      return await this.driverRepo.create({ userId, licenseNumber });
    } catch (err: unknown) {
      const isPrismaP2002 =
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: unknown }).code === 'P2002';
      if (isPrismaP2002) {
        throw new ConflictError('Driver profile already exists for this account');
      }
      throw err;
    }
  }

  async getDriverByUserId(userId: string) {
    const profile = await this.driverRepo.findByUserId(userId);
    if (!profile) throw new NotFoundError('Driver profile not found');
    return profile;
  }

  async getDriverById(id: string) {
    const profile = await this.driverRepo.findById(id);
    if (!profile) throw new NotFoundError('Driver profile not found');
    return profile;
  }

  sanitizePublicProfile(profile: (DriverProfile & { vehicles?: Vehicle[] }) | null) {
    if (!profile) return null;
    const sanitizedVehicles = (profile.vehicles || []).map((v) => {
      const vObj = v as Record<string, unknown>;
      return {
        id: (typeof vObj.id === 'string' ? vObj.id : undefined) as string | undefined,
        type: String(vObj.category || 'SEDAN'),
        brand: String(vObj.make || ''),
        model: String(vObj.model || ''),
        color: String(vObj.color || ''),
        registrationYear: Number(vObj.year ?? 0),
      };
    });

    return {
      id: profile.id,
      userId: profile.userId,
      rating: Number(profile.rating || 5.0),
      totalTrips: profile.totalTrips || 0,
      isAvailable: Boolean(profile.isAvailable),
      isOnline: Boolean((profile as unknown as { isOnline?: boolean }).isOnline ?? profile.isAvailable),
      verificationStatus: profile.verificationStatus,
      profilePhoto: profile.profilePhoto,
      vehicles: sanitizedVehicles,
      createdAt: profile.createdAt,
    };
  }

  async updateProfile(userId: string, data: Record<string, unknown>) {
    const profile = await this.getDriverByUserId(userId);
    const { userId: _strippedUserId, id: _strippedId, vehicle, vehicles: _v, ...cleanData } = data || {};

    if (vehicle && typeof vehicle === 'object') {
      await this.updateVehicleInfo(userId, vehicle as Prisma.VehicleUpdateInput);
    }

    if (Object.keys(cleanData).length > 0) {
      await this.driverRepo.update(profile.id, cleanData as Prisma.DriverProfileUpdateInput);
    }

    return this.getDriverByUserId(userId);
  }

  async updateVehicleInfo(userId: string, vehicleData: Prisma.VehicleUpdateInput) {
    const profile = await this.getDriverByUserId(userId);
    if (profile.vehicles && profile.vehicles.length > 0) {
      return this.driverRepo.updateVehicle(profile.vehicles[0].id, vehicleData);
    }
    return this.driverRepo.createVehicle(profile.id, vehicleData as Prisma.VehicleCreateWithoutDriverProfileInput);
  }

  async setAvailability(userId: string, isAvailable: boolean) {
    const profile = await this.getDriverByUserId(userId);
    return this.driverRepo.update(profile.id, { isAvailable });
  }

  async calculateEarnings(userId: string) {
    const profile = await this.getDriverByUserId(userId);
    return {
      driverId: profile.id,
      totalEarningsPaise: Number(profile.totalEarningsPaise),
      totalTrips: profile.totalTrips,
      rating: Number(profile.rating)
    };
  }

  async registerFullDriver(data: {
    userId: string;
    licenseNumber: string;
    profilePhoto?: Prisma.InputJsonValue;
    vehicle: {
      type: string;
      brand: string;
      model: string;
      color: string;
      registrationNumber: string;
      registrationYear: number;
      images?: Prisma.InputJsonValue;
    };
    documents: Array<{
      type: string;
      number: string;
      expiryDate?: Date;
      frontImage: string;
      backImage?: string;
    }>;
  }) {
    const existing = await this.driverRepo.findByUserId(data.userId);
    if (existing) {
      throw new ConflictError('Driver application already exists for this account');
    }
    try {
      return await this.driverRepo.createFullProfile(data);
    } catch (err: unknown) {
      const isPrismaP2002 =
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: unknown }).code === 'P2002';
      if (isPrismaP2002) {
        throw new ConflictError('Driver application already exists for this account');
      }
      throw err;
    }
  }
}
