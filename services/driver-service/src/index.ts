import 'dotenv/config';
import dns from 'node:dns';
import express, { NextFunction } from 'express';
import multer from 'multer';
import cors from 'cors';
import helmet from 'helmet';
import { Consumer } from 'kafkajs';
import { createLogger, AppError, configureBigIntSerialization } from '@urbanfleet/common';
import { prisma } from './db/client.js';
import { driverRedisClient, initDriverRedis, disconnectDriverRedis } from './redis/client.js';
import { DriverRepository } from './repositories/driver.repository.js';
import { DocumentRepository } from './repositories/document.repository.js';
import { DriverService } from './services/driver.service.js';
import { DocumentService } from './services/document.service.js';
import { cloudinaryService } from './services/cloudinary.service.js';
import { DriverController } from './controllers/driver.controller.js';
import { createDriverRouter } from './routes/driver.routes.js';
import { initDriverConsumer } from './consumers/driver.consumer.js';

try {
  if (typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
  }
} catch {
  // Non-fatal if DNS resolution order cannot be configured
}

const logger = createLogger('driver-service');
const app = express();
configureBigIntSerialization(app);

const port = process.env.DRIVER_PORT || process.env.PORT || 4002;

// Initialize Infrastructure: Redis & Kafka Consumer
initDriverRedis().catch(err => logger.error('Driver Redis startup error:', err));

let driverConsumer: Consumer | null = null;
initDriverConsumer(prisma)
  .then(c => {
    driverConsumer = c;
  })
  .catch(err => logger.error('Driver consumer startup error:', err));

// Global Security & Parsing Middlewares
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json());

// Dependency Injection Wiring
const driverRepo = new DriverRepository(prisma);
const docRepo = new DocumentRepository(prisma);
const driverService = new DriverService(driverRepo);
const docService = new DocumentService(docRepo, driverRepo);
const driverController = new DriverController(driverService, docService, cloudinaryService);

// Health Check with Active Dependency Validation (DB, Redis & Consumer)
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
    if (driverRedisClient.isOpen) {
      await driverRedisClient.ping();
      redisStatus = 'UP';
    } else {
      await driverRedisClient.connect();
      redisStatus = driverRedisClient.isOpen ? 'UP' : 'DOWN';
    }
  } catch {
    redisStatus = 'DOWN';
  }

  const isHealthy = dbStatus === 'UP' && redisStatus === 'UP';
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'UP' : 'DOWN',
    service: 'driver-service',
    dependencies: {
      database: dbStatus,
      redis: redisStatus,
      consumer: driverConsumer ? 'UP' : 'INITIALIZING',
    },
  });
};

app.get('/health', healthHandler);
app.get('/v1/drivers/health', healthHandler);

// Canonical API Routes
const driverRouter = createDriverRouter(driverController);
app.use('/v1/drivers', driverRouter);

// Centralized Global Error Handler
app.use((err: unknown, req: express.Request, res: express.Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      code: err.code,
      message: `File upload error: ${err.message}`,
    });
  }
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
  logger.info(`Driver Service running internally on port ${port}`);
});

// Graceful Shutdown Handling
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Shutting down Driver Service gracefully...`);
  server.close(async () => {
    try {
      if (driverConsumer && typeof driverConsumer.disconnect === 'function') {
        await driverConsumer.disconnect();
      }
      await disconnectDriverRedis();
      await prisma.$disconnect();
      logger.info('Driver Service shut down cleanly.');
      process.exit(0);
    } catch (err) {
      logger.error('Error during graceful shutdown:', err);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
