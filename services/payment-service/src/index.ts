import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { PrismaClient } from '@prisma/client';
import { createLogger, AppError } from '@urbanfleet/common';
import { PaymentRepository } from './repositories/payment.repository.js';
import { LedgerRepository } from './repositories/ledger.repository.js';
import { RefundRepository } from './repositories/refund.repository.js';
import { PayoutRepository } from './repositories/payout.repository.js';
import { LedgerService } from './services/ledger.service.js';
import { PayoutService } from './services/payout.service.js';
import { PaymentService } from './services/payment.service.js';
import { PaymentController } from './controllers/payment.controller.js';
import { createPaymentRouter } from './routes/payment.routes.js';
import { OutboxWorker } from './workers/outbox.worker.js';
import { initPaymentConsumer } from './consumers/payment.consumer.js';

const logger = createLogger('payment-service');
const prisma = new PrismaClient();
const app = express();

const port = process.env.PORT || 4005;

// Repositories & Services
const paymentRepo = new PaymentRepository(prisma);
const ledgerRepo = new LedgerRepository(prisma);
const refundRepo = new RefundRepository(prisma);
const payoutRepo = new PayoutRepository(prisma);

const ledgerService = new LedgerService(ledgerRepo);
const payoutService = new PayoutService(prisma, payoutRepo, ledgerService);
const paymentService = new PaymentService(prisma, paymentRepo, refundRepo, ledgerService);
const paymentController = new PaymentController(paymentService, payoutService);

// Start Outbox Worker & Consumer
const outboxWorker = new OutboxWorker(prisma);
outboxWorker.start().catch(err => logger.error('Outbox start error:', err));
initPaymentConsumer(prisma, paymentService).catch(err => logger.error('Consumer error:', err));

// Middlewares
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json());

// Routes
app.use('/api/payment', createPaymentRouter(paymentController));

// Health check
app.get('/health', (req, res) => res.status(200).json({ status: 'UP', service: 'payment-service' }));

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

app.listen(port, () => {
  logger.info(`Payment Service running internally on port ${port}`);
});
