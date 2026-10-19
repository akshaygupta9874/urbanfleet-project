import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createLogger, AppError } from '@urbanfleet/common';
import { DriverRepository } from './repositories/driver.repository.js';
import { DocumentRepository } from './repositories/document.repository.js';
import { DriverService } from './services/driver.service.js';
import { DocumentService } from './services/document.service.js';
import { DriverController } from './controllers/driver.controller.js';
import { cloudinaryService } from './services/cloudinary.service.js';
import { createDriverRouter } from './routes/driver.routes.js';
import { initDriverConsumer } from './consumers/driver.consumer.js';

const logger = createLogger('driver-service');
import { prisma } from './db/client.js';

(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

const app = express();

const port = process.env.PORT || 4002;

// Initialize Consumer
let driverConsumer: any = null;
initDriverConsumer(prisma).then(c => {
  driverConsumer = c;
}).catch(err => logger.error('Consumer startup error:', err));

// Middlewares
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json());

// Repositories & Services
const driverRepo = new DriverRepository(prisma);
const docRepo = new DocumentRepository(prisma);
const driverService = new DriverService(driverRepo);
const docService = new DocumentService(docRepo, driverRepo);
const driverController = new DriverController(driverService, docService, cloudinaryService);

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
    service: 'driver-service',
    dependencies: {
      database: dbStatus,
      consumer: driverConsumer ? 'UP' : 'INITIALIZING'
    }
  });
};

app.get('/health', healthHandler);
app.get('/driver/health', healthHandler);
app.get('/drivers/health', healthHandler);
app.get('/v1/driver/health', healthHandler);
app.get('/v1/drivers/health', healthHandler);
app.get('/api/driver/health', healthHandler);
app.get('/api/drivers/health', healthHandler);

// Routes
const driverRouter = createDriverRouter(driverController);
app.use('/driver', driverRouter);
app.use('/drivers', driverRouter);
app.use('/api/driver', driverRouter);
app.use('/api/drivers', driverRouter);
app.use('/v1/driver', driverRouter);
app.use('/v1/drivers', driverRouter);

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      code: err.code,
      message: err.message
    });
  }
  logger.error('Unhandled internal error:', err);
  res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Internal server error' });
});

const server = app.listen(port, () => {
  logger.info(`Driver Service running internally on port ${port}`);
});

// Graceful shutdown handling
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Shutting down Driver Service gracefully...`);
  server.close(async () => {
    try {
      if (driverConsumer && typeof driverConsumer.disconnect === 'function') {
        await driverConsumer.disconnect();
      }
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
