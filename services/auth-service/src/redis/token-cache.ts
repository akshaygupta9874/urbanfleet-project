import { authRedisClient, authRedisKey } from './client.js';

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
    if (authRedisClient.isOpen) {
      await Promise.all([
        authRedisClient.setEx(authRedisKey(`token:access:${userId}`), ACCESS_TOKEN_TTL_SECONDS, accessToken),
        authRedisClient.setEx(authRedisKey(`token:refresh:${userId}`), REFRESH_TOKEN_TTL_SECONDS, refreshToken),
        authRedisClient.setEx(authRedisKey(`token:refresh:${userId}:${sessionId}`), REFRESH_TOKEN_TTL_SECONDS, refreshToken),
      ]);
    }
  } catch (err) {
    // Non-blocking fallback if Redis is temporarily unreachable
  }
}

/**
 * Retrieves the cached active access token for a user.
 */
export async function getCachedAccessToken(userId: string): Promise<string | null> {
  try {
    if (authRedisClient.isOpen) {
      return await authRedisClient.get(authRedisKey(`token:access:${userId}`));
    }
  } catch (err) {}
  return null;
}

/**
 * Retrieves the cached active refresh token for a user or session.
 */
export async function getCachedRefreshToken(userId: string, sessionId?: string): Promise<string | null> {
  try {
    if (authRedisClient.isOpen) {
      if (sessionId) {
        const token = await authRedisClient.get(authRedisKey(`token:refresh:${userId}:${sessionId}`));
        if (token) return token;
      }
      return await authRedisClient.get(authRedisKey(`token:refresh:${userId}`));
    }
  } catch (err) {}
  return null;
}

/**
 * Evicts cached tokens from Redis during logout or token rotation.
 */
export async function revokeCachedTokens(userId: string, sessionId?: string): Promise<void> {
  try {
    if (authRedisClient.isOpen) {
      const keysToDelete = [
        authRedisKey(`token:access:${userId}`),
        authRedisKey(`token:refresh:${userId}`),
      ];
      if (sessionId) {
        keysToDelete.push(authRedisKey(`token:refresh:${userId}:${sessionId}`));
      }
      await Promise.all(keysToDelete.map((k) => authRedisClient.del(k)));
    }
  } catch (err) {}
}
