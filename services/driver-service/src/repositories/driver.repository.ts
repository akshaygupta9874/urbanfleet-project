import { PrismaClient, DriverProfile, Vehicle, Document, Prisma } from '../db/client.js';

export class DriverRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

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

  async update(id: string, data: Prisma.DriverProfileUpdateInput): Promise<DriverProfile> {
    return this.prisma.driverProfile.update({ where: { id }, data });
  }

  async createVehicle(driverProfileId: string, vehicleData: Prisma.VehicleCreateWithoutDriverProfileInput): Promise<Vehicle> {
    return this.prisma.vehicle.create({
      data: {
        driverProfileId,
        ...vehicleData
      }
    });
  }

  async updateVehicle(id: string, vehicleData: Prisma.VehicleUpdateInput): Promise<Vehicle> {
    return this.prisma.vehicle.update({ where: { id }, data: vehicleData });
  }

  async createFullProfile(data: {
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
  }): Promise<DriverProfile & { vehicles: Vehicle[]; documents: Document[] }> {
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

  async updateFullProfile(
    id: string,
    data: {
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
    }
  ): Promise<DriverProfile & { vehicles: Vehicle[]; documents: Document[] }> {
    return this.prisma.$transaction(async (tx) => {
      // 1. Update the placeholder driver profile
      await tx.driverProfile.update({
        where: { id },
        data: {
          licenseNumber: data.licenseNumber,
          profilePhoto: data.profilePhoto,
          verificationStatus: 'PENDING',
          isVerified: false,
        },
      });

      // 2. Create vehicle if not exists, or update existing vehicle
      const existingVehicle = await tx.vehicle.findFirst({
        where: { driverProfileId: id },
      });

      if (existingVehicle) {
        await tx.vehicle.update({
          where: { id: existingVehicle.id },
          data: {
            category: data.vehicle.type || 'SEDAN',
            make: data.vehicle.brand,
            model: data.vehicle.model,
            color: data.vehicle.color,
            plateNumber: data.vehicle.registrationNumber,
            year: data.vehicle.registrationYear,
            images: data.vehicle.images,
          },
        });
      } else {
        await tx.vehicle.create({
          data: {
            driverProfileId: id,
            category: data.vehicle.type || 'SEDAN',
            make: data.vehicle.brand,
            model: data.vehicle.model,
            color: data.vehicle.color,
            plateNumber: data.vehicle.registrationNumber,
            year: data.vehicle.registrationYear,
            images: data.vehicle.images,
          },
        });
      }

      // 3. Upsert uploaded documents
      for (const doc of data.documents) {
        const existingDoc = await tx.document.findFirst({
          where: { driverProfileId: id, type: doc.type },
        });

        if (existingDoc) {
          await tx.document.update({
            where: { id: existingDoc.id },
            data: {
              number: doc.number,
              documentUrl: doc.frontImage,
              frontImage: doc.frontImage,
              backImage: doc.backImage,
              expiresAt: doc.expiryDate,
              status: 'PENDING',
              isVerified: false,
            },
          });
        } else {
          await tx.document.create({
            data: {
              driverProfileId: id,
              type: doc.type,
              number: doc.number,
              documentUrl: doc.frontImage,
              frontImage: doc.frontImage,
              backImage: doc.backImage,
              expiresAt: doc.expiryDate,
              status: 'PENDING',
              isVerified: false,
            },
          });
        }
      }

      return tx.driverProfile.findUniqueOrThrow({
        where: { id },
        include: {
          vehicles: true,
          documents: true,
        },
      });
    });
  }
}

