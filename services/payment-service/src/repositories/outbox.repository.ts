import { PrismaClient, OutboxEvent, Prisma } from '../db/client.js';

export class OutboxRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async stageEvent(
    tx: Prisma.TransactionClient | PrismaClient | null | undefined,
    data: {
      topic: string;
      partitionKey: string;
      eventType: string;
      aggregateType: string;
      aggregateId: string;
      aggregateSequence: number;
      payload: Prisma.InputJsonValue;
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
        aggregateSequence: data.aggregateSequence,
        payload: data.payload,
        status: 'PENDING'
      }
    });
  }
}
