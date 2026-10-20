import { PrismaClient, OutboxEvent, Prisma } from '../db/client.js';

export interface StageEventData {
  topic: string;
  partitionKey: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  aggregateSequence: number;
  payload: Record<string, unknown> | unknown;
}

export class OutboxRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async stageEvent(
    tx: Prisma.TransactionClient,
    data: StageEventData
  ): Promise<OutboxEvent> {
    return tx.outboxEvent.create({
      data: {
        topic: data.topic,
        partitionKey: data.partitionKey,
        eventType: data.eventType,
        aggregateType: data.aggregateType,
        aggregateId: data.aggregateId,
        aggregateSequence: data.aggregateSequence,
        payload: data.payload as Prisma.InputJsonValue,
        status: 'PENDING'
      }
    });
  }
}
