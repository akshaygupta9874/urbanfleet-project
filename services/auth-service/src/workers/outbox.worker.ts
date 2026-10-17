import { OutboxRepository } from '../repositories/outbox.repository.js';
import { getAuthProducer } from '../events/auth.publisher.js';
import { createLogger } from '@urbanfleet/common';

const logger = createLogger('auth-outbox-worker');

export class OutboxWorker {
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(private outboxRepo: OutboxRepository) {}

  start(intervalMs = 3000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info(`Auth OutboxWorker started with polling interval ${intervalMs}ms`);

    this.intervalId = setInterval(async () => {
      try {
        await this.processPendingEvents();
      } catch (err) {
        logger.error('Error during outbox event processing iteration:', err);
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

  async processPendingEvents(): Promise<number> {
    const producer = getAuthProducer();
    if (!producer) {
      return 0; // Kafka not connected yet; events remain safely staged in DB
    }

    const events = await this.outboxRepo.getPendingEvents(20);
    let processedCount = 0;

    for (const event of events) {
      try {
        await producer.send({
          topic: event.topic,
          messages: [
            {
              key: event.partitionKey,
              value: typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload),
            },
          ],
        });

        await this.outboxRepo.markPublished(event.id);
        processedCount++;
      } catch (err: any) {
        logger.error(`Failed to publish outbox event ${event.id}:`, err);
        await this.outboxRepo.markFailed(event.id, err.message || String(err));
      }
    }

    return processedCount;
  }
}
