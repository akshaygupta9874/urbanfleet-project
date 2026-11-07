import { Prisma, PrismaClient, NotificationRecord, NotificationChannel, NotificationStatus } from '../db/client.js';

export interface ListNotificationsParams {
  page?: number;
  limit?: number;
  recipient?: string;
  channel?: NotificationChannel;
  status?: NotificationStatus;
}

export interface ListNotificationsResult {
  items: NotificationRecord[];
  total: number;
}

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

  async list(params: ListNotificationsParams = {}): Promise<ListNotificationsResult> {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 25));
    const skip = (page - 1) * limit;

    const where: Prisma.NotificationRecordWhereInput = {};
    if (params.recipient) {
      where.recipient = params.recipient;
    }
    if (params.channel) {
      where.channel = params.channel;
    }
    if (params.status) {
      where.status = params.status;
    }

    const [items, total] = await Promise.all([
      this.prisma.notificationRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notificationRecord.count({ where }),
    ]);

    return { items, total };
  }

  async findPending(limit = 20): Promise<NotificationRecord[]> {
    return this.prisma.notificationRecord.findMany({
      where: { status: 'PENDING', retryCount: { lt: 5 } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async markDispatched(id: string, gatewayMessageId?: string): Promise<NotificationRecord> {
    return this.prisma.notificationRecord.update({
      where: { id },
      data: {
        status: 'DISPATCHED',
        gatewayMessageId,
        dispatchedAt: new Date(),
      },
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
