import { Kafka, Consumer } from 'kafkajs';
import { PrismaClient } from '../db/client.js';
import { createLogger } from '@urbanfleet/common';
import { EventTopics, KafkaEnvelope, UserRegisteredPayload, PaymentCapturedPayload } from '@urbanfleet/contracts';
import { NotificationService } from '../services/notification.service.js';
import { authClient } from '../clients/auth.client.js';

const logger = createLogger('notification-event-consumer');
const consumerGroup = 'notification-service-group';

export async function initNotificationConsumer(
  prisma: PrismaClient,
  notifService: NotificationService
): Promise<Consumer | null> {
  const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
  const kafka = new Kafka({ clientId: 'notification-service', brokers });
  const consumer = kafka.consumer({ groupId: consumerGroup });

  try {
    await consumer.connect();
    await consumer.subscribe({ topic: EventTopics.AUTH_EVENTS, fromBeginning: false });
    await consumer.subscribe({ topic: EventTopics.PAYMENT_EVENTS, fromBeginning: false });

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

          if (envelope.eventType === 'USER_EMAIL_VERIFICATION_REQUESTED') {
            const payload = envelope.payload as { email: string; verifyToken: string; userId?: string };
            if (payload.email && payload.verifyToken) {
              await notifService.sendVerificationEmail(payload.email, payload.verifyToken);
              logger.info(`Staged email verification notification for ${payload.email}`);
            }
          } else if (envelope.eventType === 'USER_PASSWORD_RESET_REQUESTED') {
            const payload = envelope.payload as { email: string; resetToken: string; userId?: string };
            if (payload.email && payload.resetToken) {
              await prisma.notificationRecord.create({
                data: {
                  recipient: payload.email,
                  channel: 'EMAIL',
                  template: 'PASSWORD_RESET',
                  idempotencyKey: `reset_${payload.email}_${payload.resetToken}`,
                  payload: { token: payload.resetToken },
                  status: 'PENDING',
                },
              });
              logger.info(`Staged password reset email notification for ${payload.email}`);
            }
          } else if (envelope.eventType === 'USER_REGISTERED') {
            const payload = envelope.payload as UserRegisteredPayload & { verifyToken?: string };
            if (payload.verifyToken) {
              await notifService.sendVerificationEmail(payload.email, payload.verifyToken);
              logger.info(`Staged verification email for ${payload.email}`);
            } else {
              logger.info(`User registered event received for ${payload.email}; verification triggered via dedicated event.`);
            }
          } else if (envelope.eventType === 'PAYMENT_CAPTURED') {
            const payload = envelope.payload as PaymentCapturedPayload & { email?: string; riderEmail?: string };
            let recipientEmail = payload.email || payload.riderEmail || null;

            if (!recipientEmail && payload.riderId) {
              try {
                const user = await authClient.getUserById(payload.riderId);
                if (user?.email) recipientEmail = user.email;
              } catch (fetchErr) {
                logger.warn(`Could not query auth-service API for user ${payload.riderId}`);
              }
            }

            if (recipientEmail) {
              await notifService.sendRideReceipt(recipientEmail, payload);
              logger.info(`Staged ride receipt for payment ${payload.paymentId} to ${recipientEmail}`);
            } else {
              logger.warn(`Skipping ride receipt for payment ${payload.paymentId}: no recipient email resolvable for rider ${payload.riderId}`);
            }
          }
        });
      }
    });

    logger.info('Notification Kafka Consumer initialized.');
    return consumer;
  } catch (err) {
    logger.error('Failed to initialize Notification Consumer:', err);
    return null;
  }
}
