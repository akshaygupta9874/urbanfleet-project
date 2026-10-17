import express, { NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { createLogger, AppError } from '@urbanfleet/common';
import { initAsymmetricKeys } from './crypto/keys.js';
import { initAuthPublisher } from './events/auth.publisher.js';
import { UserRepository } from './repositories/user.repository.js';
import { SessionRepository } from './repositories/session.repository.js';
import { AuditRepository } from './repositories/audit.repository.js';
import { AuthService } from './services/auth.service.js';
import { UserService } from './services/user.service.js';
import { TwoFactorService } from './services/two-factor.service.js';
import { AdminService } from './services/admin.service.js';
import { AuthController } from './controllers/auth.controller.js';
import { AdminController } from './controllers/admin.controller.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createAdminRouter } from './routes/admin.routes.js';

import { initAuthRedis } from './redis/client.js';
import { OutboxRepository } from './repositories/outbox.repository.js';
import { OutboxWorker } from './workers/outbox.worker.js';

const logger = createLogger('auth-service');
import { prisma } from './db/client.js';
const app = express();

const port = process.env.PORT || 4001;

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
const auditRepo = new AuditRepository(prisma);
const outboxRepo = new OutboxRepository(prisma);

const outboxWorker = new OutboxWorker(outboxRepo);
outboxWorker.start();

const authService = new AuthService(userRepo, sessionRepo, auditRepo, outboxRepo);
const userService = new UserService(userRepo);
const twoFactorService = new TwoFactorService(userRepo, auditRepo);
const adminService = new AdminService(userRepo);

const authController = new AuthController(authService, userService, twoFactorService);
const adminController = new AdminController(adminService);

// 4. Mounting Routes
app.use('/api/auth', createAuthRouter(authController));
app.use('/api/admin', createAdminRouter(adminController));

// Health check endpoint
app.get('/health', (req, res) => res.status(200).json({ status: 'UP', service: 'auth-service' }));

// 5. Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      code: err.code,
      message: err.message,
      errors: (err as any).errors
    });
  }
  logger.error('Unhandled internal error:', err);
  res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Internal server error' });
});

app.listen(port, () => {
  logger.info(`Auth Service running internally on port ${port}`);
});
