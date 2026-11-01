import { z } from 'zod';
import type { KafkaEnvelope } from './kafka-envelope.js';

export interface DeadLetterEnvelope<T = unknown> {
  id: string;                      // Unique DLQ event UUID
  originalEventId?: string;        // ID from source KafkaEnvelope if present
  originalTopic: string;           // E.g. 'urbanfleet.ride.events'
  originalPartition: number;       // Partition index where message was received
  originalOffset: string;          // Consumer offset of the failed message
  originalKey?: string;            // Partition key (e.g. rideId, userId)
  consumerGroup: string;           // E.g. 'payment-service-group'
  serviceName: string;             // E.g. 'payment-service'
  failedAt: string;                // ISO 8601 timestamp of terminal failure
  retryCount: number;              // Total retry attempts made before dead-lettering
  error: {
    name: string;                  // E.g. 'ZodError', 'PrismaClientKnownRequestError'
    message: string;               // Clear error message
    stack?: string;                // Full stack trace for root cause debugging
    isOperational?: boolean;       // Operational error flag
    statusCode?: number;           // HTTP status code if applicable (e.g. 400, 422)
  };
  payload: T;                      // The original parsed payload
  rawPayload?: string;             // Raw buffer/string if JSON deserialization failed
  originalValue?: string;          // Exact original Kafka message value for safe redrive
  originalEnvelope?: KafkaEnvelope<unknown>;
}

export const DeadLetterEnvelopeSchema = z.object({
  id: z.string().uuid(),
  originalEventId: z.string().optional(),
  originalTopic: z.string().min(1),
  originalPartition: z.number().int().nonnegative(),
  originalOffset: z.string().min(1),
  originalKey: z.string().optional(),
  consumerGroup: z.string().min(1),
  serviceName: z.string().min(1),
  failedAt: z.string().datetime(),
  retryCount: z.number().int().nonnegative(),
  error: z.object({
    name: z.string().min(1),
    message: z.string(),
    stack: z.string().optional(),
    isOperational: z.boolean().optional(),
    statusCode: z.number().int().optional(),
  }),
  payload: z.any().optional(),
  rawPayload: z.string().optional(),
  originalValue: z.string().optional(),
  originalEnvelope: z.record(z.any()).optional(),
});
