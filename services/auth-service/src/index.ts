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
import { AdminController } from './controllers/admin.controller.js';
import { AdminService } from './services/admin.service.js';
import { initAuthRedis, authRedisClient } from './redis/client.js';
import { OutboxRepository } from './repositories/outbox.repository.js';
import { OutboxWorker } from './workers/outbox.worker.js';
import { prisma } from './db/client.js';

const logger = createLogger('auth-service');
const app = express();

const port = process.env.AUTH_PORT || process.env.PORT || 4001;

initAsymmetricKeys();
initAuthRedis().catch(err => logger.error('Redis init error:', err));
initAuthPublisher().catch(err => logger.error('Kafka init error:', err));

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(cookieParser());
app.use(express.json());

const userRepo = new UserRepository(prisma);
const sessionRepo = new SessionRepository(prisma);
const outboxRepo = new OutboxRepository(prisma);

const outboxWorker = new OutboxWorker(outboxRepo);
outboxWorker.start();

const authService = new AuthService(userRepo, sessionRepo, outboxRepo);
const userService = new UserService(userRepo, sessionRepo);
const adminService = new AdminService(userService, sessionRepo);

const authController = new AuthController(authService, userService);
const adminController = new AdminController(adminService);

const authRouter = createAuthRouter(authController);
const adminRouter = createAdminRouter(adminController);

app.use('/v1/auth', authRouter);
app.use('/v1/admin', adminRouter);
app.use('/v1/auth/admin', adminRouter);

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
