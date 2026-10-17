import { PrismaClient, AuditLog } from '../db/client.js';

export class AuditRepository {
  constructor(private prisma: PrismaClient) {}

  async record(data: {
    userId?: string;
    action: string;
    ipAddress?: string;
    metadata?: any;
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
