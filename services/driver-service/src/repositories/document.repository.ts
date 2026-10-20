import { PrismaClient, Document, VerificationStatus, Prisma } from '../db/client.js';

export interface CreateDocumentInput {
  driverProfileId: string;
  type: string;
  documentUrl: string;
  number?: string;
  frontImage?: string;
  backImage?: string;
  expiresAt?: Date;
  status?: VerificationStatus;
  isVerified?: boolean;
}

export class DocumentRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async findById(id: string): Promise<Document | null> {
    return this.prisma.document.findUnique({
      where: { id },
    });
  }

  async findByDriverId(driverProfileId: string): Promise<Document[]> {
    return this.prisma.document.findMany({
      where: { driverProfileId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByDriverAndType(driverProfileId: string, type: string): Promise<Document | null> {
    return this.prisma.document.findFirst({
      where: {
        driverProfileId,
        type: { equals: type, mode: 'insensitive' },
      },
    });
  }

  async create(data: CreateDocumentInput): Promise<Document> {
    return this.prisma.document.create({
      data: {
        driverProfileId: data.driverProfileId,
        type: data.type.toUpperCase(),
        documentUrl: data.documentUrl,
        number: data.number,
        frontImage: data.frontImage || data.documentUrl,
        backImage: data.backImage,
        expiresAt: data.expiresAt,
        status: data.status || VerificationStatus.PENDING,
        isVerified: data.isVerified ?? false,
      },
    });
  }

  async update(id: string, data: Prisma.DocumentUpdateInput): Promise<Document> {
    return this.prisma.document.update({
      where: { id },
      data,
    });
  }

  async updateStatus(
    id: string,
    status: VerificationStatus,
    rejectionReason?: string | null,
    isVerified?: boolean
  ): Promise<Document> {
    return this.prisma.document.update({
      where: { id },
      data: {
        status,
        rejectionReason: rejectionReason ?? (status === VerificationStatus.VERIFIED ? null : undefined),
        isVerified: isVerified !== undefined ? isVerified : status === VerificationStatus.VERIFIED,
      },
    });
  }

  async findExpiredDocuments(cutoff: Date = new Date()): Promise<Document[]> {
    return this.prisma.document.findMany({
      where: {
        expiresAt: { lt: cutoff },
        status: { not: VerificationStatus.REJECTED },
      },
    });
  }

  async delete(id: string): Promise<Document> {
    return this.prisma.document.delete({ where: { id } });
  }
}

