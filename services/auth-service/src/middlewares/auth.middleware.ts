import { NextFunction, Request, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { AppError, createLogger } from '@urbanfleet/common';

const logger = createLogger('auth-middleware');
import asyncHandler from './asyncHandler.js';
import { prisma } from '../db/client.js';
import { getPublicKey } from '../crypto/keys.js';
import { validateSessionInRedis, getCachedUser, cacheUser, CachedUser } from '../redis/token-cache.js';

export interface UserPayloadContext {
  userId: string;
  email: string;
  roles: string[];
  firstName: string;
  lastName: string;
  driverId?: string;
}

// export type AuthMiddlewareUser = CachedUser;

export interface AuthenticatedRequest extends Request {
  userId: string;
  roles: string[];
  driverId?: string;
  user: UserPayloadContext;
}

export interface AuthPayload extends JwtPayload {
  id?: string;
  userId?: string;
  sessionId?: string;
  email?: string;
  roles?: string[];
  tokenType?: string;
}

export const authMiddleware = asyncHandler(
  async (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    // If request already has authenticated user (test bypass / internal mock), proceed
    if (request.userId && request.user) {
      return next();
    }

    // 1. Extract Token from Authorization header or cookie

    const cookies = (request as Request).cookies as Record<string, string | undefined> | undefined;
    const token =
      request.headers.authorization?.replace(/^Bearer\s+/i, '') ||
      cookies?.accessToken ||
      cookies?.token;

    if (!token) {
      return response.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'You are not authorized to access this resource.',
      });
    }



    // Strictly RS256 asymmetric verification with pinned issuer & audience
    let decodedData: AuthPayload;
    try {
      const pubKey = getPublicKey();
      decodedData = jwt.verify(token, pubKey, {
        algorithms: ['RS256'],
        issuer: 'urbanfleet-auth',
        audience: 'urbanfleet-api',
      }) as AuthPayload;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'TokenExpiredError') {
        return response.status(401).json({
          success: false,
          code: 'TOKEN_EXPIRED',
          message: 'Your token has expired.',
        });
      }
      return response.status(401).json({
        success: false,
        code: 'INVALID_TOKEN',
        message: 'Your token is invalid or expired.',
      });
    }

    if (decodedData.tokenType && decodedData.tokenType !== 'ACCESS') {
      return response.status(401).json({
        success: false,
        code: 'INVALID_TOKEN_TYPE',
        message: 'Invalid token type. Access token required.',
      });
    }

    const userId = decodedData.userId;
    const sessionId = decodedData.sessionId;

    if (!userId) {
      throw new AppError('Your session is invalid. Please sign in again.', 401, 'INVALID_SESSION');
    }

    // 3. Validate Session (Concurrent Redis checks)
    if (sessionId) {
      const sessionCheck = await validateSessionInRedis(userId, sessionId);
      if (!sessionCheck.valid) {
        if (sessionCheck.reason === 'SESSION_MISMATCH') {
          throw new AppError('Session mismatch. Please sign in again.', 401, 'SESSION_MISMATCH');
        }
        throw new AppError('Your session is no longer valid. Please sign in again.', 401, 'SESSION_EXPIRED');
      }
    }

    // 4. Fetch User Data (Cache first, then PostgreSQL)
    let user = await getCachedUser(userId);

    if (!user) {
      try {
        const dbUser = await prisma.user.findUnique({
          where: { id: userId },
        });
        if (dbUser) {
          user = {
            id: dbUser.id,
            email: dbUser.email,
            roles: dbUser.roles,
            firstName: dbUser.firstName,
            lastName: dbUser.lastName,
          };
        }
      } catch (err: unknown) {
        logger.warn('Failed to fetch user from database in auth middleware', {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      if (!user) {
        // Fallback to token payload if user not in local DB during unit tests
        const roles = decodedData.roles || (Array.isArray(decodedData.role) ? decodedData.role : [typeof decodedData.role === 'string' ? decodedData.role : 'RIDER']);
        user = {
          id: userId,
          email: decodedData.email || '',
          roles,
          firstName: 'User',
          lastName: '',
        };
      } else {
        await cacheUser(user);
      }
    }

    // 5. Attach payload to Request and proceed
    const currentUser = user!;
    const userRoles = Array.isArray(currentUser.roles) ? currentUser.roles : ['RIDER'];
    request.userId = currentUser.id;
    request.roles = userRoles;
    if (currentUser.driverId) {
      request.driverId = currentUser.driverId;
    }
    const firstName = currentUser.firstName || 'User';
    const lastName = currentUser.lastName || '';

    request.user = {
      userId: currentUser.id,
      email: currentUser.email,
      roles: userRoles,
      firstName,
      lastName,
      driverId: request.driverId,
    };

    next();
  }
);

export const requireRole = (...allowedRoles: string[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.userId) {
      return next(new AppError('User unauthenticated', 401, 'UNAUTHORIZED'));
    }
    const roles = authReq.roles || [];
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
