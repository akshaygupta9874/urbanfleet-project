import { Kafka, Consumer } from 'kafkajs';
import { PrismaClient } from '../db/client.js';
import { createLogger } from '@urbanfleet/common';
import { EventTopics } from '@urbanfleet/contracts';
import { PaymentService } from '../services/payment.service.js';
import crypto from 'crypto';

const logger = createLogger('payment-event-consumer');
const consumerGroup = 'payment-service-group';

export async function initPaymentConsumer(
  prisma: PrismaClient,
  paymentService: PaymentService
): Promise<Consumer | null> {
  const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
  const kafka = new Kafka({ clientId: 'payment-service', brokers });
  const consumer = kafka.consumer({ groupId: consumerGroup });

  try {
    await consumer.connect();
    await consumer.subscribe({ topic: EventTopics.RIDE_EVENTS, fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) return;

        let raw: any;
        try {
          raw = JSON.parse(message.value.toString());
        } catch (parseErr: any) {
          logger.warn('Failed to parse Kafka message JSON', { error: String(parseErr?.message || parseErr) });
          return;
        }

        // Resilient envelope unwrapping: handles KafkaEnvelope<T>, eventId alias, or unwrapped payloads
        const eventId = String(raw.id || raw.eventId || (message.key ? message.key.toString() : '') || crypto.randomUUID());
        const eventType = raw.eventType || raw.event || raw.type || (raw.status === 'COMPLETED' ? 'RIDE_COMPLETED' : undefined);
        const payload = raw.payload || raw;

        await prisma.$transaction(async (tx) => {
          // Idempotency check
          const existing = await tx.processedEvent.findUnique({
            where: { eventId_consumerGroup: { eventId, consumerGroup } }
          });
          if (existing) return;

          await tx.processedEvent.create({
            data: { eventId, consumerGroup }
          });

          if (eventType === 'RIDE_COMPLETED') {
            const rideId = payload.rideId || payload.id;
            const riderId = payload.riderId || payload.rider;
            const totalFarePaise = payload.totalFarePaise || payload.amountPaise || payload.fare;
            const driverId = payload.driverId || payload.driver;

            if (typeof (paymentService as any).createOrder === 'function') {
              if (paymentService.createOrder.length <= 1) {
                // New payment engine: createOrder({ rideId, riderId, idempotencyKey })
                await (paymentService as any).createOrder({
                  rideId,
                  riderId,
                  idempotencyKey: `ride-completed-${rideId}`,
                });
              } else {
                // Legacy signature: createOrder(rideId, riderId, amountPaise, driverId)
                await (paymentService as any).createOrder(
                  rideId,
                  riderId,
                  totalFarePaise,
                  driverId
                );
              }
            }
            logger.info(`Initialized payment order for completed ride ${rideId}`);
          } else if (eventType === 'RIDE_CANCELLED') {
            const rideId = payload.rideId || payload.id;
            const existingPayment = await tx.payment.findUnique({ where: { rideId } });

            // Compensating Saga: If payment was captured, issue automatic refund!
            if (existingPayment && existingPayment.status === 'CAPTURED') {
              if (typeof (paymentService as any).issueRefund === 'function') {
                await (paymentService as any).issueRefund(
                  existingPayment.id,
                  existingPayment.amountPaise,
                  `Compensating refund for cancelled ride: ${payload.cancellationReason || 'Rider Cancelled'}`
                );
              }
              logger.info(`Compensating refund executed for cancelled ride ${rideId}`);
            } else if (existingPayment && (existingPayment.status === 'PENDING' || existingPayment.status === 'CREATED')) {
              await tx.payment.update({
                where: { id: existingPayment.id },
                data: { status: 'CANCELLED' }
              });
            }
          }
        });
      }
    });

    logger.info('Payment Kafka Consumer initialized.');
    return consumer;
  } catch (err) {
    logger.error('Failed to initialize Payment Consumer:', err);
    return null;
  }
}
