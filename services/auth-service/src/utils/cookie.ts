import type { CookieOptions } from 'express';

const cookieDomain = process.env.COOKIE_DOMAIN || undefined;
const isSecure =
  process.env.COOKIE_SECURE === 'true' ||
  (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production');

/**
 * Base configuration for secure backend cookies (e.g., Refresh Tokens, Sessions).
 */
export const getCookieOptions = (overrides: CookieOptions = {}): CookieOptions => ({
  httpOnly: true,
  secure: isSecure,
  sameSite: isSecure ? 'none' : 'lax',
  path: '/',
  ...(cookieDomain && { domain: cookieDomain }),
  ...overrides,
});

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
 * Helper to reliably clear cookies during logout.
 * Express requires matching path and domain for cookie eviction.
 */
export const clearCookieOptions = (overrides: CookieOptions = {}): CookieOptions => ({
  path: '/',
  ...(cookieDomain && { domain: cookieDomain }),
  httpOnly: true,
  secure: isSecure,
  sameSite: isSecure ? 'none' : 'lax',
  ...overrides,
});
