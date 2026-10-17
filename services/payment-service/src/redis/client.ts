import { createClient } from "redis";
import { createLogger } from "@urbanfleet/common";
const logger = createLogger("payment-redis");

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

export const redisClient = createClient({
  url: redisUrl,
  name: "payment-service",
});

redisClient.on("error", (err) => {
  logger.error("Redis Client Error", { error: err.message });
});

export const paymentRedisKey = (key: string) => `payment:${key}`;

export async function connectRedis(): Promise<void> {
  if (!redisClient.isOpen) {
    try {
      await redisClient.connect();
    } catch (e) {
      // non-fatal in mocked tests
    }
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient.isOpen) {
    try {
      await redisClient.disconnect();
    } catch (e) {
      // non-fatal
    }
  }
}
