import { authRedisClient, authRedisKey } from './client.js';
import { createLogger } from '@urbanfleet/common';

const logger = createLogger('token-cache');

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Stores accessToken and refreshToken in Redis under auth:token:* for fast, sub-millisecond retrieval.
 */
export async function cacheTokens(
  userId: string,
  sessionId: string,
  accessToken: string,
  refreshToken: string
): Promise<void> {
  try {
    if (authRedisClient && authRedisClient.isOpen) {
      await Promise.all([
        authRedisClient.setEx(authRedisKey(`token:access:${userId}`), ACCESS_TOKEN_TTL_SECONDS, accessToken),
        authRedisClient.setEx(authRedisKey(`token:refresh:${userId}`), REFRESH_TOKEN_TTL_SECONDS, refreshToken),
        authRedisClient.setEx(authRedisKey(`token:refresh:${userId}:${sessionId}`), REFRESH_TOKEN_TTL_SECONDS, refreshToken),
        cacheSession(userId, sessionId),
      ]);
    }
  } catch (err: unknown) {
    logger.warn('Failed to cache tokens in Redis:', {
      error: err instanceof Error ? err.message : String(err),
      userId,
      sessionId,
    });
  }
}

/**
 * Stores session metadata in Redis for concurrent session validation:
 * - session:${sessionId} -> { userId, sessionId, createdAt }
 * - user-sessions:${userId} -> Set of active session IDs
 */
export async function cacheSession(
  userId: string,
  sessionId: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    if (authRedisClient && authRedisClient.isOpen) {
      const payload = JSON.stringify({
        userId,
        sessionId,
        createdAt: new Date().toISOString(),
        ...metadata,
      });
      await Promise.all([
        authRedisClient.setEx(authRedisKey(`session:${sessionId}`), REFRESH_TOKEN_TTL_SECONDS, payload),
        authRedisClient.sAdd(authRedisKey(`user-sessions:${userId}`), sessionId),
      ]);
    }
  } catch (err: unknown) {
    logger.warn('Failed to cache session in Redis:', {
      error: err instanceof Error ? err.message : String(err),
      userId,
      sessionId,
    });
  }
}

/**
 * Validates a session against Redis:
 * 1. Checks that session:${sessionId} exists
 * 2. Checks that sessionId is a member of user-sessions:${userId}
 * 3. Verifies that session.userId matches userId
 */
export async function validateSessionInRedis(
  userId: string,
  sessionId: string
): Promise<{ valid: boolean; reason?: string }> {
  if (!authRedisClient || !authRedisClient.isOpen) {
    logger.error('Session validation rejected because Redis client is unavailable', { userId, sessionId });
    return { valid: false, reason: 'REDIS_UNAVAILABLE' };
  }

  try {
    let storedSession = await authRedisClient.get(authRedisKey(`session:${sessionId}`));
    if (!storedSession) {
      storedSession = await authRedisClient.get(`session:${sessionId}`);
    }

    let activeSessionIds = await authRedisClient.sMembers(authRedisKey(`user-sessions:${userId}`));
    if (!activeSessionIds || activeSessionIds.length === 0) {
      activeSessionIds = await authRedisClient.sMembers(`user-sessions:${userId}`);
    }

    if (!storedSession) {
      return { valid: false, reason: 'SESSION_EXPIRED' };
    }

    if (activeSessionIds && activeSessionIds.length > 0 && !activeSessionIds.includes(sessionId)) {
      return { valid: false, reason: 'SESSION_EXPIRED' };
    }

    const parsed = JSON.parse(storedSession);
    if (parsed.userId && parsed.userId !== userId) {
      return { valid: false, reason: 'SESSION_MISMATCH' };
    }

    return { valid: true };
  } catch (err: unknown) {
    logger.error('Error validating session in Redis; failing closed:', {
      error: err instanceof Error ? err.message : String(err),
      userId,
      sessionId,
    });
    return { valid: false, reason: 'REDIS_UNAVAILABLE' };
  }
}

/**
 * Canonical interface for a cached user identity in Redis.
 * Only driverId is optional.
 */
export interface CachedUser {
  id: string;
  email: string;
  roles: string[];
  firstName: string;
  lastName: string;
  driverId?: string;
  isSuspended?: boolean;
}

/**
 * Stores user profile in Redis under auth:user:${userId} with 15-minute TTL.
 */
export async function cacheUser(user: CachedUser): Promise<void> {
  try {
    if (authRedisClient && authRedisClient.isOpen && user?.id) {
      const userStr = JSON.stringify(user);
      await authRedisClient.setEx(authRedisKey(`user:${user.id}`), ACCESS_TOKEN_TTL_SECONDS, userStr);
    }
  } catch (err: unknown) {
    logger.warn('Failed to cache user profile in Redis:', {
      error: err instanceof Error ? err.message : String(err),
      userId: user?.id,
    });
  }
}

/**
 * Retrieves cached user profile from Redis using canonical key auth:user:${userId}.
 */
export async function getCachedUser(userId: string): Promise<CachedUser | null> {
  try {
    if (authRedisClient && authRedisClient.isOpen) {
      const userStr = await authRedisClient.get(authRedisKey(`user:${userId}`));
      if (userStr) {
        return JSON.parse(userStr) as CachedUser;
      }
    }
  } catch (err: unknown) {
    logger.warn('Failed to get cached user from Redis:', {
      error: err instanceof Error ? err.message : String(err),
      userId,
    });
  }
  return null;
}

/**
 * Retrieves the cached active access token for a user.
 */
export async function getCachedAccessToken(userId: string): Promise<string | null> {
  try {
    if (authRedisClient && authRedisClient.isOpen) {
      return await authRedisClient.get(authRedisKey(`token:access:${userId}`));
    }
  } catch (err: unknown) {
    logger.warn('Failed to get cached access token from Redis:', {
      error: err instanceof Error ? err.message : String(err),
      userId,
    });
  }
  return null;
}

/**
 * Retrieves the cached active refresh token for a user or session.
 */
export async function getCachedRefreshToken(userId: string, sessionId?: string): Promise<string | null> {
  try {
    if (authRedisClient && authRedisClient.isOpen) {
      if (sessionId) {
        const token = await authRedisClient.get(authRedisKey(`token:refresh:${userId}:${sessionId}`));
        if (token) return token;
      }
      return await authRedisClient.get(authRedisKey(`token:refresh:${userId}`));
    }
  } catch (err: unknown) {
    logger.warn('Failed to get cached refresh token from Redis:', {
      error: err instanceof Error ? err.message : String(err),
      userId,
      sessionId,
    });
  }
  return null;
}

/**
 * Evicts cached tokens and active sessions from Redis during logout or token rotation.
 */
export async function revokeCachedTokens(userId: string, sessionId?: string): Promise<void> {
  try {
    if (authRedisClient && authRedisClient.isOpen) {
      const keysToDelete = [
        authRedisKey(`token:access:${userId}`),
        authRedisKey(`token:refresh:${userId}`),
        authRedisKey(`user:${userId}`),
        `user:${userId}`,
      ];
      if (sessionId) {
        keysToDelete.push(
          authRedisKey(`token:refresh:${userId}:${sessionId}`),
          authRedisKey(`session:${sessionId}`),
          `session:${sessionId}`
        );
        await Promise.all([
          typeof authRedisClient.sRem === 'function' ? authRedisClient.sRem(authRedisKey(`user-sessions:${userId}`), sessionId).catch(() => {}) : Promise.resolve(),
          typeof authRedisClient.sRem === 'function' ? authRedisClient.sRem(`user-sessions:${userId}`, sessionId).catch(() => {}) : Promise.resolve(),
        ]);
      } else {
        const sessions = typeof authRedisClient.sMembers === 'function' ? await authRedisClient.sMembers(authRedisKey(`user-sessions:${userId}`)).catch(() => []) : [];
        for (const s of sessions) {
          keysToDelete.push(authRedisKey(`session:${s}`), `session:${s}`);
        }
        keysToDelete.push(authRedisKey(`user-sessions:${userId}`), `user-sessions:${userId}`);
      }
      await Promise.all(keysToDelete.map((k) => authRedisClient.del(k).catch(() => {})));
    }
  } catch (err: unknown) {
    logger.warn('Failed to revoke cached tokens from Redis:', {
      error: err instanceof Error ? err.message : String(err),
      userId,
      sessionId,
    });
  }
}

/**
 * Revokes all sessions and refresh tokens for a user except the currently active sessionId.
 */
export async function revokeOtherSessions(userId: string, exceptSessionId: string): Promise<void> {
  try {
    if (authRedisClient && authRedisClient.isOpen) {
      const allSessions = (await authRedisClient.sMembers(authRedisKey(`user-sessions:${userId}`)).catch(() => [])) || [];
      const sessionsToRevoke = allSessions.filter((s) => s !== exceptSessionId);

      const keysToDelete: string[] = [];
      for (const s of sessionsToRevoke) {
        keysToDelete.push(
          authRedisKey(`token:refresh:${userId}:${s}`),
          authRedisKey(`session:${s}`),
          `session:${s}`
        );
      }

      await Promise.all([
        ...keysToDelete.map((k) => authRedisClient.del(k).catch(() => {})),
        sessionsToRevoke.length > 0
          ? authRedisClient.sRem(authRedisKey(`user-sessions:${userId}`), sessionsToRevoke).catch(() => {})
          : Promise.resolve(),
      ]);
    }
  } catch (err: unknown) {
    logger.warn('Failed to revoke other sessions from Redis:', {
      error: err instanceof Error ? err.message : String(err),
      userId,
      exceptSessionId,
    });
  }
}
