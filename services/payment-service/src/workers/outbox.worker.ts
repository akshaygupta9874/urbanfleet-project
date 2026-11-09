import { PrismaClient } from '../db/client.js';
import { Producer } from 'kafkajs';
import { createKafkaClient, createDurableProducer, createLogger } from '@urbanfleet/common';
import { KafkaEnvelope, DeadLetterEnvelope } from '@urbanfleet/contracts';
import crypto from 'crypto';

const logger = createLogger('payment-outbox-worker');
const workerId = `worker-${process.pid}-${Math.random().toString(36).substring(2, 9)}`;

const MAX_PUBLISH_RETRIES = 5;
const HARD_MAX_RETRIES_WHEN_DLQ_FAILS = 8;
const POLL_INTERVAL_MS = 1000;

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
  private loopPromise: Promise<void> | null = null;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    const kafka = createKafkaClient('payment-outbox-publisher');
    this.producer = createDurableProducer(kafka);
    await this.producer.connect();
    this.isRunning = true;
    logger.info(`Payment Outbox Worker [${workerId}] started.`);

    this.loopPromise = this.runLoop();
  }

  private async runLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.processPendingEvents();
      } catch (err) {
        logger.error('Error processing payment outbox events:', err);
      }

      if (!this.isRunning) break;

      await new Promise<void>((resolve) => {
        this.pollTimer = setTimeout(() => {
          this.pollTimer = null;
          resolve();
        }, POLL_INTERVAL_MS);
      });
    }
  }

  async processPendingEvents(): Promise<void> {
    /**
     * Step 1: Identify partitions with an active in-flight lease.
     * Step 2: Find the single earliest sequence event (head-of-line) per idle partition.
     * Step 3: Lock up to 25 head-of-line events ordered by creation time (fairness across partitions)
     *         using FOR UPDATE SKIP LOCKED so two workers never grab seq=1 and seq=2 concurrently.
     */
    const candidateEvents = await this.prisma.$queryRaw<PaymentOutboxRecord[]>`
      WITH active_partitions AS (
        SELECT partition_key
        FROM outbox_events
        WHERE status = 'PROCESSING'
          AND lease_expires_at >= NOW()
      ),
      head_of_line_per_partition AS (
        SELECT DISTINCT ON (e.partition_key)
          e.id,
          e.created_at
        FROM outbox_events e
        WHERE (
            e.status = 'PENDING'
            OR (e.status = 'PROCESSING' AND e.lease_expires_at < NOW())
          )
          AND e.retry_count < ${HARD_MAX_RETRIES_WHEN_DLQ_FAILS}
          AND (
            e.retry_count = 0
            OR e.locked_at IS NULL
            OR e.locked_at + (LEAST(e.retry_count, 5) * INTERVAL '2 seconds') <= NOW()
          )
          AND NOT EXISTS (
            SELECT 1
            FROM active_partitions ap
            WHERE ap.partition_key = e.partition_key
          )
        ORDER BY e.partition_key, e.aggregate_sequence ASC, e.created_at ASC
      ),
      locked_batch AS (
        SELECT o.id
        FROM outbox_events o
        INNER JOIN head_of_line_per_partition h ON h.id = o.id
        WHERE o.status = 'PENDING'
           OR (o.status = 'PROCESSING' AND o.lease_expires_at < NOW())
        ORDER BY h.created_at ASC
        LIMIT 25
        FOR UPDATE OF o SKIP LOCKED
      )
      UPDATE outbox_events
      SET status = 'PROCESSING'::text::"OutboxStatus",
          locked_at = NOW(),
          locked_by = ${workerId},
          lease_expires_at = NOW() + INTERVAL '30 seconds'
      WHERE id IN (SELECT id FROM locked_batch)
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
      if (!this.isRunning) break;

      try {
        if (!this.producer) {
          throw new Error('Kafka producer not connected');
        }

        const envelope: KafkaEnvelope<Record<string, unknown>> = {
          id: event.id,
          version: 1,
          eventType: event.eventType,
          producer: 'payment-service',
          timestamp: new Date(event.createdAt).toISOString(),
          partitionKey: event.partitionKey,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          aggregateSequence: event.aggregateSequence,
          payload: event.payload,
        };

        await this.producer.send({
          acks: -1,
          topic: event.topic,
          messages: [
            {
              key: event.partitionKey,
              value: JSON.stringify(envelope),
              headers: {
                'x-event-id': event.id,
                'x-event-type': event.eventType,
                'x-producer': 'payment-service',
              },
            },
          ],
        });

        await this.prisma.$executeRaw`
          UPDATE outbox_events
          SET status = 'PUBLISHED'::text::"OutboxStatus",
              published_at = NOW(),
              lease_expires_at = NULL,
              last_error = NULL
          WHERE id = ${event.id}::uuid
            AND locked_by = ${workerId};
        `;

        logger.info(`Payment outbox published event ${event.id} (${event.eventType}) to ${event.topic}`);
      } catch (publishErr: unknown) {
        const errorMessage =
          publishErr instanceof Error ? publishErr.message : String(publishErr);
        logger.error(`Failed to publish payment event ${event.id}:`, publishErr);

        const nextRetry = event.retryCount + 1;
        let deadLettered = false;

        if (nextRetry >= MAX_PUBLISH_RETRIES && this.producer) {
          try {
            const dlqTopic = `${event.topic}.DLQ`;
            const dlqEnvelope: DeadLetterEnvelope<Record<string, unknown>> = {
              id: crypto.randomUUID(),
              originalEventId: event.id,
              originalTopic: event.topic,
              originalPartition: -1,
              originalOffset: String(event.aggregateSequence),
              originalKey: event.partitionKey,
              consumerGroup: 'outbox-publisher',
              serviceName: 'payment-service',
              failedAt: new Date().toISOString(),
              retryCount: nextRetry,
              error: {
                name: 'OutboxPublishExhaustionError',
                message: errorMessage,
                stack: publishErr instanceof Error ? publishErr.stack : undefined,
              },
              payload: event.payload,
              originalValue: JSON.stringify({
                id: event.id,
                version: 1,
                eventType: event.eventType,
                producer: 'payment-service',
                timestamp: new Date(event.createdAt).toISOString(),
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
            logger.error(
              `[OUTBOX_DLQ] Event ${event.id} exhausted retries and was sent to DLQ topic ${dlqTopic}`
            );
          } catch (dlqErr) {
            logger.error(`Failed to dispatch exhausted outbox event ${event.id} to DLQ:`, dlqErr);
          }
        }

        const markAsFailed =
          deadLettered || nextRetry >= HARD_MAX_RETRIES_WHEN_DLQ_FAILS;
        const newStatus = markAsFailed ? 'FAILED' : 'PENDING';

        await this.prisma.$executeRaw`
          UPDATE outbox_events
          SET status = ${newStatus}::text::"OutboxStatus",
              retry_count = ${nextRetry},
              lease_expires_at = NULL,
              last_error = ${errorMessage}
          WHERE id = ${event.id}::uuid;
        `;
      }
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.loopPromise) {
      try {
        await this.loopPromise;
      } catch (err) {
        logger.error('Error while waiting for outbox loop to finish:', err);
      }
      this.loopPromise = null;
    }

    if (this.producer) {
      try {
        await this.producer.disconnect();
      } catch (err) {
        logger.error('Error disconnecting payment outbox producer:', err);
      }
      this.producer = null;
    }

    logger.info(`Payment Outbox Worker [${workerId}] stopped.`);
  }

  isHealthy(): boolean {
    return this.isRunning && this.producer !== null;
  }
}