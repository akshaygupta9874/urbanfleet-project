import { OutboxRepository } from '../repositories/outbox.repository.js';
import { getAuthProducer } from '../events/auth.publisher.js';
import { createLogger } from '@urbanfleet/common';
import crypto from 'crypto';

const logger = createLogger('auth-outbox-worker');

export class OutboxWorker {
  private isRunning = false;
  private isProcessing = false;
  private intervalId: NodeJS.Timeout | null = null;
  private workerId = `auth-outbox-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  private outboxRepo: OutboxRepository;

  constructor(outboxRepo: OutboxRepository) {
    this.outboxRepo = outboxRepo;
  }

  start(intervalMs = 3000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info(`Auth OutboxWorker started with polling interval ${intervalMs}ms [worker: ${this.workerId}]`);

    this.intervalId = setInterval(async () => {
      if (this.isProcessing) return; // Prevent overlapping iterations
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
      return 0; // Kafka not connected yet; events remain safely staged in DB
    }

    const events = (this.outboxRepo && typeof this.outboxRepo.claimPendingEvents === 'function')
      ? await this.outboxRepo.claimPendingEvents(this.workerId, 20)
      : await this.outboxRepo.getPendingEvents(20);

    if (!events || events.length === 0) return 0;
    let processedCount = 0;

    for (const event of events) {
      const evObj = event as unknown as Record<string, unknown>;
      let envelopePayload: unknown = event.payload;
      if (typeof envelopePayload === 'string') {
        try {
          envelopePayload = JSON.parse(envelopePayload);
        } catch (parseErr: unknown) {
          logger.debug('Outbox payload is not valid JSON string, keeping raw string', {
            eventId: event.id,
            error: parseErr instanceof Error ? parseErr.message : String(parseErr),
          });
        }
      }
      const eventType = String(event.eventType || evObj.event_type || '');
      const partitionKey = String(event.partitionKey || evObj.partition_key || '');
      const aggregateType = String(event.aggregateType || evObj.aggregate_type || 'USER');
      const aggregateId = String(event.aggregateId || evObj.aggregate_id || '');
      const aggregateSequence = Number(event.aggregateSequence || evObj.aggregate_sequence || 1);

      try {
        // Ensure payload is enveloped
        const payloadObj = envelopePayload as Record<string, unknown> | null;
        const envelope = (payloadObj && payloadObj.eventType && payloadObj.id)
          ? envelopePayload
          : {
              id: event.id,
              version: 1,
              eventType,
              producer: 'auth-service',
              timestamp: event.createdAt ? new Date(event.createdAt).toISOString() : new Date().toISOString(),
              partitionKey,
              aggregateType,
              aggregateId,
              aggregateSequence,
              payload: envelopePayload,
            };

        await producer.send({
          acks: -1,
          topic: event.topic,
          messages: [
            {
              key: partitionKey,
              value: JSON.stringify(envelope),
            },
          ],
        });

        await this.outboxRepo.markPublished(event.id);
        processedCount++;
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(`Failed to publish outbox event ${event.id}:`, err);
        let deadLettered = false;
        if (((event.retryCount || 0) + 1) >= 5 && producer) {
          try {
            const dlqTopic = `${event.topic}.DLQ`;
            const replayableEnvelope = {
              id: event.id,
              version: 1,
              eventType,
              producer: 'auth-service',
              timestamp: event.createdAt ? new Date(event.createdAt).toISOString() : new Date().toISOString(),
              partitionKey,
              aggregateType,
              aggregateId,
              aggregateSequence,
              payload: envelopePayload,
            };
            const dlqEnvelope = {
              id: crypto.randomUUID(),
              originalEventId: event.id,
              originalTopic: event.topic,
              originalPartition: 0,
              originalOffset: '0',
              originalKey: (event as any).partitionKey || event.id,
              consumerGroup: 'outbox-publisher',
              serviceName: 'auth-service',
              failedAt: new Date().toISOString(),
              retryCount: (event.retryCount || 0) + 1,
              error: {
                name: 'OutboxPublishExhaustionError',
                message: errorMsg,
              },
              payload: envelopePayload,
              originalValue: JSON.stringify(replayableEnvelope),
              originalEnvelope: replayableEnvelope,
            };
            await producer.send({
              topic: dlqTopic,
              messages: [{ key: (event as any).partitionKey || event.id, value: JSON.stringify(dlqEnvelope) }],
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
