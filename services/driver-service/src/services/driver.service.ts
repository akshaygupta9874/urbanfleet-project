import { DriverRepository } from '../repositories/driver.repository.js';
import { NotFoundError, ConflictError } from '@urbanfleet/common';

export class DriverService {
  constructor(private driverRepo: DriverRepository) {}

  async createDriverProfile(userId: string, licenseNumber: string) {
    const existing = await this.driverRepo.findByUserId(userId);
    if (existing) {
      const isPlaceholder = existing.licenseNumber.startsWith('PENDING_');
      if (isPlaceholder) {
        return this.driverRepo.update(existing.id, {
          licenseNumber,
          verificationStatus: 'PENDING',
        });
      }
      throw new ConflictError('Driver profile already exists for this account');
    }
    try {
      return await this.driverRepo.create({ userId, licenseNumber });
    } catch (err: any) {
      if (err.code === 'P2002') {
        const raceExisting = await this.driverRepo.findByUserId(userId);
        if (raceExisting) {
          return this.driverRepo.update(raceExisting.id, {
            licenseNumber,
            verificationStatus: 'PENDING',
          });
        }
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

  sanitizePublicProfile(profile: any) {
    if (!profile) return null;
    const sanitizedVehicles = (profile.vehicles || []).map((v: any) => ({
      id: v.id,
      type: v.type,
      brand: v.brand,
      model: v.model,
      color: v.color,
      registrationYear: v.registrationYear,
    }));

    return {
      id: profile.id,
      _id: profile.id,
      userId: profile.userId,
      rating: Number(profile.rating || 5.0),
      totalTrips: profile.totalTrips || 0,
      isAvailable: Boolean(profile.isAvailable),
      isOnline: Boolean(profile.isOnline),
      verificationStatus: profile.verificationStatus,
      profilePhoto: profile.profilePhoto,
      vehicles: sanitizedVehicles,
      createdAt: profile.createdAt,
    };
  }

  async updateProfile(userId: string, data: any) {
    const profile = await this.getDriverByUserId(userId);
    const { userId: _strippedUserId, id: _strippedId, vehicle, vehicles: _v, ...cleanData } = data || {};

    if (vehicle) {
      await this.updateVehicleInfo(userId, vehicle);
    }

    if (Object.keys(cleanData).length > 0) {
      await this.driverRepo.update(profile.id, cleanData);
    }

    return this.getDriverByUserId(userId);
  }

  async updateVehicleInfo(userId: string, vehicleData: any) {
    const profile = await this.getDriverByUserId(userId);
    if (profile.vehicles && profile.vehicles.length > 0) {
      return this.driverRepo.updateVehicle(profile.vehicles[0].id, vehicleData);
    }
    return this.driverRepo.createVehicle(profile.id, vehicleData);
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
    profilePhoto?: any;
    vehicle: {
      type: string;
      brand: string;
      model: string;
      color: string;
      registrationNumber: string;
      registrationYear: number;
      images?: any;
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
      const isPlaceholder =
        existing.licenseNumber.startsWith('PENDING_') ||
        !existing.vehicles ||
        existing.vehicles.length === 0;
      if (isPlaceholder) {
        return this.driverRepo.updateFullProfile(existing.id, data);
      }
      throw new ConflictError('Driver application already exists for this account');
    }
    try {
      return await this.driverRepo.createFullProfile(data);
    } catch (err: any) {
      if (err.code === 'P2002') {
        const raceExisting = await this.driverRepo.findByUserId(data.userId);
        if (raceExisting) {
          return this.driverRepo.updateFullProfile(raceExisting.id, data);
        }
      }
      throw err;
    }
  }
}

