import { NextFunction, Request, Response, RequestHandler } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { AppError, ServiceUnavailableError, createLogger } from '@urbanfleet/common';
import asyncHandler from './asyncHandler.js';
import { notificationRedisClient } from '../redis/client.js';
import { authClient } from '../clients/auth.client.js';

const logger = createLogger('notification-auth-middleware');

export interface NotificationUserContext {
  userId: string;
  email: string;
  roles: string[];
  firstName: string;
  lastName: string;
  driverId?: string;
}

export interface NotificationUserRecord {
  id: string;
  email: string;
  roles: string[];
  firstName: string;
  lastName: string;
  driverId?: string;
}

export interface AuthenticatedRequest extends Request {
  userId?: string;
  roles?: string[];
  role?: string[];
  driverId?: string;
  user?: NotificationUserContext;
}

export interface AuthPayload extends JwtPayload {
  id?: string;
  userId?: string;
  sessionId?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  roles?: string[];
  role?: string;
}

export const authMiddleware: RequestHandler = asyncHandler(
  async (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
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

    // 2. Verify Token (strictly production RS256)
    let decodedData: AuthPayload;
    try {
      const pubEnv = process.env.JWT_PUBLIC_KEY_BASE64;
      if (pubEnv) {
        const pubKey = Buffer.from(pubEnv, 'base64').toString('utf-8');
        decodedData = jwt.verify(token, pubKey, {
          algorithms: ['RS256'],
          issuer: 'urbanfleet-auth',
          audience: 'urbanfleet-api',
        }) as AuthPayload;
      } else {
        throw new AppError('CRITICAL: Missing JWT_PUBLIC_KEY_BASE64 in production!', 500, 'AUTH_CONFIG_ERROR');
      }
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      throw new AppError('Your token is invalid or expired.', 401, 'TOKEN_EXPIRED');
    }

    const userId = decodedData.userId;
    const sessionId = decodedData.sessionId;

    if (!userId) {
      throw new AppError('Your session is invalid. Please sign in again.', 401, 'INVALID_SESSION');
    }

    // 3. Validate Session (Fail-closed Redis check)
    if (sessionId) {
      if (!notificationRedisClient || !notificationRedisClient.isOpen) {
        logger.error('Session validation rejected: Redis is unavailable', { userId, sessionId });
        throw new ServiceUnavailableError(
          'Session validation service is temporarily unavailable',
          'SESSION_VALIDATION_UNAVAILABLE'
        );
      }

      let storedSession: string | null = null;
      let activeSessionIds: string[] = [];
      try {
        [storedSession, activeSessionIds] = await Promise.all([
          notificationRedisClient.get(`auth:session:${sessionId}`).then((res) => res || notificationRedisClient.get(`session:${sessionId}`)),
          notificationRedisClient.sMembers(`auth:user-sessions:${userId}`).then((res) => (res && res.length > 0 ? res : notificationRedisClient.sMembers(`user-sessions:${userId}`))),
        ]);
      } catch (e: unknown) {
        if (e instanceof AppError) throw e;
        logger.error('Failed to validate session in Redis due to infrastructure error:', {
          error: e instanceof Error ? e.message : String(e),
          sessionId,
          userId,
        });
        throw new ServiceUnavailableError(
          'Session validation service is temporarily unavailable',
          'SESSION_VALIDATION_UNAVAILABLE',
          e instanceof Error ? e : undefined
        );
      }

      if (!storedSession) {
        throw new AppError('Your session is no longer valid. Please sign in again.', 401, 'SESSION_EXPIRED');
      }

      if (activeSessionIds && activeSessionIds.length > 0 && !activeSessionIds.includes(sessionId)) {
        throw new AppError('Your session is no longer valid. Please sign in again.', 401, 'SESSION_EXPIRED');
      }

      const parsed = JSON.parse(storedSession) as { userId: string };
      if (parsed.userId && parsed.userId !== userId) {
        throw new AppError('Session mismatch. Please sign in again.', 401, 'SESSION_MISMATCH');
      }
    }

    // 4. Fetch User Data (Cache first, then authClient / DB)
    let user: NotificationUserRecord | null = null;
    if (notificationRedisClient.isOpen) {
      try {
        const userStr = await notificationRedisClient.get(`auth:user:${userId}`);
        if (userStr) {
          user = JSON.parse(userStr) as NotificationUserRecord;
        }
      } catch (err: unknown) {
        logger.warn('Failed to read user from Redis:', { error: err instanceof Error ? err.message : String(err), userId });
      }
    }

    if (!user) {
      try {
        const authUser = await authClient.getUserById(userId);
        if (authUser) {
          const rawRoles = (authUser as any).roles;
          const userRoles = Array.isArray(rawRoles)
            ? rawRoles
            : (typeof authUser.role === 'string' ? [authUser.role] : ['RIDER']);

          user = {
            id: authUser.id,
            email: authUser.email,
            roles: userRoles,
            firstName: authUser.firstName,
            lastName: authUser.lastName,
          };
        }
      } catch (err: unknown) {
        logger.error('Failed to query user from AuthClient:', { error: err instanceof Error ? err.message : String(err), userId });
        throw new ServiceUnavailableError(
          'Authentication service is temporarily unavailable',
          'AUTH_SERVICE_UNAVAILABLE',
          err instanceof Error ? err : undefined
        );
      }
    }

    // If user is not found in the database, reject immediately
    if (!user) {
      throw new AppError('User account not found or has been deactivated', 401, 'USER_NOT_FOUND');
    }

    const activeUser = user;

    if (notificationRedisClient.isOpen) {
      try {
        await notificationRedisClient.setEx(`auth:user:${userId}`, 15 * 60, JSON.stringify(activeUser));
      } catch (err: unknown) {
        logger.warn('Failed to cache user in Redis:', { error: err instanceof Error ? err.message : String(err), userId });
      }
    }

    // Attach to Request
    const userRoles = Array.isArray(activeUser.roles) ? activeUser.roles : ['RIDER'];
    request.userId = userId;
    request.roles = userRoles;
    request.role = userRoles;
    request.driverId = activeUser.driverId;
    request.user = {
      userId,
      email: activeUser.email || '',
      roles: userRoles,
      firstName: activeUser.firstName || 'User',
      lastName: activeUser.lastName || '',
      driverId: activeUser.driverId,
    };

    next();
  }
);

export const requireRole = (...allowedRoles: string[]) => {
  return ((req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    if (!req.userId) {
      return next(new AppError('User unauthenticated', 401, 'UNAUTHORIZED'));
    }
    const roles: string[] = req.roles ?? req.role ?? [];
    const hasRole = roles.some((r) => allowedRoles.includes(r));
    if (!hasRole) {
      return next(
        new AppError(`Forbidden: Requires one of roles: ${allowedRoles.join(', ')}`, 403, 'FORBIDDEN')
      );
    }
    next();
  }) as RequestHandler;
};

export const requireAdmin = requireRole('ADMIN');
export const requireDriver = requireRole('DRIVER');
export default authMiddleware;
