import { describe, it, expect } from 'vitest';
import {
  KafkaEnvelopeSchema,
  EventTopics,
  RideCompletedPayloadSchema
} from '../src/index.js';
import crypto from 'crypto';

describe('Event Contracts & Zod Schema Validation', () => {
  it('should validate a complete KafkaEnvelope', () => {
    const envelope = {
      id: crypto.randomUUID(),
      version: 1,
      eventType: 'RIDE_COMPLETED',
      producer: 'ride-service',
      timestamp: new Date().toISOString(),
      partitionKey: crypto.randomUUID(),
      aggregateType: 'RIDE',
      aggregateId: crypto.randomUUID(),
      aggregateSequence: 3,
      payload: { test: true }
    };

    const parsed = KafkaEnvelopeSchema.parse(envelope);
    expect(parsed.version).toBe(1);
    expect(parsed.eventType).toBe('RIDE_COMPLETED');
  });

  it('should validate RideCompleted payload schema', () => {
    const payload = {
      rideId: crypto.randomUUID(),
      riderId: crypto.randomUUID(),
      driverId: crypto.randomUUID(),
      totalFarePaise: 15000,
      baseFarePaise: 5000,
      surgeMultiplier: 1.2,
      distanceKm: 5.5,
      durationMinutes: 15,
      completedAt: new Date().toISOString()
    };

    expect(() => RideCompletedPayloadSchema.parse(payload)).not.toThrow();
  });

  it('should define distinct topics including Dead Letter Queues', () => {
    expect(EventTopics.AUTH_EVENTS).toBe('urbanfleet.auth.events');
    expect(EventTopics.RIDE_EVENTS).toBe('urbanfleet.ride.events');
    expect(EventTopics.PAYMENT_EVENTS).toBe('urbanfleet.payment.events');
    expect(EventTopics.RIDE_DLQ).toBe('urbanfleet.ride.events.DLQ');
  });

  it('should validate UserRegistered payload with firstName and lastName', async () => {
    const { UserRegisteredPayloadSchema } = await import('../src/index.js');
    const valid = {
      userId: crypto.randomUUID(),
      email: 'user@urbanfleet.com',
      firstName: 'John',
      lastName: 'Doe',
      role: 'RIDER',
    };
    expect(() => UserRegisteredPayloadSchema.parse(valid)).not.toThrow();
  });
});
