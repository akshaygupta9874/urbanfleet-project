import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import { createLogger } from '@urbanfleet/common';
import { NotificationRepository } from './repositories/notification.repository.js';
import { NotificationService } from './services/notification.service.js';
import { NotificationDispatcher } from './workers/notification.dispatcher.js';
import { initNotificationConsumer } from './consumers/notification.consumer.js';
import { notificationRedisClient, initNotificationRedis, disconnectNotificationRedis } from './redis/client.js';

const logger = createLogger('notification-service');
import { prisma } from './db/client.js';
const app = express();

const port = process.env.NOTIFICATION_PORT || process.env.PORT || 4003;

// Initialize Redis & Kafka Consumer
initNotificationRedis().catch(err => logger.error('Notification Redis startup error:', err));

app.use(helmet());
app.use(express.json());

import { createNotificationRouter } from './routes/notification.routes.js';

import { Consumer } from 'kafkajs';

const notifRepo = new NotificationRepository(prisma);
const notifService = new NotificationService(notifRepo);

const dispatcher = new NotificationDispatcher(notifRepo);
dispatcher.start();

let notifConsumer: Consumer | null = null;
initNotificationConsumer(prisma, notifService).then(c => {
  notifConsumer = c;
}).catch(err => logger.error('Consumer error:', err));

// Health check endpoint (mounted before router)
const healthHandler = async (_req: express.Request, res: express.Response) => {
  let dbStatus = 'DOWN';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'UP';
  } catch {
    dbStatus = 'DOWN';
  }

  let redisStatus = 'DOWN';
  try {
    if (notificationRedisClient.isOpen) {
      await notificationRedisClient.ping();
      redisStatus = 'UP';
    } else {
      await notificationRedisClient.connect();
      redisStatus = notificationRedisClient.isOpen ? 'UP' : 'DOWN';
    }
  } catch {
    redisStatus = 'DOWN';
  }

  const isHealthy = dbStatus === 'UP' && redisStatus === 'UP';
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'UP' : 'DOWN',
    service: 'notification-service',
    dependencies: {
      database: dbStatus,
      redis: redisStatus,
      dispatcher: dispatcher.isHealthy() ? 'UP' : 'DOWN',
      consumer: notifConsumer ? 'UP' : 'INITIALIZING'
    }
  });
};

app.get('/health', healthHandler);
app.get('/v1/notifications/health', healthHandler);

// Routes (Single Canonical Endpoint)
const notifRouter = createNotificationRouter(notifRepo);
app.use('/v1/notifications', notifRouter);

const server = app.listen(port, () => {
  logger.info(`Notification Service running internally on port ${port}`);
});

// Graceful shutdown handling
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Shutting down Notification Service gracefully...`);
  dispatcher.stop();
  server.close(async () => {
    try {
      if (notifConsumer && typeof notifConsumer.disconnect === 'function') {
        await notifConsumer.disconnect();
      }
      await disconnectNotificationRedis();
      await prisma.$disconnect();
      logger.info('Notification Service shut down cleanly.');
      process.exit(0);
    } catch (err) {
      logger.error('Error during graceful shutdown:', err);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
