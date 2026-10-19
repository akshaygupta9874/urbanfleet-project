import { PrismaClient } from '../db/client.js';
import { Kafka, Producer } from 'kafkajs';
import { createLogger } from '@urbanfleet/common';

const logger = createLogger('payment-outbox-worker');
const workerId = `worker-${process.pid}-${Math.random().toString(36).substring(7)}`;

export class OutboxWorker {
  private isRunning = false;
  private producer: Producer | null = null;

  constructor(private prisma: PrismaClient) {}

  async start() {
    const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
    const kafka = new Kafka({ clientId: 'payment-outbox-publisher', brokers });
    this.producer = kafka.producer();
    await this.producer.connect();
    this.isRunning = true;
    logger.info(`Payment Outbox Worker [${workerId}] started.`);

    this.runLoop();
  }

  private async runLoop() {
    while (this.isRunning) {
      try {
        await this.processPendingEvents();
      } catch (err) {
        logger.error('Error processing payment outbox events:', err);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  private async processPendingEvents() {
    const candidateEvents = await this.prisma.$queryRaw<Array<{
      id: string;
      topic: string;
      partition_key: string;
      event_type: string;
      aggregate_type: string;
      aggregate_id: string;
      aggregate_sequence: number;
      payload: any;
      created_at: Date;
      retry_count: number;
    }>>`
      WITH active_partitions AS (
        SELECT DISTINCT partition_key
        FROM outbox_events
        WHERE status = 'PROCESSING' AND lease_expires_at >= NOW()
      ),
      locked_candidates AS (
        SELECT id, partition_key, aggregate_sequence
        FROM outbox_events
        WHERE (status = 'PENDING' OR (status = 'PROCESSING' AND lease_expires_at < NOW()))
          AND partition_key NOT IN (SELECT partition_key FROM active_partitions)
          AND retry_count < 5
        ORDER BY partition_key, aggregate_sequence ASC
        LIMIT 25
        FOR UPDATE SKIP LOCKED
      ),
      eligible_events AS (
        SELECT DISTINCT ON (partition_key) id
        FROM locked_candidates
        ORDER BY partition_key, aggregate_sequence ASC
      )
      UPDATE outbox_events
      SET status = 'PROCESSING',
          locked_at = NOW(),
          locked_by = ${workerId},
          lease_expires_at = NOW() + INTERVAL '30 seconds'
      WHERE id IN (SELECT id FROM eligible_events)
      RETURNING id, topic, partition_key, event_type, aggregate_type, aggregate_id, aggregate_sequence, payload, created_at, retry_count;
    `;

    if (!candidateEvents || candidateEvents.length === 0) return;

    for (const event of candidateEvents) {
      try {
        if (!this.producer) {
          throw new Error('Kafka producer not connected');
        }

        const envelope = {
          id: event.id,
          version: 1,
          eventType: event.event_type || 'PAYMENT_EVENT',
          producer: 'payment-service',
          timestamp: event.created_at ? new Date(event.created_at).toISOString() : new Date().toISOString(),
          partitionKey: event.partition_key,
          aggregateType: event.aggregate_type || 'PAYMENT',
          aggregateId: event.aggregate_id || event.partition_key,
          aggregateSequence: Number(event.aggregate_sequence || 1),
          payload: typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload,
        };

        await this.producer.send({
          topic: event.topic,
          messages: [{ key: event.partition_key, value: JSON.stringify(envelope) }]
        });

        await this.prisma.$executeRaw`
          UPDATE outbox_events
          SET status = 'PUBLISHED', published_at = NOW()
          WHERE id = ${event.id}::uuid;
        `;
        logger.info(`Payment outbox published event ${event.id} to ${event.topic}`);
      } catch (publishErr: any) {
        logger.error(`Failed to publish payment event ${event.id}:`, publishErr);
        const nextRetry = (event.retry_count || 0) + 1;
        const newStatus = nextRetry >= 5 ? 'FAILED' : 'PENDING';

        await this.prisma.$executeRaw`
          UPDATE outbox_events
          SET status = ${newStatus}::"OutboxStatus",
              retry_count = ${nextRetry},
              last_error = ${publishErr.message}
          WHERE id = ${event.id}::uuid;
        `;
      }
    }
  }

  async stop() {
    this.isRunning = false;
    if (this.producer) {
      try {
        await this.producer.disconnect();
      } catch (err) {
        logger.error('Error disconnecting payment outbox producer:', err);
      }
    }
  }
}
