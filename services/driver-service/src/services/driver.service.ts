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
    let profile = await this.driverRepo.findById(id);
    if (!profile) {
      profile = await this.driverRepo.findByUserId(id);
    }
    if (!profile) throw new NotFoundError('Driver profile not found');
    return profile;
  }

  sanitizePublicProfile(profile: (DriverProfile & { vehicles?: Vehicle[] }) | null, userDetails?: any) {
    if (!profile) return null;
    const activeVehicle = (profile.vehicles || []).find((v) => v.isActive) || (profile.vehicles || [])[0];
    const sanitizedVehicles = (profile.vehicles || []).map((v) => {
      const vObj = v as Record<string, unknown>;
      const plateNumber = String(vObj.plateNumber || '');
      return {
        id: (typeof vObj.id === 'string' ? vObj.id : undefined) as string | undefined,
        type: String(vObj.category || 'SEDAN'),
        category: String(vObj.category || 'SEDAN'),
        brand: String(vObj.make || ''),
        make: String(vObj.make || ''),
        model: String(vObj.model || ''),
        color: String(vObj.color || ''),
        plateNumber,
        registrationNumber: plateNumber,
        registrationYear: Number(vObj.year ?? 0),
        year: Number(vObj.year ?? 0),
      };
    });

    const activeVehicleObj = activeVehicle ? {
      id: activeVehicle.id,
      type: String(activeVehicle.category || 'SEDAN'),
      category: String(activeVehicle.category || 'SEDAN'),
      brand: String(activeVehicle.make || ''),
      make: String(activeVehicle.make || ''),
      model: String(activeVehicle.model || ''),
      color: String(activeVehicle.color || ''),
      plateNumber: String(activeVehicle.plateNumber || ''),
      registrationNumber: String(activeVehicle.plateNumber || ''),
      registrationYear: Number(activeVehicle.year ?? 0),
      year: Number(activeVehicle.year ?? 0),
    } : null;

    let photoUrl: string | null = null;
    if (typeof profile.profilePhoto === 'string') {
      photoUrl = profile.profilePhoto;
    } else if (profile.profilePhoto && typeof profile.profilePhoto === 'object') {
      const p = profile.profilePhoto as any;
      photoUrl = p.secure_url || p.url || null;
    }

    const firstName = userDetails?.firstName || (userDetails?.user?.firstName) || 'Captain';
    const lastName = userDetails?.lastName || (userDetails?.user?.lastName) || '';
    const email = userDetails?.email || (userDetails?.user?.email) || '';
    const phone = userDetails?.phone || (userDetails?.user?.phone) || '';

    return {
      id: profile.id,
      userId: profile.userId,
      firstName,
      lastName,
      email,
      phone,
      rating: Number(profile.rating || 5.0),
      totalTrips: profile.totalTrips || 0,
      isAvailable: Boolean(profile.isAvailable),
      isOnline: Boolean((profile as unknown as { isOnline?: boolean }).isOnline ?? profile.isAvailable),
      verificationStatus: profile.verificationStatus,
      profilePhoto: photoUrl,
      profilePhotoUrl: photoUrl,
      vehicle: activeVehicleObj,
      vehicleNumber: activeVehicleObj?.plateNumber || '',
      vehicles: sanitizedVehicles,
      user: {
        id: profile.userId,
        firstName,
        lastName,
        email,
        phone,
      },
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

  async updateBankDetails(
    userId: string,
    bankData: {
      accountHolderName: string;
      accountNumber: string;
      ifscCode: string;
      bankName?: string;
      upiId: string;
      passbookPhoto?: Prisma.InputJsonValue;
    }
  ) {
    const profile = await this.getDriverByUserId(userId);
    return this.driverRepo.update(profile.id, {
      accountHolderName: bankData.accountHolderName,
      accountNumber: bankData.accountNumber,
      ifscCode: bankData.ifscCode,
      bankName: bankData.bankName || null,
      upiId: bankData.upiId,
      ...(bankData.passbookPhoto ? { passbookPhoto: bankData.passbookPhoto } : {}),
    });
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
    accountHolderName?: string | null;
    accountNumber?: string | null;
    ifscCode?: string | null;
    bankName?: string | null;
    upiId?: string | null;
    passbookPhoto?: Prisma.InputJsonValue;
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
