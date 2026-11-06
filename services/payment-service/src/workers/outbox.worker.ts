import { PrismaClient } from '../db/client.js';
import { Producer } from 'kafkajs';
import { createKafkaClient, createDurableProducer, createLogger } from '@urbanfleet/common';
import { KafkaEnvelope, DeadLetterEnvelope } from '@urbanfleet/contracts';
import crypto from 'crypto';

const logger = createLogger('payment-outbox-worker');
const workerId = `worker-${process.pid}-${Math.random().toString(36).substring(7)}`;

export interface PaymentOutboxRecord {
  id: string;
  topic: string;
  partitionKey: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  aggregateSequence: number;
  payload: Record<string, unknown>;
  createdAt: Date;
  retryCount: number;
}

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

  async processPendingEvents() {
    const candidateEvents = await this.prisma.$queryRaw<PaymentOutboxRecord[]>`
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
      RETURNING
        id,
        topic,
        partition_key AS "partitionKey",
        event_type AS "eventType",
        aggregate_type AS "aggregateType",
        aggregate_id AS "aggregateId",
        aggregate_sequence AS "aggregateSequence",
        payload,
        created_at AS "createdAt",
        retry_count AS "retryCount";
    `;

    if (!candidateEvents || candidateEvents.length === 0) return;

    for (const event of candidateEvents) {
      try {
        if (!this.producer) {
          throw new Error('Kafka producer not connected');
        }

        const envelope: KafkaEnvelope<Record<string, unknown>> = {
          id: event.id,
          version: 1,
          eventType: event.eventType,
          producer: 'payment-service',
          timestamp: event.createdAt.toISOString(),
          partitionKey: event.partitionKey,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          aggregateSequence: event.aggregateSequence,
          payload: event.payload,
        };

        await this.producer.send({
          acks: -1,
          topic: event.topic,
          messages: [{ key: event.partitionKey, value: JSON.stringify(envelope) }]
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

        const nextRetry = event.retryCount + 1;
        let deadLettered = false;

        if (nextRetry >= 5 && this.producer) {
          try {
            const dlqTopic = `${event.topic}.DLQ`;
            const dlqEnvelope: DeadLetterEnvelope<Record<string, unknown>> = {
              id: crypto.randomUUID(),
              originalEventId: event.id,
              originalTopic: event.topic,
              originalPartition: 0,
              originalOffset: '0',
              originalKey: event.partitionKey,
              consumerGroup: 'outbox-publisher',
              serviceName: 'payment-service',
              failedAt: new Date().toISOString(),
              retryCount: nextRetry,
              error: {
                name: 'OutboxPublishExhaustionError',
                message: errorMessage,
              },
              payload: event.payload,
              originalValue: JSON.stringify({
                id: event.id,
                version: 1,
                eventType: event.eventType,
                producer: 'payment-service',
                timestamp: event.createdAt.toISOString(),
                partitionKey: event.partitionKey,
                aggregateType: event.aggregateType,
                aggregateId: event.aggregateId,
                aggregateSequence: event.aggregateSequence,
                payload: event.payload,
              }),
            };
            await this.producer.send({
              acks: -1,
              topic: dlqTopic,
              messages: [{ key: event.partitionKey, value: JSON.stringify(dlqEnvelope) }],
            });
            deadLettered = true;
            logger.error(`[OUTBOX_DLQ] Event ${event.id} exhausted retries and was sent to DLQ topic ${dlqTopic}`);
          } catch (dlqErr) {
            logger.error(`Failed to dispatch exhausted outbox event ${event.id} to DLQ:`, dlqErr);
          }
        }

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

  isHealthy(): boolean {
    return this.isRunning;
  }
}
