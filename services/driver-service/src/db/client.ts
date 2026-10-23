import 'dotenv/config';
import pg, { type PoolConfig } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/client/index.js';

export * from '../generated/client/index.js';

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://driver_user:driver_secure_pass@localhost:5432/urbanfleet_driver?schema=public';

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
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '15000', 10),
  keepAlive: true,
};

export const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('[driver-db] Unexpected error on idle PostgreSQL pool client:', err);
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({
  adapter,
  log: ['error'],
});
