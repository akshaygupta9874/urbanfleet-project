import { PrismaClient, OutboxEvent } from '@prisma/client';

export class OutboxRepository {
  constructor(private prisma: PrismaClient) {}

  async stageEvent(
    tx: any,
    data: {
      topic: string;
      partitionKey: string;
      eventType: string;
      aggregateType: string;
      aggregateId: string;
      aggregateSequence?: number;
      payload: any;
    }
  ): Promise<OutboxEvent> {
    const client = tx || this.prisma;
    return client.outboxEvent.create({
      data: {
        topic: data.topic,
        partitionKey: data.partitionKey,
        eventType: data.eventType,
        aggregateType: data.aggregateType,
        aggregateId: data.aggregateId,
        aggregateSequence: data.aggregateSequence || 1,
        payload: data.payload,
        status: 'PENDING',
      },
    });
  }

  async getPendingEvents(limit = 20): Promise<OutboxEvent[]> {
    return this.prisma.outboxEvent.findMany({
      where: {
        status: 'PENDING',
        OR: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lt: new Date() } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async markPublished(id: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: {
        status: 'FAILED',
        lastError: error,
        retryCount: { increment: 1 },
      },
    });
  }
}
