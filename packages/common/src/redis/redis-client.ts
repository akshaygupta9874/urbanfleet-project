import { createClient, RedisClientType } from 'redis';
import { createLogger } from '../logger/logger.js';

const logger = createLogger('redis-helper');

export interface RedisConfig {
  url?: string;
  keyPrefix?: string;
}

export function createNamespacedRedisClient(config: RedisConfig = {}): RedisClientType {
  const url = config.url || process.env.REDIS_URL || 'redis://localhost:6379';
  
  const client: RedisClientType = createClient({
    url,
    name: config.keyPrefix || 'urbanfleet'
  });

  client.on('error', (err) => {
    logger.error(`Redis client error [${config.keyPrefix || 'default'}]:`, err);
  });

  client.on('connect', () => {
    logger.info(`Redis connected successfully [prefix: ${config.keyPrefix || 'none'}]`);
  });

  return client;
}
