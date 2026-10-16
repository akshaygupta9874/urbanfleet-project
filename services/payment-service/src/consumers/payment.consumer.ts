import { Kafka, Consumer } from 'kafkajs';
import { PrismaClient } from '@prisma/client';
import { createLogger } from '@urbanfleet/common';
import { EventTopics, KafkaEnvelope, RideCompletedPayload, RideCancelledPayload } from '@urbanfleet/contracts';
import { PaymentService } from '../services/payment.service.js';

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
        const envelope: KafkaEnvelope<any> = JSON.parse(message.value.toString());

        await prisma.$transaction(async (tx) => {
          // Idempotency check
          const existing = await tx.processedEvent.findUnique({
            where: { eventId_consumerGroup: { eventId: envelope.id, consumerGroup } }
          });
          if (existing) return;

          await tx.processedEvent.create({
            data: { eventId: envelope.id, consumerGroup }
          });

          if (envelope.eventType === 'RIDE_COMPLETED') {
            const payload = envelope.payload as RideCompletedPayload;
            await paymentService.createOrder(
              payload.rideId,
              payload.riderId,
              payload.totalFarePaise,
              payload.driverId
            );
            logger.info(`Initialized payment order for completed ride ${payload.rideId}`);
          } else if (envelope.eventType === 'RIDE_CANCELLED') {
            const payload = envelope.payload as RideCancelledPayload;
            const existingPayment = await tx.payment.findUnique({ where: { rideId: payload.rideId } });
            
            // Compensating Saga: If payment was captured, issue automatic refund!
            if (existingPayment && existingPayment.status === 'CAPTURED') {
              await paymentService.issueRefund(
                existingPayment.id,
                existingPayment.amountPaise,
                `Compensating refund for cancelled ride: ${payload.cancellationReason || 'Rider Cancelled'}`
              );
              logger.info(`Compensating refund executed for cancelled ride ${payload.rideId}`);
            } else if (existingPayment && existingPayment.status === 'PENDING') {
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
