import { PrismaClient, Document, VerificationStatus } from '@prisma/client';

export class DocumentRepository {
  constructor(private prisma: PrismaClient) {}

  async findByDriverId(driverProfileId: string): Promise<Document[]> {
    return this.prisma.document.findMany({ where: { driverProfileId } });
  }

  async create(data: {
    driverProfileId: string;
    type: string;
    documentUrl: string;
    expiresAt?: Date;
  }): Promise<Document> {
    return this.prisma.document.create({ data });
  }

  async updateStatus(id: string, status: VerificationStatus, rejectionReason?: string): Promise<Document> {
    return this.prisma.document.update({
      where: { id },
      data: { status, rejectionReason }
    });
  }
}
