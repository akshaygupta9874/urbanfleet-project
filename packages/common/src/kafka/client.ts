import { Kafka, KafkaConfig, Producer, Consumer } from 'kafkajs';

export function getKafkaBrokers(): string[] {
  const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092')
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean);

  if (brokers.length === 0) {
    throw new Error('KAFKA_BROKERS must contain at least one broker');
  }

  return brokers;
}

export function createKafkaClient(clientId: string): Kafka {
  const config: KafkaConfig = {
    clientId,
    brokers: getKafkaBrokers(),
    connectionTimeout: Number(process.env.KAFKA_CONNECTION_TIMEOUT_MS || 10_000),
    authenticationTimeout: Number(process.env.KAFKA_AUTHENTICATION_TIMEOUT_MS || 10_000),
    requestTimeout: Number(process.env.KAFKA_REQUEST_TIMEOUT_MS || 30_000),
    retry: {
      retries: Number(process.env.KAFKA_CLIENT_RETRIES || 8),
      initialRetryTime: 300,
      maxRetryTime: 30_000,
    },
  };

  return new Kafka(config);
}

export function createDurableProducer(kafka: Kafka): Producer {
  return kafka.producer({
    idempotent: true,
    maxInFlightRequests: 5,
    allowAutoTopicCreation: false,
  });
}

export function createKafkaConsumer(
  kafka: Kafka,
  groupId: string,
  allowAutoTopicCreation = false
): Consumer {
  return kafka.consumer({ groupId, allowAutoTopicCreation });
}
