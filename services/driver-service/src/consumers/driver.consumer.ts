import { Kafka, Consumer } from 'kafkajs';
import { PrismaClient } from '../db/client.js';
import { createLogger, createResilientConsumerRunner } from '@urbanfleet/common';
import { EventTopics, RideCompletedPayload, UserRegisteredPayload } from '@urbanfleet/contracts';

const logger = createLogger('driver-event-consumer');
const consumerGroup = 'driver-service-group';

export async function initDriverConsumer(prisma: PrismaClient): Promise<Consumer | null> {
  const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
  const kafka = new Kafka({ clientId: 'driver-service', brokers });
  const consumer = kafka.consumer({ groupId: consumerGroup });

  try {
    await consumer.connect();
    await consumer.subscribe({ topic: EventTopics.AUTH_EVENTS, fromBeginning: false });
    await consumer.subscribe({ topic: EventTopics.RIDE_EVENTS, fromBeginning: false });

    await consumer.run({
      eachMessage: createResilientConsumerRunner(
        {
          kafka,
          consumer,
          consumerGroup,
          serviceName: 'driver-service',
          dlqTopicResolver: (topic: string) => {
            if (topic === EventTopics.AUTH_EVENTS) return EventTopics.AUTH_DLQ;
            if (topic === EventTopics.RIDE_EVENTS) return EventTopics.RIDE_DLQ;
            return `${topic}.DLQ`;
          },
        },
        async (envelope) => {
          logger.info(`Received event ${envelope.eventType} in driver consumer`);

          // Atomic Idempotent Transaction
          await prisma.$transaction(async (tx) => {
            // 1. Check if already processed
            const existing = await tx.processedEvent.findUnique({
              where: {
                eventId_consumerGroup: {
                  eventId: envelope.id,
                  consumerGroup,
                },
              },
            });
            if (existing) {
              logger.info(`Duplicate event ${envelope.id} skipped.`);
              return;
            }

            // 2. Insert into processed_events table
            await tx.processedEvent.create({
              data: {
                eventId: envelope.id,
                consumerGroup,
              },
            });

            // 3. Handle Business Mutations
            if (envelope.eventType === 'USER_REGISTERED') {
              const payload = envelope.payload as UserRegisteredPayload;
              logger.info(
                `Acknowledged USER_REGISTERED event for user ${payload.userId}. Driver profile will only be created upon explicit driver registration.`
              );
            } else if (envelope.eventType === 'RIDE_COMPLETED') {
              const payload = envelope.payload as RideCompletedPayload;
              const profile = await tx.driverProfile.findFirst({
                where: {
                  id: payload.driverId,
                },
              });
              if (profile) {
                const driverEarningPaise = BigInt(payload.driverEarningPaise);

                await tx.driverProfile.update({
                  where: { id: profile.id },
                  data: {
                    totalTrips: { increment: 1 },
                    totalEarningsPaise: { increment: driverEarningPaise },
                  },
                });
                logger.info(
                  `Incremented trips and earnings for driver profile ${profile.id} by ${driverEarningPaise} paise`
                );
              } else {
                logger.warn(
                  `Could not find driver profile for driverId ${payload.driverId} on RIDE_COMPLETED event`
                );
              }
            }
          });
        }
      ),
    });

    logger.info('Driver Kafka Consumer successfully initialized with Resilient DLQ Runner.');
    return consumer;
  } catch (err) {
    logger.error('Failed to initialize Driver Kafka Consumer:', err);
    return null;
  }
}
