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

export type ResilientConsumerRunner = ((
  payload: EachMessagePayload
) => Promise<void>) & {
  disconnectDlqProducer: () => Promise<void>;
};

/**
 * 4xx status codes that are transient and SHOULD be retried with backoff
 * (Request Timeout, Too Early, Too Many Requests / Rate Limited).
 */
const RETRYABLE_4XX_STATUS_CODES = new Set([408, 425, 429]);

/**
 * Application error codes that indicate temporary lock/concurrency contention
 * rather than a permanent validation failure.
 */
const RETRYABLE_ERROR_CODES = new Set([
  'PAYMENT_ORDER_CREATION_IN_PROGRESS',
  'LOCK_ACQUISITION_FAILED',
]);

/**
 * Generates a deterministic UUID v4-formatted string from topic:partition:offset
 * when a legacy message does not include an explicit id.
 */
function deterministicOffsetUuid(
  topic: string,
  partition: number,
  offset: string
): string {
  const hash = crypto
    .createHash('sha256')
    .update(`${topic}:${partition}:${offset}`)
    .digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function isNonRetryableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }

  const error = err as {
    isOperational?: boolean;
    statusCode?: number;
    code?: string;
    errorCode?: string;
    name?: string;
  };

  const domainCode = error.code ?? error.errorCode;
  if (domainCode && RETRYABLE_ERROR_CODES.has(domainCode)) {
    return false;
  }

  if (
    error.isOperational &&
    typeof error.statusCode === 'number' &&
    error.statusCode >= 400 &&
    error.statusCode < 500 &&
    !RETRYABLE_4XX_STATUS_CODES.has(error.statusCode)
  ) {
    return true;
  }

  return ['ZodError', 'ValidationError', 'NonRetryablePaymentError'].includes(
    error.name ?? ''
  );
}

export function createResilientConsumerRunner(
  config: ResilientConsumerConfig,
  handler: (
    envelope: KafkaEnvelope<unknown>,
    rawParsed: Record<string, unknown>
  ) => Promise<void>
): ResilientConsumerRunner {
  let dlqProducer: Producer | null = null;
  let dlqConnectPromise: Promise<Producer> | null = null;

  const getDlqProducer = (): Promise<Producer> => {
    if (!dlqConnectPromise) {
      dlqConnectPromise = (async () => {
        if (!dlqProducer) {
          dlqProducer = createDurableProducer(config.kafka);
          if (typeof dlqProducer.on === 'function' && dlqProducer.events?.DISCONNECT) {
            dlqProducer.on(dlqProducer.events.DISCONNECT, () => {
              dlqConnectPromise = null;
            });
          }
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

  const routeToDlq = async (params: RouteToDlqParams): Promise<void> => {
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
        isOperational: (params.error as { isOperational?: boolean })
          ?.isOperational,
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

      logger.error(
        `[DLQ_DIVERTED] Poison pill / exhausted event diverted to ${targetTopic}`,
        {
          deadLetterId,
          originalTopic: params.originalTopic,
          offset: params.offset,
          consumerGroup: config.consumerGroup,
          error: params.error.message,
        }
      );
    } catch (publishErr) {
      // Reset connection promise so next attempt reconnects if producer dropped
      dlqConnectPromise = null;
      logger.error(
        `[DLQ_FATAL] Failed to publish message to DLQ topic ${targetTopic}:`,
        publishErr
      );
      throw publishErr;
    }
  };

  const commitOffset = async (
    topic: string,
    partition: number,
    offset: string
  ): Promise<void> => {
    if (typeof config.consumer.commitOffsets === 'function') {
      await config.consumer.commitOffsets([
        {
          topic,
          partition,
          offset: (BigInt(offset) + 1n).toString(),
        },
      ]);
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
    key: string | undefined,
    topic: string,
    partition: number,
    offset: string
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
          { payload: rawParsed }
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
        // Never fall back to `key` (which is partitionKey/rideId and would collide across events)
        id: String(
          rawParsed.id ?? deterministicOffsetUuid(topic, partition, offset)
        ),
        version: toFiniteNumber(rawParsed.version, 1),
        eventType: String(rawParsed.eventType ?? 'UNKNOWN'),
        producer: String(rawParsed.producer ?? 'unknown'),
        timestamp: String(rawParsed.timestamp ?? new Date().toISOString()),
        partitionKey: String(rawParsed.partitionKey ?? key ?? ''),
        aggregateType: String(rawParsed.aggregateType ?? ''),
        aggregateId: String(rawParsed.aggregateId ?? key ?? ''),
        aggregateSequence: toFiniteNumber(rawParsed.aggregateSequence, 1),
        payload: rawParsed,
      },
    };
  };

  const maxRetries = Math.max(0, Math.floor(toFiniteNumber(config.maxRetries, 3)));
  const initialBackoff = Math.max(
    10,
    toFiniteNumber(config.initialBackoffMs, 500)
  );
  const multiplier = Math.max(1, toFiniteNumber(config.backoffMultiplier, 2));
  const maxBackoff = Math.max(
    initialBackoff,
    toFiniteNumber(config.maxBackoffMs, 30_000)
  );

  const sleepWithHeartbeat = async (
    milliseconds: number,
    heartbeat?: () => Promise<void>,
    intervalMs = 3_000
  ): Promise<void> => {
    let remaining = milliseconds;
    while (remaining > 0) {
      const step = Math.min(remaining, intervalMs);
      await new Promise((resolve) => setTimeout(resolve, step));
      remaining -= step;
      if (heartbeat) {
        try {
          await heartbeat();
        } catch (hbErr) {
          logger.error('Kafka heartbeat failed during retry backoff:', hbErr);
        }
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
      ({ envelope, parsed: rawParsed } = parseEnvelope(
        rawPayload,
        key,
        topic,
        partition,
        offset
      ));
    } catch (parseError) {
      const error =
        parseError instanceof Error
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
            rawPayload,
            originalEventId: envelope.id,
            originalValue: rawPayload,
            originalEnvelope: envelope,
          });
          return;
        }

        attempt++;
        const backoff = Math.min(
          initialBackoff * multiplier ** (attempt - 1) + Math.random() * 200,
          maxBackoff
        );
        logger.warn(
          `Transient error on ${topic} (attempt ${attempt}/${maxRetries}). ` +
            `Retrying in ${Math.round(backoff)}ms: ${error.message}`
        );
        await sleepWithHeartbeat(backoff, heartbeat);
      }
    }
  };

  return Object.assign(eachMessageHandler, {
    disconnectDlqProducer: async (): Promise<void> => {
      if (dlqConnectPromise) {
        await dlqConnectPromise.catch(() => null);
      }
      if (dlqProducer) {
        try {
          await dlqProducer.disconnect();
        } finally {
          dlqProducer = null;
          dlqConnectPromise = null;
        }
      }
    },
  });
}