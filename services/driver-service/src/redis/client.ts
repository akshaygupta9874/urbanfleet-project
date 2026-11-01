import { createClient, RedisClientType } from 'redis';
import { createLogger } from '@urbanfleet/common';

const logger = createLogger('driver-redis');
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const isUpstash = redisUrl.includes('upstash.io') || redisUrl.startsWith('rediss://');

/**
 * Single Redis database connection with service-level 'driver:' namespace.
 * Resilient for Upstash Serverless TLS and long-lived connection stability.
 */
export const driverRedisClient: RedisClientType = createClient({
  url: redisUrl,
  name: 'driver-service',
  socket: {
    connectTimeout: 10000,
    keepAlive: 15000,
    reconnectStrategy: (retries: number) => {
      if (retries > 50) {
        return new Error('[driver-redis] Max Redis reconnection attempts exceeded');
      }
      return Math.min(retries * 100, 3000);
    },
  },
  pingInterval: isUpstash ? 25000 : undefined,
});

driverRedisClient.on('error', (err: unknown) => {
  logger.error('Driver Redis Client Error', { error: err instanceof Error ? err.message : String(err) });
});

driverRedisClient.on('connect', () => {
  logger.info('Driver Redis Client connected successfully [prefix: driver:]');
});

driverRedisClient.on('reconnecting', () => {
  logger.warn('Driver Redis Client reconnecting...');
});

export const driverRedisKey = (key: string) => `driver:${key}`;

export async function initDriverRedis(): Promise<void> {
  if (!driverRedisClient.isOpen) {
    try {
      await driverRedisClient.connect();
      logger.info('Driver Redis connected successfully on startup.');
    } catch (err: unknown) {
      logger.error('Driver Redis connection failed on startup', { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

export async function disconnectDriverRedis(): Promise<void> {
  if (driverRedisClient.isOpen) {
    try {
      await driverRedisClient.quit();
      logger.info('Driver Redis client disconnected cleanly.');
    } catch (err: unknown) {
      logger.warn('Error disconnecting Driver Redis', { error: err instanceof Error ? err.message : String(err) });
    }
  }
}
