import { Kafka, Consumer, Producer, EachMessagePayload } from 'kafkajs';
import crypto from 'crypto';
import { createLogger } from '../logger/logger.js';
import { createDurableProducer } from './client.js';
import {
  DeadLetterEnvelope,
  KafkaEnvelope,
  KafkaEnvelopeSchema,
} from '@urbanfleet/contracts';

const logger = createLogger('resilient-consumer');

export interface ResilientConsumerConfig {
  kafka: Kafka;
  consumer: Consumer;
  consumerGroup: string;
  serviceName: string;
  maxRetries?: number;        // Default: 3
  initialBackoffMs?: number;  // Default: 500ms
  backoffMultiplier?: number; // Default: 2
  maxBackoffMs?: number;      // Default: 5000ms
  dlqTopicResolver?: (originalTopic: string) => string;
}

export interface RouteToDlqParams {
  targetTopic?: string;
  originalTopic: string;
  partition: number;
  offset: string;
  key?: string;
  error: Error;
  retryCount: number;
  payload?: unknown;
  rawPayload?: string;
  originalEventId?: string;
  originalValue?: string;
  originalEnvelope?: KafkaEnvelope<unknown>;
}

export function isNonRetryableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as {
    isOperational?: boolean;
    statusCode?: number;
    name?: string;
    code?: string;
  };

  // Operational 4xx HTTP/domain errors
  if (anyErr.isOperational && typeof anyErr.statusCode === 'number' && anyErr.statusCode < 500) {
    return true;
  }

  // Schema validation failures
  if (anyErr.name === 'ZodError' || anyErr.name === 'ValidationError') {
    return true;
  }

  // Non-retryable payment errors
  if (anyErr.name === 'NonRetryablePaymentError') {
    return true;
  }

  return false;
}

export function createResilientConsumerRunner(
  config: ResilientConsumerConfig,
  handler: (envelope: KafkaEnvelope<unknown>, rawParsed: Record<string, unknown>) => Promise<void>
) {
  let dlqProducer: Producer | null = null;
  let dlqProducerConnected = false;

  const getDlqProducer = async (): Promise<Producer> => {
    if (!dlqProducer) {
      dlqProducer = createDurableProducer(config.kafka);
    }
    if (!dlqProducerConnected) {
      await dlqProducer.connect();
      dlqProducerConnected = true;
    }
    return dlqProducer;
  };

  const routeToDlq = async (params: RouteToDlqParams) => {
    const producer = await getDlqProducer();
    const deadLetterId = crypto.randomUUID();
    const targetTopic =
      params.targetTopic ||
      (config.dlqTopicResolver
        ? config.dlqTopicResolver(params.originalTopic)
        : `${params.originalTopic}.DLQ`);

    const dlqEnvelope: DeadLetterEnvelope<unknown> = {
      id: deadLetterId,
      originalEventId: params.originalEventId,
      originalTopic: params.originalTopic,
      originalPartition: params.partition,
      originalOffset: params.offset,
      originalKey: params.key,
      consumerGroup: config.consumerGroup,
      serviceName: config.serviceName,
      failedAt: new Date().toISOString(),
      retryCount: params.retryCount,
      error: {
        name: params.error.name || 'Error',
        message: params.error.message || String(params.error),
        stack: params.error.stack,
        isOperational: (params.error as { isOperational?: boolean })?.isOperational,
        statusCode: (params.error as { statusCode?: number })?.statusCode,
      },
      payload: params.payload ?? null,
      rawPayload: params.rawPayload,
      originalValue: params.originalValue,
      originalEnvelope: params.originalEnvelope,
    };

    try {
      await producer.send({
        acks: -1,
        topic: targetTopic,
        messages: [
          {
            key: params.key || deadLetterId,
            value: JSON.stringify(dlqEnvelope),
            headers: {
              'x-original-topic': params.originalTopic,
              'x-original-partition': String(params.partition),
              'x-original-offset': params.offset,
              'x-consumer-group': config.consumerGroup,
              'x-dead-letter-id': deadLetterId,
            },
          },
        ],
      });

      logger.error(`[DLQ_DIVERTED] Poison pill / exhausted event diverted to ${targetTopic}`, {
        deadLetterId,
        originalTopic: params.originalTopic,
        offset: params.offset,
        consumerGroup: config.consumerGroup,
        error: params.error.message,
      });
    } catch (publishErr) {
      logger.error(`[DLQ_FATAL] Failed to publish message to DLQ topic ${targetTopic}:`, publishErr);
      throw publishErr;
    }
  };

  const commitProcessedOffset = async (
    topic: string,
    partition: number,
    offset: string
  ): Promise<void> => {
    if (typeof config.consumer.commitOffsets === 'function') {
      const nextOffset = (BigInt(offset) + 1n).toString();
      await config.consumer.commitOffsets([{ topic, partition, offset: nextOffset }]);
    }
  };

  return async ({ topic, partition, message }: EachMessagePayload): Promise<void> => {
    if (!message.value) return;

    const offset = message.offset;
    const key = message.key ? message.key.toString() : undefined;
    const rawString = message.value.toString();

    // 1. Safe JSON Deserialization Guard (Poison Pill Protection)
    let rawParsed: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawString);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid Kafka event: message root must be an object');
      }
      rawParsed = parsed as Record<string, unknown>;
    } catch (parseErr) {
      await routeToDlq({
        originalTopic: topic,
        partition,
        offset,
        key,
        error: parseErr instanceof Error ? parseErr : new Error(String(parseErr)),
        retryCount: 0,
        rawPayload: rawString,
        payload: null,
        originalValue: rawString,
      });
      await commitProcessedOffset(topic, partition, offset);
      return;
    }
    let envelope: KafkaEnvelope<unknown>;
    if (rawParsed.payload !== undefined) {
      const parsedEnvelope = KafkaEnvelopeSchema.safeParse(rawParsed);
      if (!parsedEnvelope.success) {
        await routeToDlq({
          originalTopic: topic,
          partition,
          offset,
          key,
          error: new Error(`Invalid Kafka envelope: ${parsedEnvelope.error.message}`),
          retryCount: 0,
          rawPayload: rawString,
          payload: rawParsed,
          originalValue: rawString,
        });
        await commitProcessedOffset(topic, partition, offset);
        return;
      }
      envelope = parsedEnvelope.data as KafkaEnvelope<unknown>;
    } else {
      envelope = {
        id: String(rawParsed.id || key || crypto.randomUUID()),
        version: Number(rawParsed.version || 1),
        eventType: String(rawParsed.eventType || 'UNKNOWN'),
        producer: String(rawParsed.producer || 'unknown'),
        timestamp: String(rawParsed.timestamp || new Date().toISOString()),
        partitionKey: String(rawParsed.partitionKey || key || ''),
        aggregateType: String(rawParsed.aggregateType || ''),
        aggregateId: String(rawParsed.aggregateId || ''),
        aggregateSequence: Number(rawParsed.aggregateSequence || 1),
        payload: rawParsed as unknown,
      };
    }

    // 2. Retry Loop with Exponential Backoff + Jitter
    let attempt = 0;
    const maxRetries = config.maxRetries ?? 3;
    const initialBackoff = config.initialBackoffMs ?? 500;
    const multiplier = config.backoffMultiplier ?? 2;
    const maxBackoff = config.maxBackoffMs ?? 5000;

    while (attempt <= maxRetries) {
      try {
        await handler(envelope, rawParsed);
        await commitProcessedOffset(topic, partition, offset);
        return;
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        const nonRetryable = isNonRetryableError(err);

        if (nonRetryable || attempt >= maxRetries) {
          // Terminal failure: Divert to DLQ and commit offset
          await routeToDlq({
            originalTopic: topic,
            partition,
            offset,
            key,
            error,
            retryCount: attempt,
            payload: envelope.payload,
            originalEventId: envelope.id,
            originalValue: rawString,
            originalEnvelope: envelope,
          });
          await commitProcessedOffset(topic, partition, offset);
          return;
        }

        attempt++;
        const jitter = Math.random() * 200;
        const backoff = Math.min(
          initialBackoff * Math.pow(multiplier, attempt - 1) + jitter,
          maxBackoff
        );
        logger.warn(
          `Transient consumer error on ${topic} [attempt ${attempt}/${maxRetries}]. Backing off ${Math.round(backoff)}ms: ${error.message}`
        );
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  };
}
