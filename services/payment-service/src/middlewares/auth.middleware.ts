import { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { AppError } from '../errors/index.js';
import { ServiceUnavailableError, asyncHandler, createLogger } from '@urbanfleet/common';
import { redisClient } from '../redis/client.js';
import { authClient } from '../clients/auth.client.js';
import { driverClient } from '../clients/driver.client.js';

const logger = createLogger('payment-auth-middleware');

export interface UserPayloadContext {
  userId: string;
  email: string;
  roles: string[];
  firstName: string;
  lastName: string;
  driverId?: string;
}

export type AuthenticatedUser = UserPayloadContext;

export interface AuthenticatedRequest extends Request {
  userId: string;
  roles: string[];
  sessionId: string;
  driverId?: string;
  user: UserPayloadContext;
}

export interface AuthPayload extends JwtPayload {
  userId: string;
  sessionId: string;
  email: string;
  roles: string[];
  tokenType?: string;
  firstName: string;
  lastName: string;
  driverId?: string;
}

export interface CachedUserRecord {
  id?: string;
  email?: string;
  roles?: string[];
  firstName?: string;
  lastName?: string;
  driverId?: string;
  isSuspended?: boolean;
  driver?: { id?: string };
}

export function getPublicKey(): string {
  const pubEnv = process.env.JWT_PUBLIC_KEY_BASE64;
  if (!pubEnv) {
    throw new AppError('CRITICAL: Missing JWT_PUBLIC_KEY_BASE64 in production!', 500, 'AUTH_CONFIG_ERROR');
  }
  return Buffer.from(pubEnv, 'base64').toString('utf-8');
}

export interface SessionValidationResult {
  valid: boolean;
  reason?: 'REDIS_UNAVAILABLE' | 'SESSION_EXPIRED' | 'SESSION_MISMATCH';
}

/**
 * Validates session in Redis fail-closed against auth:session and active user session set.
 */
export async function validateSessionInRedis(
  userId: string,
  sessionId: string
): Promise<SessionValidationResult> {
  if (!redisClient || !redisClient.isOpen) {
    logger.error('Session validation rejected: Redis is unavailable', { userId, sessionId });
    return { valid: false, reason: 'REDIS_UNAVAILABLE' };
  }

  let storedSession: string | null = null;
  let activeSessionIds: string[] = [];
  try {
    [storedSession, activeSessionIds] = await Promise.all([
      redisClient.get(`auth:session:${sessionId}`),
      redisClient.sMembers(`auth:user-sessions:${userId}`),
    ]);
  } catch (err: unknown) {
    logger.error('Failed to validate session in Redis due to infrastructure error:', {
      error: err instanceof Error ? err.message : String(err),
      sessionId,
      userId,
    });
    return { valid: false, reason: 'REDIS_UNAVAILABLE' };
  }

  if (!storedSession) {
    return { valid: false, reason: 'SESSION_EXPIRED' };
  }

  if (activeSessionIds && activeSessionIds.length > 0 && !activeSessionIds.includes(sessionId)) {
    return { valid: false, reason: 'SESSION_EXPIRED' };
  }

  try {
    const parsed = JSON.parse(storedSession) as { userId?: string };
    if (parsed.userId && parsed.userId !== userId) {
      return { valid: false, reason: 'SESSION_MISMATCH' };
    }
  } catch {
    return { valid: false, reason: 'SESSION_EXPIRED' };
  }

  return { valid: true };
}

export async function getCachedUser(userId: string): Promise<CachedUserRecord | null> {
  if (!redisClient || !redisClient.isOpen) return null;
  try {
    const userStr = await redisClient.get(`auth:user:${userId}`);
    if (userStr) {
      return JSON.parse(userStr) as CachedUserRecord;
    }
  } catch (err: unknown) {
    logger.warn('Failed to fetch user from Redis cache', {
      error: err instanceof Error ? err.message : String(err),
      userId,
    });
  }
  return null;
}

export async function cacheUser(userId: string, user: CachedUserRecord): Promise<void> {
  if (!redisClient || !redisClient.isOpen) return;
  try {
    await redisClient.setEx(`auth:user:${userId}`, 15 * 60, JSON.stringify(user));
  } catch {
    // Non-critical cache write failure
  }
}

export const authMiddleware: RequestHandler = asyncHandler(
  async (request: AuthenticatedRequest, _response: Response, next: NextFunction) => {
    // If request already has authenticated user (test bypass / mock), proceed
    if (request.userId && request.user) {
      return next();
    }

    // 1. Extract Token strictly from Authorization Bearer header (Single Source of Truth)
    const authHeader = request.headers.authorization;
    const token =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : undefined;

    if (!token) {
      throw new AppError('You are not authorized to access this resource.', 401, 'UNAUTHORIZED');
    }

    // 2. Strictly RS256 asymmetric verification with pinned issuer & audience
    let decodedData: AuthPayload;
    try {
      const pubKey = getPublicKey();
      decodedData = jwt.verify(token, pubKey, {
        algorithms: ['RS256'],
        issuer: 'urbanfleet-auth',
        audience: 'urbanfleet-api',
      }) as AuthPayload;
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      if (err instanceof Error && err.name === 'TokenExpiredError') {
        throw new AppError('Your token has expired.', 401, 'TOKEN_EXPIRED');
      }
      throw new AppError('Your token is invalid or expired.', 401, 'INVALID_TOKEN');
    }

    if (decodedData.tokenType && decodedData.tokenType !== 'ACCESS') {
      throw new AppError('Invalid token type. Access token required.', 401, 'INVALID_TOKEN_TYPE');
    }

    const userId = decodedData.userId;
    const sessionId = decodedData.sessionId;

    if (!userId) {
      throw new AppError('Your session is invalid. Please sign in again.', 401, 'INVALID_SESSION');
    }

    // 3. Validate Session (Fail-closed Redis check)
    if (sessionId) {
      const sessionCheck = await validateSessionInRedis(userId, sessionId);
      if (!sessionCheck.valid) {
        if (sessionCheck.reason === 'REDIS_UNAVAILABLE') {
          throw new ServiceUnavailableError(
            'Session validation service is temporarily unavailable',
            'SESSION_VALIDATION_UNAVAILABLE'
          );
        }
        if (sessionCheck.reason === 'SESSION_MISMATCH') {
          throw new AppError('Session mismatch. Please sign in again.', 401, 'SESSION_MISMATCH');
        }
        throw new AppError('Your session is no longer valid. Please sign in again.', 401, 'SESSION_EXPIRED');
      }
    }

    // 4. Fetch User Data (Cache first, then authClient / DB)
    let user = await getCachedUser(userId);

    if (user?.isSuspended) {
      throw new AppError('This account is suspended.', 403, 'ACCOUNT_SUSPENDED');
    }

    if (!user) {
      try {
        user = (await authClient.getUserById(userId)) as CachedUserRecord | null;
      } catch (err: unknown) {
        if (err instanceof AppError) throw err;
        logger.error('Failed to fetch user from authClient', {
          error: err instanceof Error ? err.message : String(err),
          userId,
        });
        throw new ServiceUnavailableError(
          'Authentication service is temporarily unavailable',
          'AUTH_SERVICE_UNAVAILABLE',
          err instanceof Error ? err : undefined
        );
      }

      if (!user) {
        throw new AppError('User account not found or has been deactivated', 401, 'USER_NOT_FOUND');
      }

      if (user.isSuspended) {
        throw new AppError('This account is suspended.', 403, 'ACCOUNT_SUSPENDED');
      }

      await cacheUser(userId, user);
    }

    // 5. Attach payload to Request and proceed
    const userRoles = Array.isArray(user.roles) ? user.roles : ['RIDER'];
    let driverId = user.driver?.id || user.driverId;

    if (!driverId && userRoles.includes('DRIVER')) {
      try {
        const driverProfile = await driverClient.getDriverByUserId(userId);
        if (driverProfile?.id) {
          driverId = driverProfile.id;
          user.driverId = driverId;
          await cacheUser(userId, user);
        }
      } catch (err: unknown) {
        logger.warn('Failed to resolve driverId from driver-service', {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    request.userId = userId;
    request.roles = userRoles;
    request.sessionId = sessionId || '';
    request.driverId = driverId;
    request.user = {
      userId,
      email: typeof user.email === 'string' ? user.email : (decodedData.email || ''),
      roles: userRoles,
      firstName: user.firstName || 'User',
      lastName: user.lastName || '',
      driverId,
    };

    next();
  }
);

export type AllowedRole = 'ADMIN' | 'DRIVER' | 'RIDER' | string;

export const hasRole = (
  req: AuthenticatedRequest,
  ...allowedRoles: AllowedRole[]
): boolean => {
  const roles = req.roles || req.user?.roles || [];
  return roles.some((r) => allowedRoles.includes(r as AllowedRole));
};

export const requireRole = (...allowedRoles: AllowedRole[]): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const authReq = req as unknown as AuthenticatedRequest;
    if (!authReq.userId) {
      return next(new AppError('User unauthenticated', 401, 'UNAUTHORIZED'));
    }
    if (!hasRole(authReq, ...allowedRoles)) {
      return next(
        new AppError(`Forbidden: Requires one of roles: ${allowedRoles.join(', ')}`, 403, 'FORBIDDEN')
      );
    }
    next();
  };
};

/**
 * Authoritative boundary guard allowing verified internal cluster services,
 * or delegating to authMiddleware (with an optional required role).
 */
export const requireInternalOrAuth = (requiredRole?: AllowedRole) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const internalKey =
      process.env.INTERNAL_SERVICE_KEY || 'urbanfleet-internal-service-secret';
    const providedKey = req.headers['x-internal-service-key'];
    if (providedKey && providedKey === internalKey) {
      (req as any).userId = (req as any).userId || 'internal-service';
      (req as any).roles = ['ADMIN'];
      return next();
    }
    return authMiddleware(req as AuthenticatedRequest, res, (err?: unknown) => {
      if (err) return next(err);
      if (requiredRole) {
        return requireRole(requiredRole)(req as AuthenticatedRequest, res, next);
      }
      return next();
    });
  };
};

export const requireAdminOrInternalService = requireInternalOrAuth('ADMIN');
export const requireSelfOrAdminOrInternalService = requireInternalOrAuth();

export const requireAdmin = requireRole('ADMIN');
export const requireDriver = requireRole('DRIVER');
export const protect = authMiddleware;

export default authMiddleware;
