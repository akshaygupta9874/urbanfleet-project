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
      aggregateSequence: number;
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
        aggregateSequence: data.aggregateSequence,
        payload: data.payload,
        status: 'PENDING'
      }
    });
  }
}
