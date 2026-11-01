import { createClient } from 'redis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const isUpstash = redisUrl.includes('upstash.io') || redisUrl.startsWith('rediss://');

export const adminRedisClient = createClient({
  url: redisUrl,
  socket: {
    connectTimeout: 10000,
    keepAlive: 15000,
    reconnectStrategy: (retries: number) => {
      if (retries > 50) return new Error('[admin-redis] Redis max reconnection retries reached');
      return Math.min(retries * 100, 3000);
    },
  },
  pingInterval: isUpstash ? 25000 : undefined,
});

adminRedisClient.on('error', (err) => {
  console.warn('[admin-redis] Redis Client Error:', err instanceof Error ? err.message : String(err));
});

adminRedisClient.on('connect', () => {
  console.log('[admin-redis] Connected to Redis cluster successfully');
});

adminRedisClient.on('reconnecting', () => {
  console.warn('[admin-redis] Redis Client reconnecting...');
});

export async function connectAdminRedis(): Promise<void> {
  if (!adminRedisClient.isOpen) {
    try {
      await adminRedisClient.connect();
      console.log('[admin-redis] Connected to Redis cluster successfully');
    } catch (err: unknown) {
      console.warn('[admin-redis] Initial Redis connection failed; operating with fail-safe defaults:', err instanceof Error ? err.message : String(err));
    }
  }
}
