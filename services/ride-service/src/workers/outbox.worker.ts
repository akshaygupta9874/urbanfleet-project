import { PrismaClient } from '@prisma/client';
import { Kafka, Producer } from 'kafkajs';
import { createLogger } from '@urbanfleet/common';

const logger = createLogger('ride-outbox-worker');
const workerId = `worker-${process.pid}-${Math.random().toString(36).substring(7)}`;

export class OutboxWorker {
  private isRunning = false;
  private producer: Producer | null = null;

  constructor(private prisma: PrismaClient) {}

  async start() {
    const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
    const kafka = new Kafka({ clientId: 'ride-outbox-publisher', brokers });
    this.producer = kafka.producer();
    await this.producer.connect();
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

  private async processPendingEvents() {
    // Sequential aggregate claim with lease recovery
    const candidateEvents = await this.prisma.$queryRaw<Array<{ id: string; topic: string; partition_key: string; payload: any }>>`
      WITH eligible_events AS (
        SELECT DISTINCT ON (partition_key) id
        FROM outbox_events
        WHERE status = 'PENDING'
           OR (status = 'PROCESSING' AND lease_expires_at < NOW())
        ORDER BY partition_key, aggregate_sequence ASC
        LIMIT 25
      )
      UPDATE outbox_events
      SET status = 'PROCESSING',
          locked_at = NOW(),
          locked_by = ${workerId},
          lease_expires_at = NOW() + INTERVAL '30 seconds'
      WHERE id IN (SELECT id FROM eligible_events)
      RETURNING id, topic, partition_key, payload;
    `;

    if (!candidateEvents || candidateEvents.length === 0) return;

    for (const event of candidateEvents) {
      try {
        await this.producer!.send({
          topic: event.topic,
          messages: [{ key: event.partition_key, value: JSON.stringify(event.payload) }]
        });

        await this.prisma.$executeRaw`
          UPDATE outbox_events
          SET status = 'PUBLISHED', published_at = NOW()
          WHERE id = ${event.id}::uuid;
        `;
        logger.info(`Outbox published event ${event.id} to ${event.topic}`);
      } catch (publishErr: any) {
        logger.error(`Failed to publish event ${event.id}:`, publishErr);
        await this.prisma.$executeRaw`
          UPDATE outbox_events
          SET status = 'PENDING', retry_count = retry_count + 1, last_error = ${publishErr.message}
          WHERE id = ${event.id}::uuid;
        `;
      }
    }
  }

  stop() {
    this.isRunning = false;
  }
}
