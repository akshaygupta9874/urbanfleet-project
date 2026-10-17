import { createClient, RedisClientType } from 'redis';
import { createLogger } from '@urbanfleet/common';

const logger = createLogger('auth-redis');
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * Single Redis database connection with service-level 'auth:' namespace.
 */
export const authRedisClient: RedisClientType = createClient({
  url: redisUrl,
  name: 'auth-service',
});

authRedisClient.on('error', (err) => {
  logger.error('Auth Redis Client Error:', err);
});

authRedisClient.on('connect', () => {
  logger.info('Auth Redis Client connected successfully [prefix: auth:]');
});

export const authRedisKey = (key: string) => `auth:${key}`;
