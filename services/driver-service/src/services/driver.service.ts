import { DriverRepository } from '../repositories/driver.repository.js';
import { NotFoundError, ConflictError } from '@urbanfleet/common';

export class DriverService {
  constructor(private driverRepo: DriverRepository) {}

  async createDriverProfile(userId: string, licenseNumber: string) {
    const existing = await this.driverRepo.findByUserId(userId);
    if (existing) throw new ConflictError('Driver profile already exists for this account');
    return this.driverRepo.create({ userId, licenseNumber });
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

  async updateProfile(userId: string, data: any) {
    const profile = await this.getDriverByUserId(userId);
    return this.driverRepo.update(profile.id, data);
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
}
