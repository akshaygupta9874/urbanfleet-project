import { PrismaClient, AuditLog, Prisma } from '../db/client.js';

export class AuditRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async record(data: {
    userId?: string;
    action: string;
    ipAddress?: string;
    metadata?: Prisma.InputJsonValue;
  }): Promise<AuditLog> {
    return this.prisma.auditLog.create({ data });
  }

  async findByUserId(userId: string): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
  }
}
