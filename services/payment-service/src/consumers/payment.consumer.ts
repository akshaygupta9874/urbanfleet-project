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

          if (eventType === 'RIDE_ARRIVED_AT_DESTINATION') {
            const rideId = payload.rideId || payload.id;
            let riderId = payload.riderId || payload.rider;
            let totalFarePaise = payload.totalFarePaise || payload.amountPaise || payload.fare;
            let driverId = payload.driverId || payload.driver;

            // If riderId or totalFarePaise missing, fetch authoritative details from rideClient
            if ((!riderId || !totalFarePaise) && rideId) {
              try {
                const { rideClient } = await import('../clients/ride.client.js');
                const rideDetails = await rideClient.getRideById(rideId);
                if (rideDetails) {
                  riderId = riderId || rideDetails.riderId || rideDetails.rider;
                  totalFarePaise = totalFarePaise || rideDetails.totalFarePaise || rideDetails.estimatedFarePaise || rideDetails.fare?.breakdown?.totalPaise;
                  driverId = driverId || rideDetails.driverId || rideDetails.driver;
                }
              } catch (err: any) {
                logger.warn(`Could not fetch ride details for ${rideId} in consumer: ${err.message}`);
              }
            }

            if (typeof (paymentService as any).createOrder === 'function') {
              if (paymentService.createOrder.length <= 1) {
                // Pass both ride/rider and rideId/riderId for universal compatibility
                await (paymentService as any).createOrder({
                  ride: rideId,
                  rider: riderId,
                  rideId,
                  riderId,
                  idempotencyKey: `ride-order-${rideId}`,
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
            logger.info(`Initialized payment order for ride ${rideId} at arrival stage`);
          } else if (eventType === 'RIDE_COMPLETED') {
            const rideId = payload.rideId || payload.id;
            let riderId = payload.riderId || payload.rider;
            let totalFarePaise = payload.totalFarePaise || payload.amountPaise || payload.fare;
            let driverId = payload.driverId || payload.driver;

            // Check if payment already exists for this ride
            const existingPayment = await tx.payment.findUnique({ where: { rideId } });
            if (existingPayment) {
              logger.info(`Ride ${rideId} completed; payment order ${existingPayment.id} already exists with status ${existingPayment.status}`);
            } else {
              // Resilient fallback: order wasn't created at arrival stage (e.g. driver completed directly)
              if ((!riderId || !totalFarePaise) && rideId) {
                try {
                  const { rideClient } = await import('../clients/ride.client.js');
                  const rideDetails = await rideClient.getRideById(rideId);
                  if (rideDetails) {
                    riderId = riderId || rideDetails.riderId || rideDetails.rider;
                    totalFarePaise = totalFarePaise || rideDetails.totalFarePaise || rideDetails.estimatedFarePaise || rideDetails.fare?.breakdown?.totalPaise;
                    driverId = driverId || rideDetails.driverId || rideDetails.driver;
                  }
                } catch (err: any) {
                  logger.warn(`Could not fetch ride details for ${rideId} in consumer: ${err.message}`);
                }
              }

              if (typeof (paymentService as any).createOrder === 'function') {
                if (paymentService.createOrder.length <= 1) {
                  // Pass both ride/rider and rideId/riderId for universal compatibility
                  await (paymentService as any).createOrder({
                    ride: rideId,
                    rider: riderId,
                    rideId,
                    riderId,
                    idempotencyKey: `ride-order-${rideId}`,
                  });
                } else {
                  await (paymentService as any).createOrder(
                    rideId,
                    riderId,
                    totalFarePaise,
                    driverId
                  );
                }
              }
              logger.info(`Initialized fallback payment order for completed ride ${rideId}`);
            }
          } else if (eventType === 'RIDE_CANCELLED') {
            const rideId = payload.rideId || payload.id;
            const riderId = payload.riderId || payload.rider;
            const cancellationFeePaise = Number(payload.cancellationFeePaise || 0);
            const existingPayment = await tx.payment.findUnique({ where: { rideId } });

            // Compensating Saga: If payment was captured, issue partial refund deducting cancellation fee
            if (existingPayment && existingPayment.status === 'CAPTURED') {
              const refundAmount = existingPayment.amountPaise - cancellationFeePaise;
              if (refundAmount > 0 && typeof (paymentService as any).issueRefund === 'function') {
                await (paymentService as any).issueRefund(
                  existingPayment.id,
                  refundAmount,
                  `Compensating refund for cancelled ride (fee deducted: ${cancellationFeePaise}): ${payload.cancellationReason || 'Rider Cancelled'}`
                );
                logger.info(`Compensating partial refund of ${refundAmount} paise executed for cancelled ride ${rideId}`);
              } else {
                logger.info(`No refund issued for cancelled ride ${rideId}; fee (${cancellationFeePaise}) covers captured amount (${existingPayment.amountPaise})`);
              }
            } else if (existingPayment && (existingPayment.status === 'PENDING' || existingPayment.status === 'CREATED')) {
              await tx.payment.update({
                where: { id: existingPayment.id },
                data: { status: 'CANCELLED' }
              });
              if (cancellationFeePaise > 0 && typeof (paymentService as any).createOrder === 'function') {
                if (paymentService.createOrder.length <= 1) {
                  await (paymentService as any).createOrder({
                    ride: rideId,
                    rider: riderId,
                    rideId,
                    riderId,
                    amountPaise: cancellationFeePaise,
                    idempotencyKey: `cancellation-fee-${rideId}`,
                  });
                } else {
                  await (paymentService as any).createOrder(
                    rideId,
                    riderId,
                    cancellationFeePaise,
                    payload.driverId
                  );
                }
                logger.info(`Cancellation fee order created for ${cancellationFeePaise} paise on cancelled ride ${rideId}`);
              }
            } else if (!existingPayment && cancellationFeePaise > 0) {
              if (typeof (paymentService as any).createOrder === 'function') {
                if (paymentService.createOrder.length <= 1) {
                  await (paymentService as any).createOrder({
                    ride: rideId,
                    rider: riderId,
                    rideId,
                    riderId,
                    amountPaise: cancellationFeePaise,
                    idempotencyKey: `cancellation-fee-${rideId}`,
                  });
                } else {
                  await (paymentService as any).createOrder(
                    rideId,
                    riderId,
                    cancellationFeePaise,
                    payload.driverId
                  );
                }
                logger.info(`Cancellation fee order created for ${cancellationFeePaise} paise on unbilled cancelled ride ${rideId}`);
              }
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
