import { createClient, RedisClientType } from 'redis';
import { createLogger } from '@urbanfleet/common';

const logger = createLogger('ride-redis');
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * Single Redis database connection with service-level 'ride:' namespace.
 */
export const rideRedisClient: RedisClientType = createClient({
  url: redisUrl,
  name: 'ride-service',
});

rideRedisClient.on('error', (err: unknown) => {
  logger.error('Ride Redis Client Error:', err);
});

rideRedisClient.on('connect', () => {
  logger.info('Ride Redis Client connected successfully [prefix: ride:]');
});

export const rideRedisKey = (key: string) => `ride:${key}`;
