import 'dotenv/config';
import express, { NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { createLogger, AppError } from '@urbanfleet/common';
import { initAsymmetricKeys } from './crypto/keys.js';
import { initAuthPublisher } from './events/auth.publisher.js';
import { UserRepository } from './repositories/user.repository.js';
import { SessionRepository } from './repositories/session.repository.js';
import { AuthService } from './services/auth.service.js';
import { UserService } from './services/user.service.js';
import { AuthController } from './controllers/auth.controller.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createAdminRouter } from './routes/admin.routes.js';

import { initAuthRedis, authRedisClient } from './redis/client.js';
import { OutboxRepository } from './repositories/outbox.repository.js';
import { OutboxWorker } from './workers/outbox.worker.js';

const logger = createLogger('auth-service');
import { prisma } from './db/client.js';
const app = express();

const port = process.env.AUTH_PORT || process.env.PORT || 4001;

// 1. Initialize RS256 Asymmetric Keys, Redis & Kafka Publisher
initAsymmetricKeys();
initAuthRedis().catch(err => logger.error('Redis init error:', err));
initAuthPublisher().catch(err => logger.error('Kafka init error:', err));

// 2. Middlewares
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(cookieParser());
app.use(express.json());

// 3. Dependency Injection
const userRepo = new UserRepository(prisma);
const sessionRepo = new SessionRepository(prisma);
const outboxRepo = new OutboxRepository(prisma);

const outboxWorker = new OutboxWorker(outboxRepo);
outboxWorker.start();

const authService = new AuthService(userRepo, sessionRepo, outboxRepo);
const userService = new UserService(userRepo, sessionRepo);

const authController = new AuthController(authService, userService);

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
    if (authRedisClient.isOpen) {
      await authRedisClient.ping();
      redisStatus = 'UP';
    } else {
      redisStatus = 'DOWN';
    }
  } catch {
    redisStatus = 'DOWN';
  }

  const isHealthy = dbStatus === 'UP' && redisStatus === 'UP';
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'UP' : 'DOWN',
    service: 'auth-service',
    dependencies: {
      database: dbStatus,
      redis: redisStatus,
      outbox: outboxWorker.isHealthy() ? 'UP' : 'DOWN'
    }
  });
};

app.get('/health', healthHandler);
app.get('/v1/auth/health', healthHandler);

// 4. Mounting Routes (Single Canonical Endpoint)
const authRouter = createAuthRouter(authController);

app.use('/v1/auth', authRouter);
app.use('/v1/auth/admin', createAdminRouter(userService, sessionRepo));

// 5. Global Error Handler
app.use((err: unknown, req: express.Request, res: express.Response, next: NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      code: err.code,
      message: err.message,
      errors: (err as { errors?: unknown }).errors
    });
  }
  logger.error('Unhandled internal error:', err);
  res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Internal server error' });
});

const server = app.listen(port, () => {
  logger.info(`Auth Service running internally on port ${port}`);
});

// Graceful shutdown handling
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Shutting down Auth Service gracefully...`);
  outboxWorker.stop();
  server.close(async () => {
    try {
      if (authRedisClient.isOpen) {
        await authRedisClient.disconnect();
      }
      await prisma.$disconnect();
      logger.info('Auth Service shut down cleanly.');
      process.exit(0);
    } catch (err) {
      logger.error('Error during graceful shutdown:', err);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
