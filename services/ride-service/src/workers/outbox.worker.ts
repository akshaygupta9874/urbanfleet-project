import { PrismaClient } from '../db/client.js';
import { Producer } from 'kafkajs';
import { createDurableProducer, createKafkaClient, createLogger } from '@urbanfleet/common';
import crypto from 'crypto';
import { KafkaEnvelope, DeadLetterEnvelope } from '@urbanfleet/contracts';

const logger = createLogger('ride-outbox-worker');
const workerId = `worker-${process.pid}-${Math.random().toString(36).substring(7)}`;

export interface RideOutboxRecord {
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
    const kafka = createKafkaClient('ride-outbox-publisher');
    this.producer = createDurableProducer(kafka);
    try {
      await this.producer.connect();
    } catch (err) {
      logger.warn('Kafka producer connection failed on startup. Outbox worker will attempt reconnect during run loop.');
    }
    this.isRunning = true;
    logger.info(`Ride Outbox Worker [${workerId}] started.`);

    this.runLoop();
  }

  private async runLoop() {
    while (this.isRunning) {
      try {
        await this.processPendingEvents();
      } catch (err) {
        logger.error('Error processing outbox events:', err);
      }
      await new Promise(resolve => setTimeout(resolve, 1000)); // Poll every second
    }
  }

  async processPendingEvents() {
    // Sequential aggregate claim with partition locking and lease recovery
    const candidateEvents = await this.prisma.$queryRaw<RideOutboxRecord[]>`
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
      const envelope: KafkaEnvelope<Record<string, unknown>> = {
        id: event.id,
        version: 1,
        eventType: event.eventType,
        producer: 'ride-service',
        timestamp: event.createdAt.toISOString(),
        partitionKey: event.partitionKey,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        aggregateSequence: event.aggregateSequence,
        payload: event.payload,
      };

      try {
        if (!this.producer) {
          throw new Error('Kafka producer is not connected');
        }

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
        logger.info(`Outbox published event ${event.id} [${event.eventType}] to ${event.topic}`);
      } catch (publishErr: unknown) {
        logger.error(`Failed to publish event ${event.id}:`, publishErr);

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
              serviceName: 'ride-service',
              failedAt: new Date().toISOString(),
              retryCount: nextRetry,
              error: {
                name: 'OutboxPublishExhaustionError',
                message: publishErr instanceof Error ? publishErr.message : String(publishErr),
              },
              payload: event.payload,
              originalValue: JSON.stringify(envelope),
              originalEnvelope: envelope,
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

        const persistedRetryCount = nextRetry;
        const newStatus = nextRetry >= 5 ? 'FAILED' : 'PENDING';
        const errorMessage = publishErr instanceof Error ? publishErr.message : typeof publishErr === 'string' ? publishErr : 'Unknown publication failure';

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
        logger.error('Error disconnecting Outbox Kafka producer:', err);
      }
    }
    logger.info(`Ride Outbox Worker [${workerId}] stopped.`);
  }

  isHealthy(): boolean {
    return this.isRunning;
  }
}
