import type { CookieOptions, Response } from 'express';

const getCookieDomain = (): string | undefined => process.env.COOKIE_DOMAIN || undefined;

const getIsSecure = (): boolean =>
  process.env.COOKIE_SECURE === 'true' ||
  (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production');

/**
 * Base configuration for secure backend cookies (e.g., Refresh Tokens, Sessions).
 */
export const getCookieOptions = (overrides: CookieOptions = {}): CookieOptions => {
  const cookieDomain = getCookieDomain();
  const isSecure = getIsSecure();
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: isSecure ? 'none' : 'lax',
    path: '/',
    ...(cookieDomain && { domain: cookieDomain }),
    ...overrides,
  };
};

/**
 * Configuration specifically for CSRF cookies.
 * httpOnly MUST be false so frontend JS (apiInterceptor) can read it and attach it to headers.
 */
export const getCsrfCookieOptions = (overrides: CookieOptions = {}): CookieOptions => ({
  ...getCookieOptions({
    httpOnly: false,
    ...overrides,
  }),
});

/**
 * Standard cookie options for the refresh token.
 */
export const REFRESH_TOKEN_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const getRefreshTokenCookieOptions = (overrides: CookieOptions = {}): CookieOptions =>
  getCookieOptions({
    maxAge: REFRESH_TOKEN_COOKIE_MAX_AGE_MS,
    ...overrides,
  });

/**
 * Shared helper to attach the refresh token cookie to an Express response.
 */
export const setRefreshTokenCookie = (
  res: Response,
  token: string,
  overrides: CookieOptions = {},
): void => {
  res.cookie('refreshToken', token, getRefreshTokenCookieOptions(overrides));
};

/**
 * Helper to reliably clear cookies during logout.
 * Express requires matching path and domain for cookie eviction.
 */
export const clearCookieOptions = (overrides: CookieOptions = {}): CookieOptions => {
  const cookieDomain = getCookieDomain();
  const isSecure = getIsSecure();
  return {
    path: '/',
    ...(cookieDomain && { domain: cookieDomain }),
    httpOnly: true,
    secure: isSecure,
    sameSite: isSecure ? 'none' : 'lax',
    ...overrides,
  };
};

/**
 * Shared helper to clear auth cookies (refreshToken and csrfToken) on an Express response.
 * Uses clearCookieOptions so path, domain, sameSite, and secure attributes match exactly.
 */
export const clearAuthCookies = (res: Response): void => {
  res.clearCookie('refreshToken', clearCookieOptions());
  res.clearCookie('csrfToken', clearCookieOptions({ httpOnly: false }));
};

