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
  maxRetries: number;
  initialBackoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
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
  if (!err || typeof err !== 'object') {
    return false;
  }

  const error = err as {
    isOperational?: boolean;
    statusCode?: number;
    name?: string;
  };

  if (
    error.isOperational &&
    typeof error.statusCode === 'number' &&
    error.statusCode < 500
  ) {
    return true;
  }

  return ['ZodError', 'ValidationError', 'NonRetryablePaymentError'].includes(
    error.name ?? ''
  );
}

export function createResilientConsumerRunner(
  config: ResilientConsumerConfig,
  handler: (envelope: KafkaEnvelope<unknown>, rawParsed: Record<string, unknown>) => Promise<void>
) {
  let dlqProducer: Producer | null = null;
  let dlqConnectPromise: Promise<Producer> | null = null;

  const getDlqProducer = (): Promise<Producer> => {
    if (!dlqConnectPromise) {
      dlqConnectPromise = (async () => {
        if (!dlqProducer) {
          dlqProducer = createDurableProducer(config.kafka);
        }
        await dlqProducer.connect();
        return dlqProducer;
      })().catch((err) => {
        dlqConnectPromise = null;
        throw err;
      });
    }
    return dlqConnectPromise;
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

  const commitOffset = async (topic: string, partition: number, offset: string) => {
    if (typeof config.consumer.commitOffsets === 'function') {
      await config.consumer.commitOffsets([{
        topic,
        partition,
        offset: (BigInt(offset) + 1n).toString(),
      }]);
    }
  };

  const deadLetterAndCommit = async (
    params: RouteToDlqParams
  ): Promise<void> => {
    await routeToDlq(params);
    await commitOffset(params.originalTopic, params.partition, params.offset);
  };

  const toFiniteNumber = (value: unknown, fallback: number): number => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

  const parseEnvelope = (
    raw: string,
    key: string | undefined
  ): { envelope: KafkaEnvelope<unknown>; parsed: Record<string, unknown> } => {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid Kafka event: message root must be an object');
    }

    const rawParsed = parsed as Record<string, unknown>;
    if ('payload' in rawParsed) {
      const result = KafkaEnvelopeSchema.safeParse(rawParsed);
      if (!result.success) {
        throw Object.assign(
          new Error(`Invalid Kafka envelope: ${result.error.message}`),
          { payload: rawParsed },
        );
      }
      return {
        envelope: result.data as KafkaEnvelope<unknown>,
        parsed: rawParsed,
      };
    }

    return {
      parsed: rawParsed,
      envelope: {
        id: String(rawParsed.id ?? key ?? crypto.randomUUID()),
        version: toFiniteNumber(rawParsed.version, 1),
        eventType: String(rawParsed.eventType ?? 'UNKNOWN'),
        producer: String(rawParsed.producer ?? 'unknown'),
        timestamp: String(rawParsed.timestamp ?? new Date().toISOString()),
        partitionKey: String(rawParsed.partitionKey ?? key ?? ''),
        aggregateType: String(rawParsed.aggregateType ?? ''),
        aggregateId: String(rawParsed.aggregateId ?? ''),
        aggregateSequence: toFiniteNumber(rawParsed.aggregateSequence, 1),
        payload: rawParsed,
      },
    };
  };

  const maxRetries = config.maxRetries;
  const initialBackoff = config.initialBackoffMs;
  const multiplier = config.backoffMultiplier;
  const maxBackoff = config.maxBackoffMs ?? 30_000;

  const sleepWithHeartbeat = async (
    milliseconds: number,
    heartbeat?: () => Promise<void>,
    intervalMs = 3_000,
  ): Promise<void> => {
    let remaining = milliseconds;
    while (remaining > 0) {
      const step = Math.min(remaining, intervalMs);
      await new Promise((resolve) => setTimeout(resolve, step));
      remaining -= step;
      if (heartbeat) {
        await heartbeat();
      }
    }
  };

  const eachMessageHandler = async ({
    topic,
    partition,
    message,
    heartbeat,
  }: EachMessagePayload): Promise<void> => {
    const offset = message.offset;
    if (!message.value) {
      await commitOffset(topic, partition, offset);
      return;
    }

    const key = message.key ? message.key.toString() : undefined;
    const rawPayload = message.value.toString();
    let envelope: KafkaEnvelope<unknown>;
    let rawParsed: Record<string, unknown>;

    try {
      ({ envelope, parsed: rawParsed } = parseEnvelope(rawPayload, key));
    } catch (parseError) {
      const error = parseError instanceof Error
        ? parseError
        : new Error(String(parseError));
      await deadLetterAndCommit({
        originalTopic: topic,
        partition,
        offset,
        key,
        error,
        retryCount: 0,
        rawPayload,
        payload: (error as Error & { payload?: unknown }).payload ?? null,
        originalValue: rawPayload,
      });
      return;
    }

    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        await handler(envelope, rawParsed);
        await commitOffset(topic, partition, offset);
        return;
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));

        if (isNonRetryableError(err) || attempt >= maxRetries) {
          await deadLetterAndCommit({
            originalTopic: topic,
            partition,
            offset,
            key,
            error,
            retryCount: attempt,
            payload: envelope.payload,
            originalEventId: envelope.id,
            originalValue: rawPayload,
            originalEnvelope: envelope,
          });
          return;
        }

        attempt++;
        const backoff = Math.min(
          initialBackoff * multiplier ** (attempt - 1) + Math.random() * 200,
          maxBackoff,
        );
        logger.warn(
          `Transient error on ${topic} (attempt ${attempt}/${maxRetries}). ` +
          `Retrying in ${Math.round(backoff)}ms: ${error.message}`,
        );
        await sleepWithHeartbeat(backoff, heartbeat);
      }
    }
  };

  return Object.assign(eachMessageHandler, {
    disconnectDlqProducer: async (): Promise<void> => {
      if (dlqProducer) {
        await dlqProducer.disconnect();
        dlqProducer = null;
        dlqConnectPromise = null;
      }
    },
  });
}
