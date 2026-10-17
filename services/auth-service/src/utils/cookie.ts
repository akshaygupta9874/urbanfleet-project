import type { CookieOptions } from 'express';

const isProduction = process.env.NODE_ENV === 'production';
const cookieDomain = process.env.COOKIE_DOMAIN || undefined;

const isLocalhost =
  !process.env.FRONTEND_URL ||
  process.env.FRONTEND_URL.includes('localhost') ||
  process.env.FRONTEND_URL.includes('127.0.0.1');

const isSecure =
  process.env.COOKIE_SECURE === 'true' ||
  (isProduction && !isLocalhost);

/**
 * Base configuration for secure backend cookies (e.g., Refresh Tokens, Sessions).
 * httpOnly prevents client-side JS from reading the cookie (critical XSS mitigation).
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
export const clearCookieOptions = (): CookieOptions => ({
  path: '/',
  ...(cookieDomain && { domain: cookieDomain }),
  secure: isSecure,
  sameSite: isSecure ? 'none' : 'lax',
});
