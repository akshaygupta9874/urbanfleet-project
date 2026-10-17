import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { authRedisClient, authRedisKey } from '../redis/client.js';
import { getCsrfCookieOptions } from '../utils/cookie.js';
import { ForbiddenError, UnauthorizedError } from '@urbanfleet/common';

// Default to 24 hours (86400 seconds) if missing
const CSRF_EXPIRE_SECONDS = process.env.CSRF_TOKEN_EXPIRE_SECONDS
  ? parseInt(process.env.CSRF_TOKEN_EXPIRE_SECONDS, 10)
  : 24 * 60 * 60;

/**
 * Generates a cryptographically random 32-byte hex token,
 * stores it in Redis under auth:csrf:<userId>, and attaches it as an httpOnly=false cookie.
 */
export const generateCSRFToken = async (userId: string, response: Response): Promise<string> => {
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const redisKey = authRedisKey(`csrf:${userId}`);

  try {
    if (authRedisClient.isOpen) {
      await authRedisClient.setEx(redisKey, CSRF_EXPIRE_SECONDS, csrfToken);
    }
  } catch (err) {
    // If Redis is temporarily unreachable, cookie still provides Double-Submit protection
  }

  response.cookie('csrfToken', csrfToken, getCsrfCookieOptions({
    maxAge: CSRF_EXPIRE_SECONDS * 1000,
  }));

  return csrfToken;
};

/**
 * Express middleware to verify CSRF token on state-changing requests (POST, PUT, PATCH, DELETE).
 * Safe HTTP methods (GET, HEAD, OPTIONS) skip CSRF checks.
 */
export const verifyCsrfToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  // 1. Skip safe HTTP methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) {
    return next();
  }

  // 2. Resolve user ID from authenticated request or session
  const userId = (req as any).user?.userId || (req as any).userId;
  if (!userId) {
    return next(new UnauthorizedError('User unauthenticated for CSRF verification'));
  }

  // 3. Extract CSRF token from headers
  const clientToken = (
    req.headers['x-csrf-token'] ||
    req.headers['x-xsrf-token'] ||
    req.headers['csrf-token']
  ) as string | undefined;

  if (!clientToken) {
    return next(new ForbiddenError('CSRF token missing', 'CSRF_TOKEN_MISSING'));
  }

  // 4. Validate token against Redis (or fallback to double-submit cookie comparison)
  const redisKey = authRedisKey(`csrf:${userId}`);
  let storedCSRFToken: string | null = null;

  try {
    if (authRedisClient.isOpen) {
      storedCSRFToken = await authRedisClient.get(redisKey);
    }
  } catch (err) {
    // Fallback: check double submit cookie if redis error occurs
  }

  // If redis returned a token, enforce strict equality
  if (storedCSRFToken !== null) {
    if (clientToken !== storedCSRFToken) {
      return next(new ForbiddenError('CSRF Token INVALID', 'CSRF_TOKEN_INVALID'));
    }
    return next();
  }

  // If redis is connected and key was expired/missing:
  if (authRedisClient.isOpen) {
    return next(new ForbiddenError('CSRF Token expired', 'CSRF_TOKEN_EXPIRED'));
  }

  // Offline/Dev fallback: compare with cookie if redis is not open
  const cookieToken = req.cookies?.csrfToken;
  if (cookieToken && clientToken === cookieToken) {
    return next();
  }

  return next(new ForbiddenError('CSRF Token expired or invalid', 'CSRF_TOKEN_INVALID'));
};

/**
 * Revokes CSRF token from Redis and expires the cookie.
 */
export const revokeCSRFToken = async (userId: string, response?: Response): Promise<void> => {
  const redisKey = authRedisKey(`csrf:${userId}`);
  try {
    if (authRedisClient.isOpen) {
      await authRedisClient.del(redisKey);
    }
  } catch (err) {}

  if (response) {
    response.clearCookie('csrfToken', getCsrfCookieOptions());
  }
};

/**
 * Rotates CSRF token by revoking old and issuing a new one.
 */
export const refreshCSRFToken = async (userId: string, response: Response): Promise<string> => {
  await revokeCSRFToken(userId);
  return await generateCSRFToken(userId, response);
};
