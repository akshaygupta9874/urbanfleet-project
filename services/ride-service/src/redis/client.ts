import { createClient, RedisClientType } from 'redis';
import { createLogger } from '@urbanfleet/common';

const logger = createLogger('ride-redis');
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const isUpstash = redisUrl.includes('upstash.io') || redisUrl.startsWith('rediss://');

/**
 * Single Redis database connection with service-level 'ride:' namespace.
 * Resilient for Upstash Serverless TLS and long-lived connection stability.
 */
export const rideRedisClient: RedisClientType = createClient({
  url: redisUrl,
  name: 'ride-service',
  socket: {
    connectTimeout: 10000,
    keepAlive: 15000,
    reconnectStrategy: (retries: number) => {
      if (retries > 50) {
        return new Error('[ride-redis] Max Redis reconnection attempts exceeded');
      }
      return Math.min(retries * 100, 3000);
    },
  },
  pingInterval: isUpstash ? 25000 : undefined,
});

rideRedisClient.on('error', (err: unknown) => {
  logger.error('Ride Redis Client Error', { error: err instanceof Error ? err.message : String(err) });
});

rideRedisClient.on('connect', () => {
  logger.info('Ride Redis Client connected successfully [prefix: ride:]');
});

rideRedisClient.on('reconnecting', () => {
  logger.warn('Ride Redis Client reconnecting...');
});

export const rideRedisKey = (key: string) => `ride:${key}`;

export async function initRideRedis(): Promise<void> {
  if (!rideRedisClient.isOpen) {
    try {
      await rideRedisClient.connect();
      logger.info('Ride Redis connected successfully on startup.');
    } catch (err: unknown) {
      logger.error('Ride Redis connection failed on startup', { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

export async function disconnectRideRedis(): Promise<void> {
  if (rideRedisClient.isOpen) {
    try {
      await rideRedisClient.quit();
      logger.info('Ride Redis client disconnected cleanly.');
    } catch (err: unknown) {
      logger.warn('Error disconnecting Ride Redis', { error: err instanceof Error ? err.message : String(err) });
    }
  }
}
