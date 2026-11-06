import { OutboxRepository } from '../repositories/outbox.repository.js';
import { getAuthProducer } from '../events/auth.publisher.js';
import { createLogger } from '@urbanfleet/common';
import { KafkaEnvelope, DeadLetterEnvelope } from '@urbanfleet/contracts';
import crypto from 'crypto';
import type { OutboxEvent } from '../db/client.js';

const logger = createLogger('auth-outbox-worker');

export class OutboxWorker {
  private isRunning = false;
  private isProcessing = false;
  private intervalId: NodeJS.Timeout | null = null;
  private readonly workerId = `auth-outbox-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  private readonly outboxRepo: OutboxRepository;

  constructor(outboxRepo: OutboxRepository) {
    this.outboxRepo = outboxRepo;
  }

  start(intervalMs = 3000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info(`Auth OutboxWorker started with polling interval ${intervalMs}ms [worker: ${this.workerId}]`);

    this.intervalId = setInterval(async () => {
      if (this.isProcessing) return;
      this.isProcessing = true;
      try {
        await this.processPendingEvents();
      } catch (err) {
        logger.error('Error during outbox event processing iteration:', err);
      } finally {
        this.isProcessing = false;
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('Auth OutboxWorker stopped.');
  }

  isHealthy(): boolean {
    return this.isRunning;
  }

  async processPendingEvents(): Promise<number> {
    const producer = getAuthProducer();
    if (!producer) {
      return 0;
    }

    const events: OutboxEvent[] = await this.outboxRepo.claimPendingEvents(this.workerId, 20);
    if (!events || events.length === 0) return 0;
    let processedCount = 0;

    for (const event of events) {
      // Direct domain payload (with graceful extraction if previously stored with legacy envelope wrapper)
      const rawPayload = (typeof event.payload === 'object' && event.payload !== null)
        ? (event.payload as Record<string, unknown>)
        : {};
      const domainPayload: Record<string, unknown> = (rawPayload.payload && typeof rawPayload.payload === 'object' && rawPayload.eventType)
        ? (rawPayload.payload as Record<string, unknown>)
        : rawPayload;

      const envelope: KafkaEnvelope<Record<string, unknown>> = {
        id: event.id,
        version: 1,
        eventType: event.eventType,
        producer: 'auth-service',
        timestamp: event.createdAt.toISOString(),
        partitionKey: event.partitionKey,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        aggregateSequence: event.aggregateSequence,
        payload: domainPayload,
      };

      try {
        await producer.send({
          acks: -1,
          topic: event.topic,
          messages: [
            {
              key: event.partitionKey,
              value: JSON.stringify(envelope),
            },
          ],
        });

        await this.outboxRepo.markPublished(event.id);
        processedCount++;
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(`Failed to publish outbox event ${event.id}:`, err);

        const nextRetry = event.retryCount + 1;
        let deadLettered = false;

        if (nextRetry >= 5 && producer) {
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
              serviceName: 'auth-service',
              failedAt: new Date().toISOString(),
              retryCount: nextRetry,
              error: {
                name: 'OutboxPublishExhaustionError',
                message: errorMsg,
              },
              payload: domainPayload,
              originalValue: JSON.stringify(envelope),
              originalEnvelope: envelope,
            };

            await producer.send({
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

        if (deadLettered) {
          await this.outboxRepo.markFailed(event.id, errorMsg);
        } else {
          logger.error(`Keeping outbox event ${event.id} retryable because DLQ publication was not confirmed.`);
          await this.outboxRepo.markRetryable(event.id, errorMsg);
        }
      }
    }

    return processedCount;
  }
}
