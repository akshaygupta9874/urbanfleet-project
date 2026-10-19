import express from 'express';
import helmet from 'helmet';
import { createLogger } from '@urbanfleet/common';
import { NotificationRepository } from './repositories/notification.repository.js';
import { NotificationService } from './services/notification.service.js';
import { NotificationDispatcher } from './workers/notification.dispatcher.js';
import { initNotificationConsumer } from './consumers/notification.consumer.js';

const logger = createLogger('notification-service');
import { prisma } from './db/client.js';
const app = express();

const port = process.env.PORT || 4003;

app.use(helmet());
app.use(express.json());

import { createNotificationRouter } from './routes/notification.routes.js';

const notifRepo = new NotificationRepository(prisma);
const notifService = new NotificationService(notifRepo);

const dispatcher = new NotificationDispatcher(notifRepo);
dispatcher.start();

let notifConsumer: any = null;
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

  const isHealthy = dbStatus === 'UP';
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'UP' : 'DOWN',
    service: 'notification-service',
    dependencies: {
      database: dbStatus,
      dispatcher: dispatcher.isHealthy() ? 'UP' : 'DOWN',
      consumer: notifConsumer ? 'UP' : 'INITIALIZING'
    }
  });
};

app.get('/health', healthHandler);
app.get('/notifications/health', healthHandler);
app.get('/v1/notifications/health', healthHandler);
app.get('/api/notifications/health', healthHandler);

// Routes
const notifRouter = createNotificationRouter(notifRepo);
app.use('/notifications', notifRouter);
app.use('/api/notifications', notifRouter);
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
