import { randomUUID } from "crypto";
import { redisClient } from "./client.js";

export type ReleaseLock = () => Promise<void>;

const RELEASE_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  end
  return 0
`;

/**
 * Distributed lock: SET key token NX PX ttl.
 * Returns a release function, or null when somebody else holds the lock.
 * Release is compare-and-delete (Lua) so an expired lock is never released
 * on behalf of the process that took it over.
 */
export async function acquireLock(
    key: string,
    ttlMs: number
): Promise<ReleaseLock | null> {
    const token = randomUUID();

    const result = await redisClient.set(
        key,
        token,
        {
            NX: true,
            PX: ttlMs,
        }
    );

    if (result !== "OK") {
        return null;
    }

    return async (): Promise<void> => {
        await redisClient.eval(RELEASE_SCRIPT, {
            keys: [key],
            arguments: [token],
        });
    };
}
