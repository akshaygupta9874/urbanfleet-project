// scripts/wait-for-dependencies.cjs
const { Client } = require('pg');
const { createClient } = require('redis');

const MAX_RETRIES = parseInt(process.env.WAIT_MAX_RETRIES || '30', 10);
const RETRY_DELAY_MS = parseInt(process.env.WAIT_RETRY_DELAY_MS || '1000', 10);

async function waitForDatabase(dbUrl, serviceName) {
  if (!dbUrl) return;
  console.log(`[Readiness] Checking database connection for ${serviceName}...`);
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const client = new Client({
      connectionString: dbUrl,
      connectionTimeoutMillis: 15000,
    });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      console.log(`[Readiness] Database connection verified for ${serviceName} (attempt ${attempt}).`);
      return;
    } catch (err) {
      try { await client.end(); } catch (_) {}
      if (attempt === MAX_RETRIES) {
        console.error(`[Readiness] Database connection FAILED for ${serviceName} after ${MAX_RETRIES} attempts: ${err.message}`);
        throw err;
      }
      console.log(`[Readiness] Database not ready yet (${err.message}). Retrying ${attempt}/${MAX_RETRIES}...`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}

async function waitForRedis(redisUrl, serviceName) {
  if (!redisUrl) return;
  console.log(`[Readiness] Checking Redis connection for ${serviceName}...`);
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const client = createClient({
      url: redisUrl,
      socket: { connectTimeout: 10000 },
    });
    try {
      await client.connect();
      const pong = await client.ping();
      await client.disconnect();
      if (pong === 'PONG') {
        console.log(`[Readiness] Redis connection verified for ${serviceName} (attempt ${attempt}).`);
        return;
      }
    } catch (err) {
      try { await client.disconnect(); } catch (_) {}
      if (attempt === MAX_RETRIES) {
        console.error(`[Readiness] Redis connection FAILED for ${serviceName} after ${MAX_RETRIES} attempts: ${err.message}`);
        throw err;
      }
      console.log(`[Readiness] Redis not ready yet (${err.message}). Retrying ${attempt}/${MAX_RETRIES}...`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}

async function main() {
  const serviceName = process.env.SERVICE_NAME || process.env.APP_NAME || 'service';
  const dbUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;

  try {
    await Promise.all([
      waitForDatabase(dbUrl, serviceName),
      waitForRedis(redisUrl, serviceName),
    ]);
    console.log(`[Readiness] All dependencies verified for ${serviceName}. Proceeding to startup.`);
    process.exit(0);
  } catch (err) {
    console.error(`[Readiness] Dependency readiness check failed:`, err.message);
    process.exit(1);
  }
}

main();
