import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/config.js';
import { createAdminRouter } from './routes/admin.routes.js';
import { adminRedisClient, connectAdminRedis } from './redis/client.js';

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: config.frontendUrl,
    credentials: true,
  })
);
app.use(express.json());

// Public health checks
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'UP', service: 'admin-service' });
});

app.get('/v1/admin/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'UP', service: 'admin-service' });
});

// Mounted Admin Operations Router
app.use('/v1/admin', createAdminRouter());

// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

// Central Error Handler
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[admin-service error]', error);
  res.status(500).json({
    success: false,
    message: 'Internal administrator service error',
  });
});

// Connect to Redis on startup
void connectAdminRedis();

const server = app.listen(config.port, () => {
  console.log(`[admin-service] Running on port ${config.port}`);
});

function gracefulShutdown(signal: string) {
  console.log(`[admin-service] Received ${signal}. Initiating graceful shutdown...`);
  server.close(async () => {
    try {
      if (adminRedisClient.isOpen) {
        await adminRedisClient.quit();
      }
    } catch {}
    console.log('[admin-service] HTTP server and Redis closed cleanly.');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('[admin-service] Forcefully terminating after timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
