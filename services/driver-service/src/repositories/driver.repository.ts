import { PrismaClient, DriverProfile, Vehicle, Document, Prisma, VerificationStatus } from '../db/client.js';

export interface VehicleInput {
  type: string;
  brand: string;
  model: string;
  color: string;
  registrationNumber: string;
  registrationYear: number;
  images?: Prisma.InputJsonValue;
}

export interface DocumentInput {
  type: string;
  number: string;
  expiryDate?: Date;
  frontImage: string;
  backImage?: string;
}

export interface CreateFullProfileInput {
  userId: string;
  licenseNumber: string;
  profilePhoto?: Prisma.InputJsonValue;
  accountHolderName?: string | null;
  accountNumber?: string | null;
  ifscCode?: string | null;
  bankName?: string | null;
  upiId?: string | null;
  passbookPhoto?: Prisma.InputJsonValue;
  vehicle: VehicleInput;
  documents: DocumentInput[];
}

export interface UpdateFullProfileInput {
  licenseNumber: string;
  profilePhoto?: Prisma.InputJsonValue;
  vehicle: VehicleInput;
  documents: DocumentInput[];
}

export interface ListDriversParams {
  page?: number;
  limit?: number;
  status?: VerificationStatus;
  search?: string;
}

export interface DriverListItemDocument {
  id: string;
  type: string;
  status: VerificationStatus;
  expiresAt: Date | null;
  documentUrl: string;
}

export interface DriverListItem extends DriverProfile {
  vehicles: Vehicle[];
  documents: DriverListItemDocument[];
}

export interface ListDriversResult {
  items: DriverListItem[];
  total: number;
}

export interface DriverMetricsResult {
  approved: number;
  pending: number;
  rejected: number;
  underReview: number;
  suspended: number;
  total: number;
}

export class DriverRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async findByUserId(userId: string): Promise<(DriverProfile & { vehicles: Vehicle[] }) | null> {
    return this.prisma.driverProfile.findUnique({
      where: { userId },
      include: { vehicles: true },
    });
  }

  async findById(id: string): Promise<(DriverProfile & { vehicles: Vehicle[] }) | null> {
    return this.prisma.driverProfile.findUnique({
      where: { id },
      include: { vehicles: true },
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
        ...vehicleData,
      },
    });
  }

  async updateVehicle(id: string, vehicleData: Prisma.VehicleUpdateInput): Promise<Vehicle> {
    return this.prisma.vehicle.update({ where: { id }, data: vehicleData });
  }

  async list(params: ListDriversParams = {}): Promise<ListDriversResult> {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 25));
    const skip = (page - 1) * limit;

    const where: Prisma.DriverProfileWhereInput = {};

    if (params.status) {
      where.verificationStatus = params.status;
    }

    if (params.search && params.search.trim().length > 0) {
      const search = params.search.trim();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search);
      where.OR = [
        { licenseNumber: { contains: search, mode: 'insensitive' } },
        { vehicles: { some: { plateNumber: { contains: search, mode: 'insensitive' } } } },
        ...(isUuid ? [{ id: search }, { userId: search }] : []),
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.driverProfile.findMany({
        where,
        include: {
          vehicles: true,
          documents: {
            select: {
              id: true,
              type: true,
              status: true,
              expiresAt: true,
              documentUrl: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.driverProfile.count({ where }),
    ]);

    return { items, total };
  }

  async getMetrics(): Promise<DriverMetricsResult> {
    const counts = await this.prisma.driverProfile.groupBy({
      by: ['verificationStatus'],
      _count: true,
    });

    const summary: DriverMetricsResult = {
      approved: 0,
      pending: 0,
      rejected: 0,
      underReview: 0,
      suspended: 0,
      total: 0,
    };

    for (const item of counts) {
      summary.total += item._count;
      const st = item.verificationStatus;
      if (st === 'APPROVED' || st === 'VERIFIED') {
        summary.approved += item._count;
      } else if (st === 'PENDING') {
        summary.pending += item._count;
      } else if (st === 'REJECTED') {
        summary.rejected += item._count;
      } else if (st === 'SUSPENDED') {
        summary.suspended += item._count;
      } else {
        summary.underReview += item._count;
      }
    }

    return summary;
  }

  async updateVerification(
    id: string,
    status: VerificationStatus,
    isVerified: boolean
  ): Promise<DriverProfile & { vehicles: Vehicle[]; documents: Document[] }> {
    return this.prisma.driverProfile.update({
      where: { id },
      data: {
        verificationStatus: status,
        isVerified,
      },
      include: {
        vehicles: true,
        documents: true,
      },
    });
  }

  async createFullProfile(data: CreateFullProfileInput): Promise<DriverProfile & { vehicles: Vehicle[]; documents: Document[] }> {
    return this.prisma.driverProfile.create({
      data: {
        userId: data.userId,
        licenseNumber: data.licenseNumber,
        profilePhoto: data.profilePhoto,
        accountHolderName: data.accountHolderName || null,
        accountNumber: data.accountNumber || null,
        ifscCode: data.ifscCode || null,
        bankName: data.bankName || null,
        upiId: data.upiId || null,
        passbookPhoto: data.passbookPhoto,
        isVerified: false,
        verificationStatus: data.documents && data.documents.length > 0 ? 'UNDER_REVIEW' : 'PENDING',
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
            status: doc.type === 'BANK_PASSBOOK' ? VerificationStatus.VERIFIED : VerificationStatus.PENDING,
            isVerified: doc.type === 'BANK_PASSBOOK',
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
    data: UpdateFullProfileInput
  ): Promise<DriverProfile & { vehicles: Vehicle[]; documents: Document[] }> {
    return this.prisma.$transaction(async (tx) => {
      // 1. Update the placeholder driver profile
      await tx.driverProfile.update({
        where: { id },
        data: {
          licenseNumber: data.licenseNumber,
          profilePhoto: data.profilePhoto,
          verificationStatus: data.documents && data.documents.length > 0 ? 'UNDER_REVIEW' : 'PENDING',
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
              status: doc.type === 'BANK_PASSBOOK' ? VerificationStatus.VERIFIED : VerificationStatus.PENDING,
              isVerified: doc.type === 'BANK_PASSBOOK',
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
              status: doc.type === 'BANK_PASSBOOK' ? VerificationStatus.VERIFIED : VerificationStatus.PENDING,
              isVerified: doc.type === 'BANK_PASSBOOK',
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
