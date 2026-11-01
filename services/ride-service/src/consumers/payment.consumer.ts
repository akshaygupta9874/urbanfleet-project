import { Kafka, Consumer } from 'kafkajs';
import { PrismaClient } from '../db/client.js';
import { createKafkaClient, createKafkaConsumer, createLogger, createResilientConsumerRunner } from '@urbanfleet/common';
import { EventTopics } from '@urbanfleet/contracts';
import { emitPaymentCaptured as emitPaymentCapturedToDriver } from '../websocket/emitters/driver.emitter.js';
import { emitPaymentCaptured as emitPaymentCapturedToRider } from '../websocket/emitters/rider.emitter.js';
import { toRideDto } from '../utils/ride-dto.js';
import crypto from 'crypto';

const logger = createLogger('ride-payment-consumer');
const consumerGroup = 'ride-service-payment-group';

export async function initRidePaymentConsumer(prisma: PrismaClient): Promise<Consumer | null> {
  const kafka = createKafkaClient('ride-service-payment-consumer');
  const consumer = createKafkaConsumer(kafka, consumerGroup);

  try {
    await consumer.connect();
    await consumer.subscribe({ topic: EventTopics.PAYMENT_EVENTS, fromBeginning: false });

    await consumer.run({
      autoCommit: false,
      eachMessage: createResilientConsumerRunner(
        {
          kafka,
          consumer,
          consumerGroup,
          serviceName: 'ride-service',
          dlqTopicResolver: () => EventTopics.PAYMENT_DLQ,
        },
        async (envelope, raw) => {
          const eventId = String(envelope.id || raw.id || crypto.randomUUID());
          const eventType = envelope.eventType;
          const payload = (typeof envelope.payload === 'object' && envelope.payload !== null
            ? envelope.payload
            : raw) as Record<string, unknown>;

          if (eventType !== 'PAYMENT_CAPTURED') return;

          const rideId = String(payload.rideId || '');
          if (!rideId) return;

          const updatedRide = await prisma.$transaction(async (tx) => {
            // 1. Idempotency check
            const existing = await tx.processedEvent.findUnique({
              where: { eventId_consumerGroup: { eventId, consumerGroup } },
            });
            if (existing) return null;

            await tx.processedEvent.create({
              data: { eventId, consumerGroup },
            });

            // 2. Fetch ride
            const ride = await tx.ride.findUnique({ where: { id: rideId } });
            if (!ride) {
              logger.warn(`Ride ${rideId} not found in ride-payment consumer`);
              return null;
            }

            if (ride.paymentStatus === 'CAPTURED') {
              return ride;
            }

            const updated = await tx.ride.update({
              where: { id: rideId },
              data: { paymentStatus: 'CAPTURED' },
            });

            return updated;
          });

          if (updatedRide) {
            const formatted = toRideDto(updatedRide);
            const emitPayload = {
              ride: {
                id: formatted.id,
                paymentStatus: formatted.paymentStatus,
              },
            };

            emitPaymentCapturedToRider(updatedRide.riderId, emitPayload);
            if (updatedRide.driverId) {
              emitPaymentCapturedToDriver(updatedRide.driverId, emitPayload);
            }
            logger.info(`Synced paymentStatus CAPTURED and emitted to driver for ride ${rideId}`);
          }
        }
      ),
    });

    logger.info('Ride Payment Kafka Consumer initialized successfully with Resilient DLQ Runner.');
    return consumer;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn('Failed to initialize Ride Payment Kafka Consumer (running without consumer)', { error: errorMsg });
    return null;
  }
}
