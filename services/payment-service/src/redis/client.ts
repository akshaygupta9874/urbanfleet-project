import { createClient } from "redis";
import { createLogger } from "@urbanfleet/common";
const logger = createLogger("payment-redis");

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

export const redisClient = createClient({
  url: redisUrl,
  name: "payment-service",
});

redisClient.on("error", (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error("Redis Client Error", { error: message });
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
      logger.warn("Redis connection failed. Distributed locks will fail open or retry.", { error: message });
      if (process.env.NODE_ENV === "production") {
        throw e;
      }
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
