import { createClient, RedisClientType } from 'redis';
import { createLogger } from '@urbanfleet/common';

const logger = createLogger('driver-redis');
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * Single Redis database connection with service-level 'driver:' namespace.
 */
export const driverRedisClient: RedisClientType = createClient({
  url: redisUrl,
  name: 'driver-service',
});

driverRedisClient.on('error', (err: unknown) => {
  logger.error('Driver Redis Client Error:', err);
});

driverRedisClient.on('connect', () => {
  logger.info('Driver Redis Client connected successfully [prefix: driver:]');
});

export const driverRedisKey = (key: string) => `driver:${key}`;
