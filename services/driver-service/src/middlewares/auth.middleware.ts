import { NextFunction, Request, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { AppError, ServiceUnavailableError, createLogger } from '@urbanfleet/common';
import asyncHandler from './asyncHandler.js';
import { driverRedisClient } from '../redis/client.js';
import { authClient } from '../clients/auth.client.js';
import { prisma } from '../db/client.js';

const logger = createLogger('driver-auth-middleware');

export interface DriverUserContext {
  userId: string;
  email: string;
  roles: string[];
  firstName: string;
  lastName: string;
  driverId?: string;
}

export interface DriverUserRecord {
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
  driverId?: string;
  user?: DriverUserContext;
}

export interface AuthPayload extends JwtPayload {
  id?: string;
  userId?: string;
  sessionId?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  roles?: string[];
}

export const authMiddleware = asyncHandler(
  async (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    // If request already has authenticated user (test bypass / mock), proceed
    if (request.userId && request.user) {
      return next();
    }

    // 1. Extract Token from Authorization header
    const token =
      request.headers.authorization?.replace(/^Bearer\s+/i, '');

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

    // 3. Validate Session (Concurrent Redis checks)
    if (sessionId && driverRedisClient.isOpen) {
      try {
        const [storedSession, activeSessionIds] = await Promise.all([
          driverRedisClient.get(`auth:session:${sessionId}`),
          driverRedisClient.sMembers(`auth:user-sessions:${userId}`),
        ]);

        if (storedSession) {
          const parsed = JSON.parse(storedSession) as { userId : string };
          if (parsed.userId && parsed.userId !== decodedData.userId) {
            throw new AppError('Session mismatch. Please sign in again.', 401, 'SESSION_MISMATCH');
          }
        }
      } catch (e: unknown) {
        if (e instanceof AppError) throw e;
        logger.warn('Failed to validate session in Redis:', { error: e instanceof Error ? e.message : String(e), sessionId });
      }
    }

    // 4. Fetch User Data (Cache first, then authClient / DB)
    let user: DriverUserRecord | null = null;
    if (driverRedisClient.isOpen) {
      try {
        const userStr =
          (await driverRedisClient.get(`auth:user:${userId}`));
        if (userStr) {
          user = JSON.parse(userStr) as DriverUserRecord;
        }
      } catch (err: unknown) {
        logger.warn('Failed to read user from Redis:', { error: err instanceof Error ? err.message : String(err), userId });
      }
    }

    if (!user) {
      try {
        user = (await authClient.getUserById(userId)) as DriverUserRecord | null;
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

    if (driverRedisClient.isOpen) {
      try {
        await driverRedisClient.setEx(`auth:user:${userId}`, 15 * 60, JSON.stringify(activeUser));
      } catch (err: unknown) {
        logger.warn('Failed to cache user in Redis:', { error: err instanceof Error ? err.message : String(err), userId });
      }
    }

    // 5. Look up driver profile ID if present
    let driverId = activeUser.driverId;
    if (!driverId) {
      try {
        const profile = await prisma.driverProfile.findUnique({
          where: { userId },
          select: { id: true },
        });
        if (profile) {
          driverId = profile.id;
        }
      } catch (err: unknown) {
        logger.warn('Failed to find driver profile in database:', { error: err instanceof Error ? err.message : String(err), userId });
      }
    }

    // Attach to Request
    const userRoles = activeUser.roles;
    request.userId = userId;
    request.roles = userRoles;
    request.driverId = driverId;
    request.user = {
      userId,
      email: activeUser.email || '',
      roles: userRoles,
      firstName: activeUser.firstName || 'Driver',
      lastName: activeUser.lastName || '',
      driverId,
    };

    next();
  }
);

export const requireRole = (...allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    if (!req.userId) {
      return next(new AppError('User unauthenticated', 401, 'UNAUTHORIZED'));
    }
    const roles: string[] = req.roles ?? [];
    const hasRole = roles.some((r) => allowedRoles.includes(r));
    if (!hasRole) {
      return next(
        new AppError(`Forbidden: Requires one of roles: ${allowedRoles.join(', ')}`, 403, 'FORBIDDEN')
      );
    }
    next();
  };
};

export const requireDriver = requireRole('DRIVER');
export default authMiddleware;
