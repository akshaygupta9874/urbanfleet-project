import { PrismaClient, DriverProfile, Vehicle } from '../db/client.js';

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

  async update(id: string, data: any): Promise<DriverProfile> {
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

  async createFullProfile(data: {
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
  }): Promise<DriverProfile & { vehicles: Vehicle[]; documents: any[] }> {
    return this.prisma.driverProfile.create({
      data: {
        userId: data.userId,
        licenseNumber: data.licenseNumber,
        profilePhoto: data.profilePhoto,
        isVerified: false,
        verificationStatus: 'PENDING',
        vehicles: {
          create: {
            category: data.vehicle.type || 'SEDAN',
            make: data.vehicle.brand,
            model: data.vehicle.model,
            color: data.vehicle.color,
            plateNumber: data.vehicle.registrationNumber,
            year: data.vehicle.registrationYear,
            images: data.vehicle.images,
          },
        },
        documents: {
          create: data.documents.map((doc) => ({
            type: doc.type,
            number: doc.number,
            documentUrl: doc.frontImage,
            frontImage: doc.frontImage,
            backImage: doc.backImage,
            expiresAt: doc.expiryDate,
            status: 'PENDING',
            isVerified: false,
          })),
        },
      },
      include: {
        vehicles: true,
        documents: true,
      },
    });
  }
}

