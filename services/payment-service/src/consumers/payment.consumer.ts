import { Kafka, Consumer } from 'kafkajs';
import { PrismaClient } from '../db/client.js';
import { createLogger } from '@urbanfleet/common';
import { EventTopics } from '@urbanfleet/contracts';
import { PaymentService } from '../services/payment.service.js';
import crypto from 'crypto';

const logger = createLogger('payment-event-consumer');
const consumerGroup = 'payment-service-group';

export interface PaymentOrderCreator {
  createOrder(input: {
    rideId: string;
    riderId: string;
    amountPaise: number;
    driverId?: string;
    fareBreakdown?: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<unknown>;
  issueRefund(paymentId: string, amountPaise: number, reason?: string): Promise<unknown>;
}

export async function initPaymentConsumer(
  prisma: PrismaClient,
  paymentService: PaymentService | PaymentOrderCreator
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

        let raw: Record<string, unknown>;
        try {
          raw = JSON.parse(message.value.toString()) as Record<string, unknown>;
        } catch (parseErr: unknown) {
          const parseErrorMessage = parseErr instanceof Error ? parseErr.message : String(parseErr);
          logger.warn('Failed to parse Kafka message JSON', { error: parseErrorMessage });
          return;
        }

        if (!raw || typeof raw !== 'object') return;

        const eventId = String(raw.id || (message.key ? message.key.toString() : '') || crypto.randomUUID());
        const eventType = raw.eventType as string | undefined;
        const payload = (typeof raw.payload === 'object' && raw.payload !== null ? raw.payload : raw) as Record<string, unknown>;

        await prisma.$transaction(async (tx) => {
          // Idempotency check
          const existing = await tx.processedEvent.findUnique({
            where: { eventId_consumerGroup: { eventId, consumerGroup } }
          });
          if (existing) return;

          await tx.processedEvent.create({
            data: { eventId, consumerGroup }
          });

          const creator: PaymentOrderCreator = paymentService;

          if (eventType === 'RIDE_ARRIVED_AT_DESTINATION') {
            const rideId = String(payload.rideId || '');
            let riderId = String(payload.riderId || '');
            let totalFarePaise = Number(payload.totalFarePaise || 0);
            let driverId = payload.driverId ? String(payload.driverId) : undefined;
            let fareBreakdown = (payload.fareBreakdown && typeof payload.fareBreakdown === 'object')
              ? (payload.fareBreakdown as Record<string, unknown>)
              : undefined;

            // If riderId or totalFarePaise or fareBreakdown missing, fetch authoritative details from rideClient
            if ((!riderId || !totalFarePaise || !fareBreakdown) && rideId) {
              try {
                const { rideClient } = await import('../clients/ride.client.js');
                const rideDetails = await rideClient.getRideById(rideId);
                if (rideDetails) {
                  riderId = riderId || String(rideDetails.riderId || '');
                  totalFarePaise = totalFarePaise || rideDetails.fare.breakdown.totalPaise;
                  driverId = driverId || rideDetails.driverId || undefined;
                  fareBreakdown = fareBreakdown || (rideDetails.fare.breakdown as unknown as Record<string, unknown>);
                }
              } catch (err: unknown) {
                const fetchErrMessage = err instanceof Error ? err.message : String(err);
                logger.warn(`Could not fetch ride details for ${rideId} in consumer: ${fetchErrMessage}`);
              }
            }

            await creator.createOrder({
              rideId,
              riderId,
              amountPaise: totalFarePaise,
              driverId,
              fareBreakdown,
              idempotencyKey: `ride-order-${rideId}`,
            });
            logger.info(`Initialized payment order for ride ${rideId} at arrival stage`);
          } else if (eventType === 'RIDE_COMPLETED') {
            const rideId = String(payload.rideId || '');
            let riderId = String(payload.riderId || '');
            let totalFarePaise = Number(payload.totalFarePaise || 0);
            let driverId = payload.driverId ? String(payload.driverId) : undefined;
            let fareBreakdown = (payload.fareBreakdown && typeof payload.fareBreakdown === 'object')
              ? (payload.fareBreakdown as Record<string, unknown>)
              : undefined;

            // Check if payment already exists for this ride
            const existingPayment = await tx.payment.findUnique({ where: { rideId } });
            if (existingPayment) {
              logger.info(`Ride ${rideId} completed; payment order ${existingPayment.id} already exists with status ${existingPayment.status}`);
            } else {
              // Resilient fallback: order wasn't created at arrival stage (e.g. driver completed directly)
              if ((!riderId || !totalFarePaise || !fareBreakdown) && rideId) {
                try {
                  const { rideClient } = await import('../clients/ride.client.js');
                  const rideDetails = await rideClient.getRideById(rideId);
                  if (rideDetails) {
                    riderId = riderId || String(rideDetails.riderId || '');
                    totalFarePaise = totalFarePaise || rideDetails.fare.breakdown.totalPaise;
                    driverId = driverId || rideDetails.driverId || undefined;
                    fareBreakdown = fareBreakdown || (rideDetails.fare.breakdown as unknown as Record<string, unknown>);
                  }
                } catch (err: unknown) {
                  const fetchErrMessage = err instanceof Error ? err.message : String(err);
                  logger.warn(`Could not fetch ride details for ${rideId} in consumer: ${fetchErrMessage}`);
                }
              }

              await creator.createOrder({
                rideId,
                riderId,
                amountPaise: totalFarePaise,
                driverId,
                fareBreakdown,
                idempotencyKey: `ride-order-${rideId}`,
              });
              logger.info(`Initialized fallback payment order for completed ride ${rideId}`);
            }
          } else if (eventType === 'RIDE_CANCELLED') {
            const rideId = String(payload.rideId || '');
            const riderId = String(payload.riderId || '');
            const cancellationFeePaise = Number(payload.cancellationFeePaise || 0);
            const existingPayment = await tx.payment.findUnique({ where: { rideId } });

            // Compensating Saga: If payment was captured, issue partial refund deducting cancellation fee
            if (existingPayment && existingPayment.status === 'CAPTURED') {
              const refundAmount = existingPayment.amountPaise - cancellationFeePaise;
              if (refundAmount > 0) {
                await creator.issueRefund(
                  existingPayment.id,
                  refundAmount,
                  `Compensating refund for cancelled ride (fee deducted: ${cancellationFeePaise}): ${String(payload.cancellationReason || 'Rider Cancelled')}`
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
              if (cancellationFeePaise > 0) {
                await creator.createOrder({
                  rideId,
                  riderId,
                  amountPaise: cancellationFeePaise,
                  driverId: payload.driverId ? String(payload.driverId) : undefined,
                  idempotencyKey: `cancellation-fee-${rideId}`,
                });
                logger.info(`Cancellation fee order created for ${cancellationFeePaise} paise on cancelled ride ${rideId}`);
              }
            } else if (!existingPayment && cancellationFeePaise > 0) {
              await creator.createOrder({
                rideId,
                riderId,
                amountPaise: cancellationFeePaise,
                driverId: payload.driverId ? String(payload.driverId) : undefined,
                idempotencyKey: `cancellation-fee-${rideId}`,
              });
              logger.info(`Cancellation fee order created for ${cancellationFeePaise} paise on unbilled cancelled ride ${rideId}`);
            }
          }
        });
      }
    });

    logger.info('Payment Kafka Consumer initialized.');
    return consumer;
  } catch (err: unknown) {
    logger.error('Failed to initialize Payment Consumer:', err);
    return null;
  }
}
