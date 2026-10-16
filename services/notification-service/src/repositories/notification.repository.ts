import { PrismaClient, NotificationRecord } from '@prisma/client';

export class NotificationRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: any): Promise<NotificationRecord> {
    return this.prisma.notificationRecord.create({ data });
  }

  async findPending(limit = 20): Promise<NotificationRecord[]> {
    return this.prisma.notificationRecord.findMany({
      where: { status: 'PENDING', retryCount: { lt: 5 } },
      orderBy: { createdAt: 'asc' },
      take: limit
    });
  }

  async markDispatched(id: string, gatewayMessageId?: string): Promise<NotificationRecord> {
    return this.prisma.notificationRecord.update({
      where: { id },
      data: {
        status: 'DISPATCHED',
        gatewayMessageId,
        dispatchedAt: new Date()
      }
    });
  }

  async recordFailure(id: string, error: string): Promise<NotificationRecord> {
    return this.prisma.notificationRecord.update({
      where: { id },
      data: {
        retryCount: { increment: 1 },
        lastError: error
      }
    });
  }
}
