import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import { createLogger, AppError } from '@urbanfleet/common';
import { prisma } from './db/client.js';
import { rideRedisClient } from './redis/client.js';
import { RideRepository } from './repositories/ride.repository.js';
import { RatingRepository } from './repositories/rating.repository.js';
import { OutboxRepository } from './repositories/outbox.repository.js';
import { FareService } from './services/fare.service.js';
import { OtpService } from './services/otp.service.js';
import { GeoService } from './services/geo.service.js';
import { DriverPresenceService } from './services/driver-presence.service.js';
import { DispatchService } from './services/dispatch.service.js';
import { RideService } from './services/ride.service.js';
import { RideController } from './controllers/ride.controller.js';
import { createRideRouter } from './routes/ride.routes.js';
import { OutboxWorker } from './workers/outbox.worker.js';
import { initRideWebSocketServer } from './websocket/ride-socket.server.js';

const logger = createLogger('ride-service');
const redis = rideRedisClient;
const app = express();
const server = http.createServer(app);

const port = process.env.PORT || 4004;

// Connect Redis & Outbox Worker
redis.connect().catch(err => logger.error('Redis connect error:', err));
const outboxWorker = new OutboxWorker(prisma);
outboxWorker.start().catch(err => logger.error('Outbox worker start error:', err));

// Middlewares
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json());

// Services
const rideRepo = new RideRepository(prisma);
const ratingRepo = new RatingRepository(prisma);
const outboxRepo = new OutboxRepository(prisma);
const fareService = new FareService();
const otpService = new OtpService();
const driverPresenceService = new DriverPresenceService(redis);
const geoService = new GeoService(redis, driverPresenceService);
const dispatchService = new DispatchService(geoService);
const rideService = new RideService(rideRepo, ratingRepo, outboxRepo, fareService, otpService);
const rideController = new RideController(rideService, fareService, dispatchService);

// Native WebSocket Server
initRideWebSocketServer(
  server,
  redis,
  geoService,
  undefined,
  driverPresenceService,
  rideService,
  dispatchService
);

// HTTP Routes
const rideRouter = createRideRouter(rideController);
app.use('/api/ride', rideRouter);
app.use('/api/rides', rideRouter);
app.use('/v1/ride', rideRouter);
app.use('/v1/rides', rideRouter);

// Health check with active dependency validation
app.get('/health', async (req, res) => {
  let dbStatus = 'DOWN';
  let redisStatus = 'DOWN';

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'UP';
  } catch (err) {
    dbStatus = 'DOWN';
  }

  try {
    if (redis.isOpen) {
      await redis.ping();
      redisStatus = 'UP';
    }
  } catch (err) {
    redisStatus = 'DOWN';
  }

  const isHealthy = dbStatus === 'UP' && redisStatus === 'UP';
  const statusCode = isHealthy ? 200 : 503;

  res.status(statusCode).json({
    status: isHealthy ? 'UP' : 'DEGRADED',
    service: 'ride-service',
    timestamp: new Date().toISOString(),
    dependencies: {
      database: dbStatus,
      redis: redisStatus,
      outbox: outboxWorker.isHealthy() ? 'UP' : 'DOWN'
    }
  });
});

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

server.listen(port, () => {
  logger.info(`Ride Service running internally on port ${port}`);
});

// Graceful shutdown handling
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Initiating graceful shutdown...`);
  await outboxWorker.stop();
  server.close(async () => {
    logger.info('HTTP & WebSocket servers closed.');
    try {
      if (redis.isOpen) await redis.quit();
      await prisma.$disconnect();
      logger.info('Database and Redis connections closed cleanly.');
    } catch (err) {
      logger.error('Error during shutdown cleanup:', err);
    }
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forcefully terminating process due to shutdown timeout.');
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
