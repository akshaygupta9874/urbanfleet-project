import { NextFunction, Request, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import crypto from 'crypto';
import { AppError } from '@urbanfleet/common';
import asyncHandler from './asyncHandler.js';

export interface UserContext {
  id: string;
  userId: string;
  email?: string;
  role?: string | string[];
  roles?: string[];
}

export interface AuthenticatedRequest extends Request {
  userId?: string;
  role?: string[];
  user?: UserContext;
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
    if (request.userId && request.user) {
      return next();
    }

    // Allow internal service communication (strictly requiring configured key)
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

    const cookies = (request as Request).cookies as Record<string, string | undefined> | undefined;
    const token =
      request.headers.authorization?.replace(/^Bearer\s+/i, '') ||
      cookies?.accessToken ||
      cookies?.token;

    if (!token) {
      throw new AppError('You are not authorized to access this resource.', 401, 'UNAUTHORIZED');
    }

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
        if (process.env.NODE_ENV === 'production') {
          throw new AppError('CRITICAL: Missing JWT_PUBLIC_KEY_BASE64 in production!', 500, 'AUTH_CONFIG_ERROR');
        }
        const secret = process.env.JWT_ACCESS_SECRET || 'test-access-secret-only';
        decodedData = jwt.verify(token, secret) as AuthPayload;
      }
    } catch (_error: unknown) {
      const secret = process.env.JWT_ACCESS_SECRET;
      if (secret) {
        try {
          decodedData = jwt.verify(token, secret) as AuthPayload;
        } catch (_) {
          throw new AppError('Your token is invalid or expired.', 401, 'TOKEN_EXPIRED');
        }
      } else {
        throw new AppError('Your token is invalid or expired.', 401, 'TOKEN_EXPIRED');
      }
    }

    const userId = decodedData.userId;
    if (!userId) {
      throw new AppError('Your session is invalid. Please sign in again.', 401, 'INVALID_SESSION');
    }

    request.userId = userId;
    request.role = Array.isArray(decodedData.roles) ? decodedData.roles : [decodedData.role as string || 'RIDER'];
    request.user = {
      userId,
      id: userId,
      email: decodedData.email,
      role: decodedData.role,
      roles: request.role,
    };

    next();
  }
);

export const requireRole = (...allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    if (!req.userId && !req.user) {
      return next(new AppError('User unauthenticated', 401, 'UNAUTHORIZED'));
    }
    const roles: string[] = req.role || (req.user?.roles ? req.user.roles : []);
    const hasRole = roles.some((r) => allowedRoles.includes(r));
    if (!hasRole) {
      return next(
        new AppError(`Forbidden: Requires one of roles: ${allowedRoles.join(', ')}`, 403, 'FORBIDDEN')
      );
    }
    next();
  };
};

export default authMiddleware;
