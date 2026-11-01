import { PrismaClient } from '../db/client.js';
import { Kafka, Producer } from 'kafkajs';
import { createKafkaClient, createDurableProducer, createLogger } from '@urbanfleet/common';
import crypto from 'crypto';

const logger = createLogger('payment-outbox-worker');
const workerId = `worker-${process.pid}-${Math.random().toString(36).substring(7)}`;

export class OutboxWorker {
  private isRunning = false;
  private producer: Producer | null = null;
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async start() {
    const kafka = createKafkaClient('payment-outbox-publisher');
    this.producer = createDurableProducer(kafka);
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
      payload: unknown;
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
          aggregateId: event.aggregate_id,
          aggregateSequence: Number(event.aggregate_sequence || 1),
          payload: typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload,
        };

        await this.producer.send({
          acks: -1,
          topic: event.topic,
          messages: [{ key: event.partition_key, value: JSON.stringify(envelope) }]
        });

        await this.prisma.$executeRaw`
          UPDATE outbox_events
          SET status = 'PUBLISHED', published_at = NOW()
          WHERE id = ${event.id}::uuid;
        `;
        logger.info(`Payment outbox published event ${event.id} to ${event.topic}`);
      } catch (publishErr: unknown) {
        const errorMessage = publishErr instanceof Error ? publishErr.message : String(publishErr);
        logger.error(`Failed to publish payment event ${event.id}:`, publishErr);
        let deadLettered = false;
        if (((event.retry_count || 0) + 1) >= 5 && this.producer) {
          try {
            const dlqTopic = `${event.topic}.DLQ`;
            const eventPayload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
            const replayableEnvelope = {
              id: event.id,
              version: 1,
              eventType: event.event_type || 'PAYMENT_EVENT',
              producer: 'payment-service',
              timestamp: event.created_at ? new Date(event.created_at).toISOString() : new Date().toISOString(),
              partitionKey: event.partition_key,
              aggregateType: event.aggregate_type || 'PAYMENT',
              aggregateId: event.aggregate_id,
              aggregateSequence: Number(event.aggregate_sequence || 1),
              payload: eventPayload,
            };
            const dlqEnvelope = {
              id: crypto.randomUUID(),
              originalEventId: event.id,
              originalTopic: event.topic,
              originalPartition: 0,
              originalOffset: '0',
              originalKey: event.partition_key,
              consumerGroup: 'outbox-publisher',
              serviceName: 'payment-service',
              failedAt: new Date().toISOString(),
              retryCount: (event.retry_count || 0) + 1,
              error: {
                name: 'OutboxPublishExhaustionError',
                message: errorMessage,
              },
              payload: eventPayload,
              originalValue: JSON.stringify(replayableEnvelope),
              originalEnvelope: replayableEnvelope,
            };
            await this.producer.send({
              acks: -1,
              topic: dlqTopic,
              messages: [{ key: event.partition_key, value: JSON.stringify(dlqEnvelope) }],
            });
            deadLettered = true;
            logger.error(`[OUTBOX_DLQ] Event ${event.id} exhausted retries and was sent to DLQ topic ${dlqTopic}`);
          } catch (dlqErr) {
            logger.error(`Failed to dispatch exhausted outbox event ${event.id} to DLQ:`, dlqErr);
          }
        }
        const nextRetry = (event.retry_count || 0) + 1;
        const persistedRetryCount = deadLettered ? nextRetry : Math.min(nextRetry, 4);
        const newStatus = deadLettered ? 'FAILED' : 'PENDING';

        await this.prisma.$executeRaw`
          UPDATE outbox_events
          SET status = ${newStatus}::"OutboxStatus",
              retry_count = ${persistedRetryCount},
              last_error = ${errorMessage}
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
