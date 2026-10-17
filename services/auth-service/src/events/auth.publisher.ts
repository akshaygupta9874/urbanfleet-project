import { Kafka, Producer } from 'kafkajs';
import { createLogger } from '@urbanfleet/common';
import { EventTopics, KafkaEnvelope, UserRegisteredPayload } from '@urbanfleet/contracts';
import crypto from 'crypto';

const logger = createLogger('auth-event-publisher');

let producer: Producer | null = null;

export async function initAuthPublisher(): Promise<void> {
  const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
  const kafka = new Kafka({
    clientId: 'auth-service',
    brokers
  });

  producer = kafka.producer();
  try {
    await producer.connect();
    logger.info('Connected to Kafka broker(s) for auth events.');
  } catch (err) {
    logger.error('Failed to connect to Kafka producer:', err);
  }
}

export async function publishUserRegistered(payload: UserRegisteredPayload): Promise<void> {
  if (!producer) {
    logger.warn('Kafka producer not connected. Event publication skipped.');
    return;
  }

  const envelope: KafkaEnvelope<UserRegisteredPayload> = {
    id: crypto.randomUUID(),
    version: 1,
    eventType: 'USER_REGISTERED',
    producer: 'auth-service',
    timestamp: new Date().toISOString(),
    partitionKey: payload.userId,
    aggregateType: 'USER',
    aggregateId: payload.userId,
    aggregateSequence: 1,
    payload
  };

  try {
    await producer.send({
      topic: EventTopics.AUTH_EVENTS,
      messages: [
        {
          key: envelope.partitionKey,
          value: JSON.stringify(envelope)
        }
      ]
    });
    logger.info(`Published UserRegistered event for user ${payload.userId}`);
  } catch (err) {
    logger.error(`Error publishing UserRegistered event:`, err);
  }
}
