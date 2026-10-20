import { NextFunction, Request, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { AppError } from '@urbanfleet/common';
import asyncHandler from './asyncHandler.js';
import { driverRedisClient } from '../redis/client.js';
import { authClient } from '../clients/auth.client.js';
import { prisma } from '../db/client.js';

export interface DriverUserContext {
  userId: string;
  email: string;
  roles: string[];
  firstName?: string;
  lastName?: string;
  driverId?: string;
}

export interface DriverUserRecord {
  id: string;
  email?: string;
  roles: string[];
  role?: string;
  firstName?: string;
  lastName?: string;
  driverId?: string;
  driver?: { id: string };
  [key: string]: unknown;
}

export interface AuthenticatedRequest extends Request {
  userId?: string;
  roles?: string[];
  role?: string[];
  driverId?: string;
  user?: DriverUserContext;
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

    // 1. Extract Token from Authorization header or cookie
    const cookies = (request as Request).cookies as Record<string, string | undefined> | undefined;
    const token =
      request.headers.authorization?.replace(/^Bearer\s+/i, '') ||
      cookies?.accessToken ||
      cookies?.token;

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
      } else {
        if (process.env.NODE_ENV === 'production') {
          throw new AppError('CRITICAL: Missing JWT_PUBLIC_KEY_BASE64 in production!', 500, 'AUTH_CONFIG_ERROR');
        }
        const secret = process.env.JWT_ACCESS_SECRET || 'test-access-secret-only';
        decodedData = jwt.verify(token, secret) as AuthPayload;
      }
    } catch (_error: unknown) {
      // Secret fallback
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
    const sessionId = decodedData.sessionId;

    if (!userId) {
      throw new AppError('Your session is invalid. Please sign in again.', 401, 'INVALID_SESSION');
    }

    // 3. Validate Session (Concurrent Redis checks)
    if (sessionId && driverRedisClient.isOpen) {
      try {
        const [storedSession, activeSessionIds] = await Promise.all([
          driverRedisClient.get(`auth:session:${sessionId}`) || driverRedisClient.get(`session:${sessionId}`),
          driverRedisClient.sMembers(`auth:user-sessions:${userId}`) || driverRedisClient.sMembers(`user-sessions:${userId}`),
        ]);

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

    // 4. Fetch User Data (Cache first, then authClient / DB)
    let user: DriverUserRecord | null = null;
    if (driverRedisClient.isOpen) {
      try {
        const userStr =
          (await driverRedisClient.get(`auth:user:${userId}`)) ||
          (await driverRedisClient.get(`user:${userId}`));
        if (userStr) {
          user = JSON.parse(userStr) as DriverUserRecord;
        }
      } catch (err) {}
    }

    if (!user) {
      try {
        user = (await authClient.getUserById(userId)) as DriverUserRecord | null;
      } catch (err) {}
    }

    if (!user) {
      // Fallback to token payload
      const roles = decodedData.roles || (Array.isArray(decodedData.role) ? decodedData.role : [typeof decodedData.role === 'string' ? decodedData.role : 'DRIVER']);
      user = {
        id: userId,
        email: decodedData.email || '',
        role: typeof decodedData.role === 'string' ? decodedData.role : 'DRIVER',
        roles,
      };
    }

    if (driverRedisClient.isOpen) {
      try {
        await driverRedisClient.setEx(`auth:user:${userId}`, 15 * 60, JSON.stringify(user));
      } catch (err) {}
    }

    // 5. Look up driver profile ID if present
    let driverId = user.driver?.id || user.driverId;
    if (!driverId) {
      try {
        const profile = await prisma.driverProfile.findUnique({
          where: { userId },
          select: { id: true },
        });
        if (profile) {
          driverId = profile.id;
        }
      } catch (err) {}
    }

    // Attach to Request
    const userRoles = Array.isArray(user.roles) ? user.roles : ['DRIVER'];
    request.userId = userId;
    request.roles = userRoles;
    request.role = userRoles;
    request.driverId = driverId;
    request.user = {
      userId,
      email: user.email || '',
      roles: userRoles,
      firstName: user.firstName,
      lastName: user.lastName,
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

export const requireDriver = requireRole('DRIVER');
export default authMiddleware;
