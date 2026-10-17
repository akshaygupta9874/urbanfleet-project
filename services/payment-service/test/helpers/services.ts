import { prisma } from "../../src/db/client.js";
import { redisClient } from "../../src/redis/client.js";

export async function assertPostgresReady(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

export async function assertRedisReady(): Promise<void> {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }

  await redisClient.ping();
}

export async function assertTestInfrastructureReady(): Promise<void> {
  await assertPostgresReady();
  await assertRedisReady();
}
