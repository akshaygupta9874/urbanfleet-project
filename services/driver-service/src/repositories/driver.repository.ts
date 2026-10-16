import { PrismaClient, DriverProfile, Vehicle } from '@prisma/client';

export class DriverRepository {
  constructor(private prisma: PrismaClient) {}

  async findByUserId(userId: string): Promise<(DriverProfile & { vehicles: Vehicle[] }) | null> {
    return this.prisma.driverProfile.findUnique({
      where: { userId },
      include: { vehicles: true }
    });
  }

  async findById(id: string): Promise<(DriverProfile & { vehicles: Vehicle[] }) | null> {
    return this.prisma.driverProfile.findUnique({
      where: { id },
      include: { vehicles: true }
    });
  }

  async create(data: {
    userId: string;
    licenseNumber: string;
  }): Promise<DriverProfile> {
    return this.prisma.driverProfile.create({ data });
  }

  async update(id: string, data: Partial<DriverProfile>): Promise<DriverProfile> {
    return this.prisma.driverProfile.update({ where: { id }, data });
  }

  async createVehicle(driverProfileId: string, vehicleData: any): Promise<Vehicle> {
    return this.prisma.vehicle.create({
      data: {
        driverProfileId,
        ...vehicleData
      }
    });
  }

  async updateVehicle(id: string, vehicleData: any): Promise<Vehicle> {
    return this.prisma.vehicle.update({ where: { id }, data: vehicleData });
  }
}
