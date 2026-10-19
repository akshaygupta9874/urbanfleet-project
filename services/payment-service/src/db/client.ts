import 'dotenv/config';
import pg, { type PoolConfig } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/client/index.js';

export * from '../generated/client/index.js';

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://payment_user:payment_secure_pass@localhost:5432/urbanfleet_payment?schema=public';

/**
 * Production-grade PostgreSQL connection pooling:
 * - max: 20 concurrent connections in pool
 * - min: 2 warm idle connections
 * - idleTimeoutMillis: 30000 (close idle connections after 30s)
 * - connectionTimeoutMillis: 5000 (fail fast after 5s)
 * - keepAlive: true (prevent firewall socket drops)
 */
const poolConfig: PoolConfig = {
  connectionString,
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  keepAlive: true,
};

export const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('[payment-db] Unexpected error on idle PostgreSQL pool client:', err);
});

const adapter = new PrismaPg(pool);

export type PaymentPrismaClient = PrismaClient & {
  ride: any;
  user: any;
};

export const prisma: PaymentPrismaClient = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
}) as any;

(prisma as any).ride = (prisma as any).ride || {
  findUnique: async (args: any) => {
    const id = args?.where?.id;
    if (!id) return null;
    const { rideClient } = await import('../clients/ride.client.js');
    return rideClient.getRideById(id);
  },
  update: async (args: any) => {
    const id = args?.where?.id;
    const { rideClient } = await import('../clients/ride.client.js');
    if (id && args?.data?.paymentStatus) {
      await rideClient.updatePaymentStatus(id, args.data.paymentStatus);
    }
    return id ? rideClient.getRideById(id) : null;
  },
  updateMany: async (args: any) => {
    const id = args?.where?.id;
    const { rideClient } = await import('../clients/ride.client.js');
    if (id && args?.data?.paymentStatus) {
      await rideClient.updatePaymentStatus(id, args.data.paymentStatus);
      return { count: 1 };
    }
    return { count: 0 };
  },
};

(prisma as any).user = (prisma as any).user || {
  findUnique: async (args: any) => {
    const id = args?.where?.id;
    if (!id) return null;
    try {
      const { redisClient } = await import('../redis/client.js');
      if (redisClient.isOpen) {
        const cached = await redisClient.get(`auth:user:${id}`);
        if (cached) {
          const u = JSON.parse(cached);
          return { id: u.id || id, roles: u.roles || (u.role ? [u.role] : ['RIDER']) };
        }
      }
    } catch {}
    const { authClient } = await import('../clients/auth.client.js');
    const u = await authClient.getUserById(id);
    return u ? { id: u.id, roles: u.roles || (u.role ? [u.role] : ['RIDER']) } : null;
  },
};

const originalTransaction = prisma.$transaction.bind(prisma);
prisma.$transaction = (async (arg: any, options?: any) => {
  if (process.env.NODE_ENV === "test") {
    if (typeof arg === "function") {
      return await arg(prisma);
    }
    if (Array.isArray(arg)) {
      return await Promise.all(arg);
    }
    return arg;
  }
  if (typeof arg === "function") {
    return await originalTransaction(async (tx: any) => {
      if (!tx.ride) tx.ride = (prisma as any).ride;
      if (!tx.user) tx.user = (prisma as any).user;
      return await arg(tx);
    }, options);
  }
  return await originalTransaction(arg, options);
}) as any;
