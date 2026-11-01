import { createClient, RedisClientType } from 'redis';
import { createLogger } from '@urbanfleet/common';

const logger = createLogger('notification-redis');
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const isUpstash = redisUrl.includes('upstash.io') || redisUrl.startsWith('rediss://');

/**
 * Single Redis database connection with service-level 'notification:' namespace.
 * Resilient for Upstash Serverless TLS and long-lived connection stability.
 */
export const notificationRedisClient: RedisClientType = createClient({
  url: redisUrl,
  name: 'notification-service',
  socket: {
    connectTimeout: 10000,
    keepAlive: 15000,
    reconnectStrategy: (retries: number) => {
      if (retries > 50) {
        return new Error('[notification-redis] Max Redis reconnection attempts exceeded');
      }
      return Math.min(retries * 100, 3000);
    },
  },
  pingInterval: isUpstash ? 25000 : undefined,
});

notificationRedisClient.on('error', (err: unknown) => {
  logger.error('Notification Redis Client Error', { error: err instanceof Error ? err.message : String(err) });
});

notificationRedisClient.on('connect', () => {
  logger.info('Notification Redis Client connected successfully [prefix: notification:]');
});

notificationRedisClient.on('reconnecting', () => {
  logger.warn('Notification Redis Client reconnecting...');
});

export const notificationRedisKey = (key: string) => `notification:${key}`;

export async function initNotificationRedis(): Promise<void> {
  if (!notificationRedisClient.isOpen) {
    try {
      await notificationRedisClient.connect();
      logger.info('Notification Redis connected successfully on startup.');
    } catch (err: unknown) {
      logger.error('Notification Redis connection failed on startup', { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

export async function disconnectNotificationRedis(): Promise<void> {
  if (notificationRedisClient.isOpen) {
    try {
      await notificationRedisClient.quit();
      logger.info('Notification Redis client disconnected cleanly.');
    } catch (err: unknown) {
      logger.warn('Error disconnecting Notification Redis', { error: err instanceof Error ? err.message : String(err) });
    }
  }
}
