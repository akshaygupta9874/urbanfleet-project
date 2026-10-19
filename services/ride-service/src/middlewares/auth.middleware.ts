import { NextFunction, Request, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import crypto from 'crypto';
import { AppError } from '@urbanfleet/common';
import asyncHandler from './asyncHandler.js';
import { rideRedisClient } from '../redis/client.js';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  role?: string[];
  driverId?: string;
  user?: any;
}

export interface AuthPayload extends JwtPayload {
  id?: string;
  userId?: string;
  sessionId?: string;
  email?: string;
  role?: string | string[];
  roles?: string[];
}

export const authMiddleware = asyncHandler(
  async (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    // If request already has authenticated user (test bypass / mock), proceed
    if (request.userId && request.user) {
      return next();
    }

    // Allow internal service communication (strictly requiring configured non-fallback key)
    const internalKey = request.headers['x-internal-service-key'];
    const expectedKey = process.env.INTERNAL_SERVICE_KEY;
    if (
      expectedKey &&
      internalKey &&
      typeof internalKey === 'string' &&
      internalKey.length === expectedKey.length &&
      crypto.timingSafeEqual(Buffer.from(internalKey), Buffer.from(expectedKey))
    ) {
      request.userId = 'internal-service';
      request.role = ['ADMIN'];
      request.user = { id: 'internal-service', userId: 'internal-service', email: 'internal@urbanfleet.local', role: 'ADMIN', roles: ['ADMIN'] };
      return next();
    }

    // 1. Extract Token from Authorization header or cookie
    const token =
      request.headers.authorization?.replace(/^Bearer\s+/i, '') ||
      request.cookies?.accessToken ||
      (request as any).cookies?.token;

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
    } catch (error: any) {
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
    if ((decodedData as any).tokenType && (decodedData as any).tokenType !== 'ACCESS') {
      throw new AppError('Invalid token type. Access token required.', 401, 'INVALID_TOKEN_TYPE');
    }

    const userId = decodedData.userId || decodedData.id;
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
          const parsed = JSON.parse(storedSession);
          if (parsed.userId && parsed.userId !== userId) {
            throw new AppError('Session mismatch. Please sign in again.', 401, 'SESSION_MISMATCH');
          }
        }
      } catch (e: any) {
        if (e instanceof AppError) throw e;
      }
    }

    // 4. Fetch User Data (Cache first)
    let user: any = null;
    if (rideRedisClient.isOpen) {
      try {
        const userStr =
          (await rideRedisClient.get(`auth:user:${userId}`)) ||
          (await rideRedisClient.get(`user:${userId}`));
        if (userStr) {
          user = JSON.parse(userStr);
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
    request.userId = userId;
    request.role = Array.isArray(user.roles) ? user.roles : [user.role || 'RIDER'];
    request.driverId = user.driver?.id || user.driverId;
    const firstName = user.firstName || 'User';
    const lastName = user.lastName || '';

    request.user = {
      userId,
      id: userId,
      email: user.email,
      role: user.role,
      roles: request.role,
      firstName,
      lastName,
      driverId: request.driverId,
    };

    next();
  }
);

export const requireRole = (...allowedRoles: string[]) => {
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
