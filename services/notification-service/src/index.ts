import 'dotenv/config';
import express, { NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Consumer } from 'kafkajs';
import { createLogger, AppError } from '@urbanfleet/common';
import { prisma } from './db/client.js';
import { notificationRedisClient, initNotificationRedis, disconnectNotificationRedis } from './redis/client.js';
import { NotificationRepository } from './repositories/notification.repository.js';
import { NotificationService } from './services/notification.service.js';
import { NotificationDispatcher } from './workers/notification.dispatcher.js';
import { initNotificationConsumer } from './consumers/notification.consumer.js';
import { createNotificationRouter } from './routes/notification.routes.js';

const logger = createLogger('notification-service');
const app = express();

const port = process.env.NOTIFICATION_PORT || process.env.PORT || 4003;

// Initialize Infrastructure: Redis, Dispatcher & Kafka Consumer
initNotificationRedis().catch(err => logger.error('Notification Redis startup error:', err));

const notifRepo = new NotificationRepository(prisma);
const notifService = new NotificationService(notifRepo);

const dispatcher = new NotificationDispatcher(notifRepo);
dispatcher.start();

let notifConsumer: Consumer | null = null;
initNotificationConsumer(prisma, notifService)
  .then(c => {
    notifConsumer = c;
  })
  .catch(err => logger.error('Notification consumer startup error:', err));

// Global Security & Parsing Middlewares
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json());

// Health Check with Active Dependency Validation (DB, Redis, Dispatcher & Consumer)
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
      consumer: notifConsumer ? 'UP' : 'INITIALIZING',
    },
  });
};

app.get('/health', healthHandler);
app.get('/v1/notifications/health', healthHandler);

// Canonical API Routes
const notifRouter = createNotificationRouter(notifRepo);
app.use('/v1/notifications', notifRouter);

// Centralized Global Error Handler
app.use((err: unknown, req: express.Request, res: express.Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      code: err.code,
      message: err.message,
      errors: (err as { errors?: unknown }).errors,
    });
  }
  logger.error('Unhandled internal error:', err);
  res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Internal server error' });
});

const server = app.listen(port, () => {
  logger.info(`Notification Service running internally on port ${port}`);
});

// Graceful Shutdown Handling
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
