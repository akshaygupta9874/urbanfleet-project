import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createLogger, AppError, configureBigIntSerialization } from '@urbanfleet/common';
import { paymentService } from './services/payment.service.js';
import { OutboxWorker } from './workers/outbox.worker.js';
import { initPaymentConsumer } from './consumers/payment.consumer.js';
import paymentRouter from './routes/payment.routes.js';
import webhookRouter from './routes/webhook.routes.js';
import { startPaymentReconciliationJob } from './jobs/payment-reconciliation.job.js';
import { connectRedis, disconnectRedis, redisClient } from './redis/client.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';

const logger = createLogger('payment-service');
import { prisma } from './db/client.js';

const app = express();
configureBigIntSerialization(app);

const port = process.env.PORT || 4005;

// Connect Redis & Initialize Outbox & Consumers
connectRedis().catch(err => logger.error('Redis connect error on startup:', err));

// paymentService is imported as singleton from ./services/payment.service.js

// Start Outbox Worker, Reconciliation Job & Consumer
const outboxWorker = new OutboxWorker(prisma);
outboxWorker.start().catch(err => logger.error('Outbox start error:', err));
const stopReconciliation = startPaymentReconciliationJob();
initPaymentConsumer(prisma, paymentService).catch(err => logger.error('Consumer error:', err));

// Middlewares
app.use((req, _res, next) => {
  logger.info(`[HTTP IN] ${req.method} ${req.originalUrl}`);
  next();
});
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));

// Raw Webhook Endpoints (BEFORE express.json for cryptographic HMAC verification)
app.use('/webhooks', webhookRouter);
app.use('/v1/webhooks', webhookRouter);
app.use('/api/webhooks', webhookRouter);

app.use(express.json());

// Health check with active dependency validation (mounted before routers)
const healthHandler = async (_req: express.Request, res: express.Response) => {
  let dbStatus = 'DOWN';
  let redisStatus = 'DOWN';

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'UP';
  } catch (err) {
    dbStatus = 'DOWN';
  }

  try {
    if (redisClient.isOpen) {
      await redisClient.ping();
      redisStatus = 'UP';
    }
  } catch (err) {
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
app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok', service: 'payment-service' }));
app.get('/payment/health', healthHandler);
app.get('/payments/health', healthHandler);
app.get('/v1/payment/health', healthHandler);
app.get('/v1/payments/health', healthHandler);
app.get('/api/payment/health', healthHandler);
app.get('/api/payments/health', healthHandler);

// Routes (Real Payment Subsystem & Legacy compatibility)
app.use('/payments', paymentRouter);
app.use('/payment', paymentRouter);
app.use('/v1/payments', paymentRouter);
app.use('/v1/payment', paymentRouter);
app.use('/api/payment', paymentRouter);
app.use('/api/payments', paymentRouter);

// 404 Route Handler & Centralized Global Error Handler
app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(port, () => {
  logger.info(`Payment Service running internally on port ${port}`);
});

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Shutting down payment-service gracefully...`);
  server.close(async () => {
    try {
      if (typeof stopReconciliation === 'function') {
        stopReconciliation();
      }
      await outboxWorker.stop();
      await disconnectRedis();
      await prisma.$disconnect();
      logger.info('Payment service shutdown complete.');
      process.exit(0);
    } catch (err) {
      logger.error('Error during payment service shutdown:', err);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled Promise Rejection in Payment Service:', {
    error: reason instanceof Error ? reason.stack || reason.message : String(reason),
  });
});

process.on('uncaughtException', (err: Error) => {
  logger.error('Uncaught Exception in Payment Service:', {
    error: err.stack || err.message,
  });
  void gracefulShutdown('uncaughtException');
});
