import { createClient, RedisClientType } from 'redis';
import { createLogger } from '@urbanfleet/common';

const logger = createLogger('auth-redis');
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const isUpstash = redisUrl.includes('upstash.io') || redisUrl.startsWith('rediss://');

/**
 * Single Redis database connection with service-level 'auth:' namespace.
 * Resilient for Upstash Serverless TLS and long-lived connection stability.
 */
export const authRedisClient: RedisClientType = createClient({
  url: redisUrl,
  name: 'auth-service',
  socket: {
    connectTimeout: 10000,
    keepAlive: 15000,
    reconnectStrategy: (retries: number) => {
      if (retries > 50) {
        return new Error('[auth-redis] Max Redis reconnection attempts exceeded');
      }
      return Math.min(retries * 100, 3000);
    },
  },
  pingInterval: isUpstash ? 25000 : undefined,
});

authRedisClient.on('error', (err: unknown) => {
  logger.error('Auth Redis Client Error', { error: err instanceof Error ? err.message : String(err) });
});

authRedisClient.on('connect', () => {
  logger.info('Auth Redis Client connected successfully [prefix: auth:]');
});

authRedisClient.on('reconnecting', () => {
  logger.warn('Auth Redis Client reconnecting...');
});

export const authRedisKey = (key: string) => `auth:${key}`;

export async function initAuthRedis(): Promise<void> {
  if (!authRedisClient.isOpen) {
    try {
      await authRedisClient.connect();
      logger.info('Auth Redis connected successfully on startup.');
    } catch (err: unknown) {
      logger.error('Failed to establish initial Redis connection', { error: err instanceof Error ? err.message : String(err) });
    }
  }
}
