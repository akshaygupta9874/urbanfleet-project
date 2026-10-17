import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  cacheTokens,
  getCachedAccessToken,
  getCachedRefreshToken,
  revokeCachedTokens,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} from '../src/redis/token-cache.js';
import { authRedisClient, authRedisKey } from '../src/redis/client.js';

describe('Redis Token Caching for Fast Access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores accessToken and refreshToken with appropriate TTLs in Redis', async () => {
    vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(true);
    const setExSpy = vi.spyOn(authRedisClient, 'setEx').mockResolvedValue('OK' as any);

    await cacheTokens('usr-100', 'sess-1', 'mock-access-token', 'mock-refresh-token');

    expect(setExSpy).toHaveBeenCalledWith(
      authRedisKey('token:access:usr-100'),
      ACCESS_TOKEN_TTL_SECONDS,
      'mock-access-token'
    );
    expect(setExSpy).toHaveBeenCalledWith(
      authRedisKey('token:refresh:usr-100'),
      REFRESH_TOKEN_TTL_SECONDS,
      'mock-refresh-token'
    );
    expect(setExSpy).toHaveBeenCalledWith(
      authRedisKey('token:refresh:usr-100:sess-1'),
      REFRESH_TOKEN_TTL_SECONDS,
      'mock-refresh-token'
    );

    setExSpy.mockRestore();
  });

  it('retrieves cached access token from Redis', async () => {
    vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(true);
    const getSpy = vi.spyOn(authRedisClient, 'get').mockResolvedValue('cached-jwt-access' as any);

    const token = await getCachedAccessToken('usr-100');

    expect(getSpy).toHaveBeenCalledWith(authRedisKey('token:access:usr-100'));
    expect(token).toBe('cached-jwt-access');
    getSpy.mockRestore();
  });

  it('retrieves cached refresh token from Redis with session fallback', async () => {
    vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(true);
    const getSpy = vi.spyOn(authRedisClient, 'get').mockResolvedValue('cached-jwt-refresh' as any);

    const token = await getCachedRefreshToken('usr-100', 'sess-1');

    expect(getSpy).toHaveBeenCalledWith(authRedisKey('token:refresh:usr-100:sess-1'));
    expect(token).toBe('cached-jwt-refresh');
    getSpy.mockRestore();
  });

  it('revokes cached tokens on logout or password rotation', async () => {
    vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(true);
    const delSpy = vi.spyOn(authRedisClient, 'del').mockResolvedValue(1 as any);

    await revokeCachedTokens('usr-100', 'sess-1');

    expect(delSpy).toHaveBeenCalledWith(authRedisKey('token:access:usr-100'));
    expect(delSpy).toHaveBeenCalledWith(authRedisKey('token:refresh:usr-100'));
    expect(delSpy).toHaveBeenCalledWith(authRedisKey('token:refresh:usr-100:sess-1'));

    delSpy.mockRestore();
  });
});
