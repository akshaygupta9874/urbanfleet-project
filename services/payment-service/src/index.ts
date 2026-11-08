import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createLogger, configureBigIntSerialization } from '@urbanfleet/common';
import { prisma } from './db/client.js';
import { connectRedis, disconnectRedis, redisClient } from './redis/client.js';
import { paymentService } from './services/payment.service.js';
import { OutboxWorker } from './workers/outbox.worker.js';
import { initPaymentConsumer } from './consumers/payment.consumer.js';
import { startPaymentReconciliationJob } from './jobs/payment-reconciliation.job.js';
import paymentRouter from './routes/payment.routes.js';
import webhookRouter from './routes/webhook.routes.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';

const logger = createLogger('payment-service');
const app = express();
configureBigIntSerialization(app);

const port = process.env.PAYMENT_PORT || process.env.PORT || 4005;

// Initialize Infrastructure: Redis, Outbox Worker, Reconciliation Job & Kafka Consumer
connectRedis().catch(err => logger.error('Redis connection error on startup:', err));

const outboxWorker = new OutboxWorker(prisma);
outboxWorker.start().catch(err => logger.error('Outbox worker startup error:', err));

const stopReconciliation = startPaymentReconciliationJob();
initPaymentConsumer(prisma, paymentService).catch(err => logger.error('Payment consumer startup error:', err));

// Global Security & Request Logging Middlewares
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));

// Raw Webhook Endpoint (Must stay BEFORE express.json for cryptographic HMAC verification)
app.use('/v1/webhooks', webhookRouter);

app.use(express.json());

// Health Check with Active Dependency Validation (DB & Redis)
const healthHandler = async (_req: express.Request, res: express.Response) => {
  let dbStatus = 'DOWN';
  let redisStatus = 'DOWN';

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'UP';
  } catch {
    dbStatus = 'DOWN';
  }

  try {
    if (redisClient.isOpen) {
      await redisClient.ping();
      redisStatus = 'UP';
    }
  } catch {
    redisStatus = 'DOWN';
  }

  const isHealthy = dbStatus === 'UP' && redisStatus === 'UP';
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'UP' : 'DOWN',
    service: 'payment-service',
    dependencies: {
      database: dbStatus,
      redis: redisStatus,
    },
  });
};

app.get('/health', healthHandler);
app.get('/v1/payments/health', healthHandler);

// Canonical API Routes
app.use('/v1/payments', paymentRouter);

// 404 Route Handler & Centralized Global Error Handler
app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(port, () => {
  logger.info(`Payment Service running internally on port ${port}`);
});

// Graceful Shutdown Handling
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Shutting down Payment Service gracefully...`);
  server.close(async () => {
    try {
      if (typeof stopReconciliation === 'function') {
        stopReconciliation();
      }
      await outboxWorker.stop();
      await disconnectRedis();
      await prisma.$disconnect();
      logger.info('Payment Service shut down cleanly.');
      process.exit(0);
    } catch (err) {
      logger.error('Error during graceful shutdown:', err);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
