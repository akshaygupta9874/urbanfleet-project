import { createClient, RedisClientType } from 'redis';
import { createLogger } from '@urbanfleet/common';

const logger = createLogger('notification-redis');
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * Single Redis database connection with service-level 'notification:' namespace.
 */
export const notificationRedisClient: RedisClientType = createClient({
  url: redisUrl,
  name: 'notification-service',
});

notificationRedisClient.on('error', (err: any) => {
  logger.error('Notification Redis Client Error:', err);
});

notificationRedisClient.on('connect', () => {
  logger.info('Notification Redis Client connected successfully [prefix: notification:]');
});

export const notificationRedisKey = (key: string) => `notification:${key}`;
