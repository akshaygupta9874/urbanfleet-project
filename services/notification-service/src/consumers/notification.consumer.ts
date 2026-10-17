import { Kafka, Consumer } from 'kafkajs';
import { PrismaClient } from '@prisma/client';
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

          if (envelope.eventType === 'USER_REGISTERED') {
            const payload = envelope.payload as UserRegisteredPayload;
            await notifService.sendVerificationEmail(payload.email, 'sample-verification-token');
            logger.info(`Staged verification email for ${payload.email}`);
          } else if (envelope.eventType === 'PAYMENT_CAPTURED') {
            const payload = envelope.payload as PaymentCapturedPayload;
            let recipientEmail = 'rider@urbanfleet.com';
            try {
              const user = await authClient.getUserById(payload.riderId);
              if (user?.email) recipientEmail = user.email;
            } catch (fetchErr) {
              logger.warn(`Could not query auth-service API for user ${payload.riderId}, falling back to default.`);
            }
            await notifService.sendRideReceipt(recipientEmail, payload);
            logger.info(`Staged ride receipt for payment ${payload.paymentId} to ${recipientEmail}`);
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
