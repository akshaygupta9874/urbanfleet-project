import { z } from 'zod';

export interface KafkaEnvelope<T> {
  id: string;              // Unique event UUID or ID
  version: number;         // Schema version (e.g. 1)
  eventType: string;       // E.g. 'RIDE_COMPLETED'
  producer?: string;       // E.g. 'ride-service'
  timestamp?: string;      // ISO 8601 string
  partitionKey?: string;   // Aggregate root partition key (e.g. rideId)
  aggregateType?: string;  // E.g. 'RIDE'
  aggregateId?: string;    // E.g. ride UUID
  aggregateSequence?: number; // Monotonic sequence for in-order verification
  payload: T;
}

export const KafkaEnvelopeSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive().default(1),
  eventType: z.string().min(1),
  producer: z.string().optional().default('unknown'),
  timestamp: z.string().optional(),
  partitionKey: z.string().optional(),
  aggregateType: z.string().optional(),
  aggregateId: z.string().optional(),
  aggregateSequence: z.number().int().optional(),
  payload: z.record(z.any()),
});
