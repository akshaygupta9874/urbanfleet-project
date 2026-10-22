import type { CookieOptions } from 'express';

const cookieDomain = process.env.COOKIE_DOMAIN || undefined;

/**
 * Base configuration for secure backend cookies (e.g., Refresh Tokens, Sessions).
 * Strictly configured for production: httpOnly, secure, sameSite 'none'.
 */
export const getCookieOptions = (overrides: CookieOptions = {}): CookieOptions => ({
  httpOnly: true,
  secure: true,
  sameSite: 'none',
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
export const clearCookieOptions = (): CookieOptions => ({
  path: '/',
  ...(cookieDomain && { domain: cookieDomain }),
  secure: true,
  sameSite: 'none',
});
