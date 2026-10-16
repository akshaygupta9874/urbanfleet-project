import express from 'express';
import helmet from 'helmet';
import { PrismaClient } from '@prisma/client';
import { createLogger } from '@urbanfleet/common';
import { NotificationRepository } from './repositories/notification.repository.js';
import { NotificationService } from './services/notification.service.js';
import { NotificationDispatcher } from './workers/notification.dispatcher.js';
import { initNotificationConsumer } from './consumers/notification.consumer.js';

const logger = createLogger('notification-service');
const prisma = new PrismaClient();
const app = express();

const port = process.env.PORT || 4003;

app.use(helmet());
app.use(express.json());

const notifRepo = new NotificationRepository(prisma);
const notifService = new NotificationService(notifRepo);

const dispatcher = new NotificationDispatcher(notifRepo);
dispatcher.start();

initNotificationConsumer(prisma, notifService).catch(err => logger.error('Consumer error:', err));

app.get('/health', (req, res) => res.status(200).json({ status: 'UP', service: 'notification-service' }));

app.listen(port, () => {
  logger.info(`Notification Service running internally on port ${port}`);
});
