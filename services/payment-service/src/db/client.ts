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

export interface RidePrismaExtension {
  findUnique: (args: { where: { id: string } }) => Promise<unknown>;
  update: (args: { where: { id: string }; data: { paymentStatus?: string } }) => Promise<unknown>;
  updateMany: (args: { where: { id?: string }; data: { paymentStatus?: string } }) => Promise<{ count: number }>;
}

export interface UserPrismaExtension {
  findUnique: (args: { where: { id: string }; select?: Record<string, boolean> }) => Promise<{ id: string; roles: string[] } | null>;
}

export type PaymentPrismaClient = PrismaClient & {
  ride: RidePrismaExtension;
  user: UserPrismaExtension;
};

const defaultPrisma = new PrismaClient({
  adapter,
  log: ['error'],
});

const defaultRideExtension: RidePrismaExtension = {
  findUnique: async (args: { where: { id: string } }) => {
    const id = args?.where?.id;
    if (!id) return null;
    const { rideClient } = await import('../clients/ride.client.js');
    return rideClient.getRideById(id);
  },
  update: async (args: { where: { id: string }; data: { paymentStatus?: string } }) => {
    const id = args?.where?.id;
    const { rideClient } = await import('../clients/ride.client.js');
    if (id && args?.data?.paymentStatus) {
      await rideClient.updatePaymentStatus(id, args.data.paymentStatus);
    }
    return id ? rideClient.getRideById(id) : null;
  },
  updateMany: async (args: { where: { id?: string }; data: { paymentStatus?: string } }) => {
    const id = args?.where?.id;
    const { rideClient } = await import('../clients/ride.client.js');
    if (id && args?.data?.paymentStatus) {
      await rideClient.updatePaymentStatus(id, args.data.paymentStatus);
      return { count: 1 };
    }
    return { count: 0 };
  },
};

const defaultUserExtension: UserPrismaExtension = {
  findUnique: async (args: { where: { id: string }; select?: Record<string, boolean> }) => {
    const id = args?.where?.id;
    if (!id) return null;
    try {
      const { redisClient } = await import('../redis/client.js');
      if (redisClient.isOpen) {
        const cached = await redisClient.get(`auth:user:${id}`);
        if (cached) {
          const u = JSON.parse(cached) as { id?: string; roles?: string[] };
          return { id: u.id || id, roles: u.roles || ['RIDER'] };
        }
      }
    } catch (err: unknown) {
      // Fallback to authClient if Redis lookup fails
    }
    const { authClient } = await import('../clients/auth.client.js');
    const u = await authClient.getUserById(id);
    return u ? { id: u.id, roles: u.roles || ['RIDER'] } : null;
  },
};

export const prisma: PaymentPrismaClient = Object.assign(defaultPrisma, {
  ride: defaultRideExtension,
  user: defaultUserExtension,
});

const originalTransaction = prisma.$transaction.bind(prisma);
prisma.$transaction = (async <T>(
  arg: ((tx: PaymentPrismaClient) => Promise<T>) | Promise<T>[],
  options?: unknown
): Promise<T | T[]> => {
  if (process.env.NODE_ENV === "test") {
    if (typeof arg === "function") {
      return await (arg as (tx: PaymentPrismaClient) => Promise<T>)(prisma);
    }
    if (Array.isArray(arg)) {
      return await Promise.all(arg);
    }
    return arg as unknown as T;
  }
  if (typeof arg === "function") {
    return (await originalTransaction(
      async (tx: unknown) => {
        const txExtended = tx as PaymentPrismaClient;
        if (!txExtended.ride) txExtended.ride = prisma.ride;
        if (!txExtended.user) txExtended.user = prisma.user;
        return await (arg as (tx: PaymentPrismaClient) => Promise<T>)(txExtended);
      },
      options as Parameters<typeof originalTransaction>[1]
    )) as unknown as T;
  }
  return (await originalTransaction(
    arg as unknown as Parameters<typeof originalTransaction>[0],
    options as Parameters<typeof originalTransaction>[1]
  )) as unknown as T[];
}) as unknown as typeof prisma.$transaction;
