import { describe, it, expect, vi } from 'vitest';
import {
  createResilientConsumerRunner,
  isNonRetryableError,
  ResilientConsumerConfig,
} from '../src/kafka/resilient-consumer.js';

describe('Resilient Consumer & DLQ Pipeline', () => {
  describe('isNonRetryableError', () => {
    it('identifies operational 4xx errors as non-retryable', () => {
      const err = { isOperational: true, statusCode: 400, message: 'Invalid payload' };
      expect(isNonRetryableError(err)).toBe(true);
    });

    it('identifies operational 404 as non-retryable', () => {
      const err = { isOperational: true, statusCode: 404, message: 'Not found' };
      expect(isNonRetryableError(err)).toBe(true);
    });

    it('identifies operational 500 as retryable (transient)', () => {
      const err = { isOperational: true, statusCode: 500, message: 'Internal server error' };
      expect(isNonRetryableError(err)).toBe(false);
    });

    it('identifies ZodError as non-retryable', () => {
      const err = new Error('Validation failed');
      err.name = 'ZodError';
      expect(isNonRetryableError(err)).toBe(true);
    });

    it('identifies NonRetryablePaymentError as non-retryable', () => {
      const err = new Error('Terminal payment rejection');
      err.name = 'NonRetryablePaymentError';
      expect(isNonRetryableError(err)).toBe(true);
    });

    it('treats generic unexpected Error as retryable (transient)', () => {
      const err = new Error('Connection reset by peer');
      expect(isNonRetryableError(err)).toBe(false);
    });
  });

  describe('createResilientConsumerRunner', () => {
    const createMockKafka = () => {
      const sentMessages: Array<{ topic: string; messages: Array<{ key?: string; value: string; headers?: Record<string, string> }> }> = [];
      const mockProducer = {
        connect: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockImplementation((payload) => {
          sentMessages.push(payload);
          return Promise.resolve();
        }),
      };
      const mockKafka = {
        producer: vi.fn().mockReturnValue(mockProducer),
      };
      return { mockKafka, mockProducer, sentMessages };
    };

    it('processes valid message successfully without publishing to DLQ', async () => {
      const { mockKafka, sentMessages } = createMockKafka();
      const config: ResilientConsumerConfig = {
        kafka: mockKafka as any,
        consumer: {} as any,
        consumerGroup: 'test-group',
        serviceName: 'test-service',
      };

      const handler = vi.fn().mockResolvedValue(undefined);
      const runner = createResilientConsumerRunner(config, handler);

      const validPayload = {
        id: '11111111-1111-1111-1111-111111111111',
        version: 1,
        eventType: 'RIDE_COMPLETED',
        producer: 'ride-service',
        timestamp: '2026-01-01T00:00:00.000Z',
        partitionKey: 'ride-123',
        aggregateType: 'RIDE',
        aggregateId: 'ride-123',
        aggregateSequence: 1,
        payload: { rideId: 'ride-123' },
      };

      await runner({
        topic: 'urbanfleet.ride.events',
        partition: 0,
        message: {
          key: Buffer.from('ride-123'),
          value: Buffer.from(JSON.stringify(validPayload)),
          offset: '42',
          attributes: 0,
          timestamp: '123456789',
        },
        heartbeat: vi.fn(),
        pause: vi.fn(),
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(sentMessages.length).toBe(0);
    });

    it('diverts poison pill (malformed JSON) directly to DLQ without crashing', async () => {
      const { mockKafka, sentMessages } = createMockKafka();
      const config: ResilientConsumerConfig = {
        kafka: mockKafka as any,
        consumer: {} as any,
        consumerGroup: 'test-group',
        serviceName: 'test-service',
      };

      const handler = vi.fn();
      const runner = createResilientConsumerRunner(config, handler);

      // Broken JSON
      const brokenJson = '{ "id": "123", broken json ...';

      await runner({
        topic: 'urbanfleet.ride.events',
        partition: 1,
        message: {
          key: Buffer.from('key-1'),
          value: Buffer.from(brokenJson),
          offset: '101',
          attributes: 0,
          timestamp: '123456789',
        },
        heartbeat: vi.fn(),
        pause: vi.fn(),
      });

      expect(handler).not.toHaveBeenCalled();
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].topic).toBe('urbanfleet.ride.events.DLQ');

      const dlqEnvelope = JSON.parse(sentMessages[0].messages[0].value);
      expect(dlqEnvelope.originalTopic).toBe('urbanfleet.ride.events');
      expect(dlqEnvelope.originalOffset).toBe('101');
      expect(dlqEnvelope.rawPayload).toBe(brokenJson);
      expect(dlqEnvelope.error.name).toBe('SyntaxError');
      expect(dlqEnvelope.originalValue).toBe(brokenJson);
    });

    it('retries transient failures and succeeds on subsequent attempt', async () => {
      const { mockKafka, sentMessages } = createMockKafka();
      const config: ResilientConsumerConfig = {
        kafka: mockKafka as any,
        consumer: {} as any,
        consumerGroup: 'test-group',
        serviceName: 'test-service',
        maxRetries: 3,
        initialBackoffMs: 10, // Fast test backoff
      };

      let attempts = 0;
      const handler = vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Database connection dropped temporarily');
        }
        return Promise.resolve();
      });

      const runner = createResilientConsumerRunner(config, handler);

      await runner({
        topic: 'urbanfleet.payment.events',
        partition: 0,
        message: {
          key: Buffer.from('pay-1'),
          value: Buffer.from(JSON.stringify({
            id: '11111111-1111-1111-1111-111111111112',
            version: 1,
            eventType: 'PAYMENT_CAPTURED',
            producer: 'payment-service',
            timestamp: '2026-01-01T00:00:00.000Z',
            partitionKey: 'pay-1',
            aggregateType: 'PAYMENT',
            aggregateId: 'pay-1',
            aggregateSequence: 1,
            payload: {},
          })),
          offset: '50',
          attributes: 0,
          timestamp: '123456789',
        },
        heartbeat: vi.fn(),
        pause: vi.fn(),
      });

      expect(attempts).toBe(2);
      expect(handler).toHaveBeenCalledTimes(2);
      expect(sentMessages.length).toBe(0); // Succeeded before exhausting retries, no DLQ
    });

    it('exhausts retries on persistent 500 error and diverts to DLQ', async () => {
      const { mockKafka, sentMessages } = createMockKafka();
      const config: ResilientConsumerConfig = {
        kafka: mockKafka as any,
        consumer: {} as any,
        consumerGroup: 'test-group',
        serviceName: 'test-service',
        maxRetries: 2,
        initialBackoffMs: 10,
      };

      const handler = vi.fn().mockRejectedValue(new Error('Persistent Database Outage'));
      const runner = createResilientConsumerRunner(config, handler);

      await runner({
        topic: 'urbanfleet.auth.events',
        partition: 2,
        message: {
          key: Buffer.from('user-99'),
          value: Buffer.from(JSON.stringify({
            id: '11111111-1111-1111-1111-111111111113',
            version: 1,
            eventType: 'USER_REGISTERED',
            producer: 'auth-service',
            timestamp: '2026-01-01T00:00:00.000Z',
            partitionKey: 'u-99',
            aggregateType: 'USER',
            aggregateId: 'u-99',
            aggregateSequence: 1,
            payload: { userId: 'u-99' },
          })),
          offset: '205',
          attributes: 0,
          timestamp: '123456789',
        },
        heartbeat: vi.fn(),
        pause: vi.fn(),
      });

      // 1 initial + 2 retries = 3 attempts total
      expect(handler).toHaveBeenCalledTimes(3);
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].topic).toBe('urbanfleet.auth.events.DLQ');

      const dlqEnvelope = JSON.parse(sentMessages[0].messages[0].value);
      expect(dlqEnvelope.originalEventId).toBe('11111111-1111-1111-1111-111111111113');
      expect(JSON.parse(dlqEnvelope.originalValue).eventType).toBe('USER_REGISTERED');
      expect(dlqEnvelope.originalEnvelope.aggregateId).toBe('u-99');
      expect(dlqEnvelope.error.message).toBe('Persistent Database Outage');
      expect(dlqEnvelope.retryCount).toBe(2);
    });

    it('dead-letters a JSON object with an invalid Kafka envelope', async () => {
      const { mockKafka, sentMessages } = createMockKafka();
      const runner = createResilientConsumerRunner(
        {
          kafka: mockKafka as any,
          consumer: {} as any,
          consumerGroup: 'test-group',
          serviceName: 'test-service',
        },
        vi.fn()
      );

      const invalidEnvelope = JSON.stringify({ id: 'not-a-uuid', payload: {} });
      await runner({
        topic: 'urbanfleet.ride.events',
        partition: 0,
        message: {
          key: Buffer.from('ride-1'),
          value: Buffer.from(invalidEnvelope),
          offset: '12',
          attributes: 0,
          timestamp: '123456789',
        },
        heartbeat: vi.fn(),
        pause: vi.fn(),
      });

      expect(sentMessages).toHaveLength(1);
      const dlqEnvelope = JSON.parse(sentMessages[0].messages[0].value);
      expect(dlqEnvelope.originalValue).toBe(invalidEnvelope);
      expect(dlqEnvelope.error.message).toContain('Invalid Kafka envelope');
    });

    it('immediately diverts non-retryable 4xx errors to DLQ without waiting for retries', async () => {
      const { mockKafka, sentMessages } = createMockKafka();
      const config: ResilientConsumerConfig = {
        kafka: mockKafka as any,
        consumer: {} as any,
        consumerGroup: 'test-group',
        serviceName: 'test-service',
        maxRetries: 5,
        initialBackoffMs: 1000,
      };

      const operationalError = Object.assign(new Error('Driver already registered with this license'), {
        isOperational: true,
        statusCode: 409,
      });

      const handler = vi.fn().mockRejectedValue(operationalError);
      const runner = createResilientConsumerRunner(config, handler);

      await runner({
        topic: 'urbanfleet.driver.events',
        partition: 0,
        message: {
          key: Buffer.from('drv-1'),
          value: Buffer.from(JSON.stringify({
            id: '11111111-1111-1111-1111-111111111114',
            version: 1,
            eventType: 'DRIVER_VERIFIED',
            producer: 'driver-service',
            timestamp: '2026-01-01T00:00:00.000Z',
            partitionKey: 'drv-1',
            aggregateType: 'DRIVER',
            aggregateId: 'drv-1',
            aggregateSequence: 1,
            payload: { license: 'XYZ' },
          })),
          offset: '88',
          attributes: 0,
          timestamp: '123456789',
        },
        heartbeat: vi.fn(),
        pause: vi.fn(),
      });

      // Must be called only once - no wasteful retries for 4xx operational error
      expect(handler).toHaveBeenCalledTimes(1);
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].topic).toBe('urbanfleet.driver.events.DLQ');

      const dlqEnvelope = JSON.parse(sentMessages[0].messages[0].value);
      expect(dlqEnvelope.error.isOperational).toBe(true);
      expect(dlqEnvelope.error.statusCode).toBe(409);
    });
  });
});
