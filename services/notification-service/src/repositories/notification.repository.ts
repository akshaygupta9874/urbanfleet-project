import { Prisma, PrismaClient, NotificationRecord } from '../db/client.js';

export class NotificationRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async create(data: Prisma.NotificationRecordCreateInput): Promise<NotificationRecord> {
    return this.prisma.notificationRecord.create({ data });
  }

  async findById(id: string): Promise<NotificationRecord | null> {
    return this.prisma.notificationRecord.findUnique({ where: { id } });
  }

  async findByRecipients(recipients: string[], limit = 50): Promise<NotificationRecord[]> {
    if (recipients.length === 0) return [];
    const conditions = recipients.map((r) => ({ recipient: r }));
    return this.prisma.notificationRecord.findMany({
      where: conditions.length === 1 ? conditions[0] : { OR: conditions },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
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
