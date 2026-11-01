import { Producer } from 'kafkajs';
import { createDurableProducer, createKafkaClient, createLogger } from '@urbanfleet/common';

const logger = createLogger('auth-event-publisher');
let producer: Producer | null = null;

export async function initAuthPublisher(): Promise<void> {
  const kafka = createKafkaClient('auth-service');
  producer = createDurableProducer(kafka);

  try {
    await producer.connect();
    logger.info('Connected to Kafka broker(s) for auth outbox events.');
  } catch (err) {
    logger.error('Failed to connect to Kafka producer:', err);
  }
}

export function getAuthProducer(): Producer | null {
  return producer;
}
