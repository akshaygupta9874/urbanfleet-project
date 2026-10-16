import { z } from 'zod';

export interface KafkaEnvelope<T> {
  id: string;              // Unique event UUID
  version: number;         // Schema version (e.g. 1)
  eventType: string;       // E.g. 'RIDE_COMPLETED'
  producer: string;        // E.g. 'ride-service'
  timestamp: string;       // ISO 8601 string
  partitionKey: string;    // Aggregate root partition key (e.g. rideId)
  aggregateType: string;   // E.g. 'RIDE'
  aggregateId: string;     // E.g. ride UUID
  aggregateSequence: number; // Monotonic sequence for in-order verification
  payload: T;
}

export const KafkaEnvelopeSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  eventType: z.string().min(1),
  producer: z.string().min(1),
  timestamp: z.string().datetime(),
  partitionKey: z.string().min(1),
  aggregateType: z.string().min(1),
  aggregateId: z.string().min(1),
  aggregateSequence: z.number().int().positive(),
  payload: z.record(z.any())
});
