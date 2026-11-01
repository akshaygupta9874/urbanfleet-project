import { NextFunction, Request, Response, RequestHandler } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { AppError, AuthUser, ServiceUnavailableError, createLogger } from '@urbanfleet/common';

const logger = createLogger('ride-auth-middleware');
import asyncHandler from './asyncHandler.js';
import { rideRedisClient } from '../redis/client.js';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  roles?: string[];
  role?: string[];
  driverId?: string;
  user?: AuthUser;
}

export interface AuthPayload extends JwtPayload {
  id?: string;
  userId?: string;
  sessionId?: string;
  email?: string;
  role?: string | string[];
  roles?: string[];
  tokenType?: string;
}

export const authMiddleware: RequestHandler = asyncHandler(
  async (req: AuthenticatedRequest, _response: Response, next: NextFunction) => {
    // If request already has authenticated user (test bypass / mock), proceed
    if (req.userId && req.user) {
      return next();
    }

    // 1. Extract Token strictly from Authorization Bearer header (Single Source of Truth)
    const authHeader = req.headers.authorization;
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
        throw new AppError('Server misconfiguration: Missing JWT public key in production', 500, 'INTERNAL_ERROR');
      }
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      throw new AppError('Your token is invalid or expired.', 401, 'TOKEN_EXPIRED');
    }

    // Token Type Defense (reject refresh tokens used as bearer)
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
      if (!rideRedisClient || !rideRedisClient.isOpen) {
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
          rideRedisClient.get(`auth:session:${sessionId}`).then((res) => res || rideRedisClient.get(`session:${sessionId}`)),
          rideRedisClient.sMembers(`auth:user-sessions:${userId}`).then((res) => (res && res.length > 0 ? res : rideRedisClient.sMembers(`user-sessions:${userId}`))),
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

      const parsed = JSON.parse(storedSession) as { userId?: string };
      if (parsed.userId && parsed.userId !== userId) {
        throw new AppError('Session mismatch. Please sign in again.', 401, 'SESSION_MISMATCH');
      }
    }

    // 4. Fetch User Data (Cache first)
    let user: Record<string, unknown> | null = null;
    if (rideRedisClient.isOpen) {
      try {
        const userStr =
          (await rideRedisClient.get(`auth:user:${userId}`)) ||
          (await rideRedisClient.get(`user:${userId}`));
        if (userStr) {
          user = JSON.parse(userStr) as Record<string, unknown>;
        }
      } catch (err: unknown) {
        logger.warn('Failed to fetch user from Redis cache', {
          error: err instanceof Error ? err.message : String(err),
          userId,
        });
      }
    }

    if (!user) {
      const tokenRoles = Array.isArray(decodedData.roles) ? decodedData.roles : ['RIDER'];
      user = {
        id: userId,
        email: decodedData.email || '',
        roles: tokenRoles,
      };
    }

    // 5. Attach payload to Request and proceed
    req.userId = userId;
    const userRoles = Array.isArray(user.roles) ? (user.roles as string[]) : ['RIDER'];
    req.roles = userRoles;
    req.role = userRoles;
    const userDriver = user.driver as Record<string, unknown> | undefined;
    const driverId = (userDriver?.id as string | undefined) || (user.driverId as string | undefined);
    req.driverId = driverId;
    const firstName = String(user.firstName || 'User');
    const lastName = String(user.lastName || '');

    req.user = {
      userId,
      email: typeof user.email === 'string' ? user.email : '',
      roles: userRoles,
      firstName,
      lastName,
      driverId: req.driverId,
    };

    next();
  }
);

export const requireRole = (...allowedRoles: string[]): RequestHandler => {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
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
  };
};

export const optionalAuth: RequestHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (req.userId && req.user) {
      return next();
    }

    const authHeader = req.headers.authorization;
    const token =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : undefined;

    if (!token) {
      return next();
    }

    return authMiddleware(req, res, next);
  }
);

export default authMiddleware;
