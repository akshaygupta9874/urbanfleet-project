import { randomUUID } from 'crypto';
import { redisClient } from './client.js';
import { createLogger } from '@urbanfleet/common';
const logger = createLogger('redis-lock');

export type ReleaseLock = () => Promise<void>;

export interface AcquireLockOptions {
  /** Number of additional attempts if the lock is currently held (default: 0) */
  retryCount?: number;
  /** Delay in ms between retry attempts (default: 100ms) */
  retryDelayMs?: number;
}

const RELEASE_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  end
  return 0
`;

/**
 * Distributed lock: SET key token NX PX ttl.
 * Returns an idempotent, safe release function, or null when somebody else holds the lock.
 * Release is compare-and-delete (Lua) so an expired lock is never released
 * on behalf of the process that took it over.
 */
export async function acquireLock(
  key: string,
  ttlMs: number,
  options?: AcquireLockOptions
): Promise<ReleaseLock | null> {
  const token = randomUUID();
  const safeTtlMs = Math.max(1, Math.floor(Number(ttlMs) || 5_000));
  const maxAttempts = 1 + Math.max(0, Math.floor(options?.retryCount ?? 0));
  const retryDelayMs = Math.max(10, Math.floor(options?.retryDelayMs ?? 100));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await redisClient.set(key, token, {
      NX: true,
      PX: safeTtlMs,
    });

    if (result === 'OK') {
      let released = false;

      return async (): Promise<void> => {
        if (released) return;
        released = true;

        try {
          const deleted = await redisClient.eval(RELEASE_SCRIPT, {
            keys: [key],
            arguments: [token],
          });

          if (Number(deleted) === 0) {
            logger.warn(
              `Distributed lock "${key}" had already expired before release (TTL=${safeTtlMs}ms). ` +
                `Consider increasing ttlMs for this operation.`
            );
          }
        } catch (err) {
          // Never throw from release() inside a finally block—doing so would
          // mask business errors or fail an already-committed DB transaction.
          logger.error(`Failed to release Redis lock "${key}" (will auto-expire via TTL):`, err);
        }
      };
    }

    if (attempt < maxAttempts) {
      const jitter = Math.floor(Math.random() * 25);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs + jitter));
    }
  }

  return null;
}