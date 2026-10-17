import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { PrismaClient } from '@prisma/client';
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
const app = express();

const port = process.env.PORT || 4002;

// Initialize Consumer
initDriverConsumer(prisma).catch(err => logger.error('Consumer startup error:', err));

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

// Routes
app.use('/api/driver', createDriverRouter(driverController));
app.use('/api/drivers', createDriverRouter(driverController));

// Health check endpoint
app.get('/health', (req, res) => res.status(200).json({ status: 'UP', service: 'driver-service' }));

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
  logger.info(`Driver Service running internally on port ${port}`);
});
