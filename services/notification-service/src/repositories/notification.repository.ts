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
    const existing = await this.prisma.notificationRecord.findUnique({ where: { id } });
    const nextRetry = (existing?.retryCount || 0) + 1;
    const isTerminal = nextRetry >= 5;

    return this.prisma.notificationRecord.update({
      where: { id },
      data: {
        retryCount: nextRetry,
        lastError: error,
        ...(isTerminal ? { status: 'FAILED' } : {}),
      },
    });
  }

  async findFailed(limit = 20): Promise<NotificationRecord[]> {
    return this.prisma.notificationRecord.findMany({
      where: { status: 'FAILED' },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
  }
}
