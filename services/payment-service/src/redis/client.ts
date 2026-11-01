import { createClient } from "redis";
import { createLogger } from "@urbanfleet/common";
const logger = createLogger("payment-redis");

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const isUpstash = redisUrl.includes("upstash.io") || redisUrl.startsWith("rediss://");

/**
 * Resilient Redis client for payment locks, idempotency & session validation.
 * Optimized for Upstash Serverless TLS and reconnect resilience.
 */
export const redisClient = createClient({
  url: redisUrl,
  name: "payment-service",
  socket: {
    connectTimeout: 10000,
    keepAlive: 15000,
    reconnectStrategy: (retries: number) => {
      if (retries > 50) {
        return new Error("[payment-redis] Max Redis reconnection attempts exceeded");
      }
      return Math.min(retries * 100, 3000);
    },
  },
  pingInterval: isUpstash ? 25000 : undefined,
});

redisClient.on("error", (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error("Redis Client Error", { error: message });
});

redisClient.on("connect", () => {
  logger.info("Connected to Redis for payment locks & caching.");
});

redisClient.on("reconnecting", () => {
  logger.warn("Payment Redis reconnecting...");
});

export const paymentRedisKey = (key: string) => `payment:${key}`;

export function isRedisConnected(): boolean {
  return redisClient.isOpen;
}

export async function connectRedis(): Promise<void> {
  if (!redisClient.isOpen) {
    try {
      await redisClient.connect();
      logger.info("Connected to Redis for payment locks & caching.");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error("Redis connection failed. Distributed locks require active Redis.", { error: message });
      throw e;
    }
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient.isOpen) {
    try {
      await redisClient.disconnect();
      logger.info("Redis connection disconnected.");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logger.warn("Error disconnecting Redis:", { error: message });
    }
  }
}
