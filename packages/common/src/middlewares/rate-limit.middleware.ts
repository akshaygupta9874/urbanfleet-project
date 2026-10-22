import { createHash } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import type { RedisClientType } from 'redis';
import { ServiceUnavailableError } from '../errors/app-error.js';

export interface SlidingWindowRateLimitOptions {
  redis: RedisClientType;
  limit: number;
  windowSeconds: number;
  keyPrefix?: string;
  keyGenerator?: (req: Request) => string;
  failOpen?: boolean;
}

const SLIDING_WINDOW_SCRIPT = `
local baseKey = KEYS[1]
local limit = tonumber(ARGV[1])
local windowSeconds = tonumber(ARGV[2])

-- Use Redis authoritative time to prevent clock drift across app pods
local time = redis.call('TIME')
local now = tonumber(time[1]) + (tonumber(time[2]) / 1000000)
local windowNumber = math.floor(now / windowSeconds)
local elapsedFraction = (now % windowSeconds) / windowSeconds

local previousKey = baseKey .. ":" .. (windowNumber - 1)
local currentKey = baseKey .. ":" .. windowNumber

local previousCount = tonumber(redis.call('GET', previousKey) or '0')
local currentCount = tonumber(redis.call('GET', currentKey) or '0')

local estimatedCount = previousCount * (1 - elapsedFraction) + currentCount

if estimatedCount + 1 > limit then
  return {0, currentCount, previousCount, tostring(elapsedFraction)}
end

local updatedCount = redis.call('INCR', currentKey)

-- Set TTL on first write (or if key somehow lost its TTL)
if updatedCount == 1 or redis.call('TTL', currentKey) < 0 then
  redis.call('EXPIRE', currentKey, windowSeconds * 2)
end

return {1, updatedCount, previousCount, tostring(elapsedFraction)}
`;

export function slidingWindowRateLimit({
  redis,
  limit,
  windowSeconds,
  keyPrefix = 'rate-limit',
  keyGenerator = (req) => req.ip || req.socket?.remoteAddress || 'unknown',
  failOpen = false,
}: SlidingWindowRateLimitOptions): RequestHandler {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('limit must be a positive integer');
  }
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1) {
    throw new RangeError('windowSeconds must be a positive integer');
  }

  return async (req, res, next) => {
    try {
      if (!redis.isOpen) {
        if (failOpen) {
          return next();
        }
        throw new ServiceUnavailableError(
          'Rate limiting service is temporarily unavailable',
          'RATE_LIMITER_REDIS_UNAVAILABLE'
        );
      }

      const identifier = keyGenerator(req);
      const hashedIdentifier = createHash('sha256').update(identifier).digest('hex');

      // Hash tags keep both window keys in the same Redis Cluster slot
      const baseKey = `${keyPrefix}:{${hashedIdentifier}}`;

      const result = (await redis.eval(SLIDING_WINDOW_SCRIPT, {
        keys: [baseKey],
        arguments: [String(limit), String(windowSeconds)],
      })) as [number, number, number, string];

      const [allowed, postCount, previousCount, elapsedFractionStr] = result;
      const elapsedFraction = Number(elapsedFractionStr);

      // postCount already includes +1 when allowed === 1
      const estimatedCount = previousCount * (1 - elapsedFraction) + postCount;
      const remaining = Math.max(0, Math.floor(limit - estimatedCount));
      const resetSeconds = Math.max(1, Math.ceil(windowSeconds * (1 - elapsedFraction)));

      res.setHeader('RateLimit-Limit', String(limit));
      res.setHeader('RateLimit-Remaining', String(remaining));
      res.setHeader('RateLimit-Reset', String(resetSeconds));

      if (allowed !== 1) {
        let retryAfterSeconds: number;

        if (postCount < limit && previousCount > 0) {
          // Request will be allowed within the current window once previousCount decays enough
          const targetFraction = 1 - (limit - 1 - postCount) / previousCount;
          const fractionToWait = Math.max(0, targetFraction - elapsedFraction);
          retryAfterSeconds = Math.max(1, Math.ceil(fractionToWait * windowSeconds));
        } else {
          // Current window is full; wait for next window + time for postCount to decay by 1
          const nextWindowFraction = 1 - (limit - 1) / Math.max(limit, postCount);
          const additionalWait = Math.ceil(nextWindowFraction * windowSeconds);
          retryAfterSeconds = resetSeconds + additionalWait;
        }

        res.setHeader('Retry-After', String(retryAfterSeconds));
        res.status(429).json({
          success: false,
          message: 'Too many requests. Please try again later.',
          code: 'RATE_LIMIT_EXCEEDED',
        });
        return;
      }

      next();
    } catch (error) {
      if (failOpen) {
        return next();
      }
      if (error instanceof ServiceUnavailableError) {
        next(error);
        return;
      }
      next(
        new ServiceUnavailableError(
          'Rate limiting service is temporarily unavailable',
          'RATE_LIMITER_REDIS_UNAVAILABLE',
          error
        )
      );
    }
  };
}
