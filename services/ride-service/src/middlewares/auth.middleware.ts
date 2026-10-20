import { NextFunction, Request, Response, RequestHandler } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import crypto from 'crypto';
import { AppError, AuthUser } from '@urbanfleet/common';
import asyncHandler from './asyncHandler.js';
import { rideRedisClient } from '../redis/client.js';

export interface AuthenticatedRequest extends Request {
  userId?: string;
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

    // Allow internal service communication (strictly requiring configured non-fallback key)
    const internalKey = req.headers['x-internal-service-key'];
    const expectedKey = process.env.INTERNAL_SERVICE_KEY;
    if (
      expectedKey &&
      internalKey &&
      typeof internalKey === 'string' &&
      internalKey.length === expectedKey.length &&
      crypto.timingSafeEqual(Buffer.from(internalKey), Buffer.from(expectedKey))
    ) {
      req.userId = 'internal-service';
      req.role = ['ADMIN'];
      req.user = { id: 'internal-service', userId: 'internal-service', email: 'internal@urbanfleet.local', role: 'ADMIN', roles: ['ADMIN'] };
      return next();
    }

    // 1. Extract Token from Authorization header or cookie
    const cookies = (req.cookies || {}) as Record<string, string | undefined>;
    const token =
      req.headers.authorization?.replace(/^Bearer\s+/i, '') ||
      cookies.accessToken ||
      cookies.token;

    if (!token) {
      throw new AppError('You are not authorized to access this resource.', 401, 'UNAUTHORIZED');
    }

    // 2. Verify Token
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
      } else if (process.env.NODE_ENV === 'production') {
        throw new AppError('Server misconfiguration: Missing JWT public key in production', 500, 'INTERNAL_ERROR');
      } else {
        const secret = process.env.JWT_ACCESS_SECRET || 'test-access-secret-only';
        decodedData = jwt.verify(token, secret) as AuthPayload;
      }
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      const secret = process.env.JWT_ACCESS_SECRET;
      if (secret && process.env.NODE_ENV !== 'production') {
        try {
          decodedData = jwt.verify(token, secret) as AuthPayload;
        } catch (_) {
          throw new AppError('Your token is invalid or expired.', 401, 'TOKEN_EXPIRED');
        }
      } else {
        throw new AppError('Your token is invalid or expired.', 401, 'TOKEN_EXPIRED');
      }
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

    // 3. Validate Session (Proper sequential Redis lookup)
    if (sessionId && rideRedisClient.isOpen) {
      try {
        let storedSession = await rideRedisClient.get(`auth:session:${sessionId}`);
        if (!storedSession) {
          storedSession = await rideRedisClient.get(`session:${sessionId}`);
        }

        if (storedSession) {
          const parsed = JSON.parse(storedSession) as { userId?: string };
          if (parsed.userId && parsed.userId !== userId) {
            throw new AppError('Session mismatch. Please sign in again.', 401, 'SESSION_MISMATCH');
          }
        }
      } catch (e: unknown) {
        if (e instanceof AppError) throw e;
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
      } catch (err) {}
    }

    if (!user) {
      user = {
        id: userId,
        email: decodedData.email || '',
        role: decodedData.role || 'RIDER',
        roles: decodedData.roles || (Array.isArray(decodedData.role) ? decodedData.role : [decodedData.role || 'RIDER']),
      };
    }

    // 5. Attach payload to Request and proceed
    req.userId = userId;
    const userRoles = Array.isArray(user.roles) ? (user.roles as string[]) : [String(user.role || 'RIDER')];
    req.role = userRoles;
    const userDriver = user.driver as Record<string, unknown> | undefined;
    const driverId = (userDriver?.id as string | undefined) || (user.driverId as string | undefined);
    req.driverId = driverId;
    const firstName = String(user.firstName || 'User');
    const lastName = String(user.lastName || '');

    req.user = {
      userId,
      id: userId,
      email: typeof user.email === 'string' ? user.email : undefined,
      role: typeof user.role === 'string' ? user.role : undefined,
      roles: req.role,
      firstName,
      lastName,
      driverId: req.driverId,
    };

    next();
  }
);

export const requireRole = (...allowedRoles: string[]): RequestHandler => {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    if (!req.userId && !req.user) {
      return next(new AppError('User unauthenticated', 401, 'UNAUTHORIZED'));
    }
    const roles: string[] = req.role || (req.user?.role ? [req.user.role] : []);
    const hasRole = roles.some((r) => allowedRoles.includes(r)) || (req.user?.role && allowedRoles.includes(req.user.role));
    if (!hasRole) {
      return next(
        new AppError(`Forbidden: Requires one of roles: ${allowedRoles.join(', ')}`, 403, 'FORBIDDEN')
      );
    }
    next();
  };
};

export default authMiddleware;
