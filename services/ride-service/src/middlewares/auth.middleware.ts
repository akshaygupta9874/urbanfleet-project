import { NextFunction, Request, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
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
      } else {
        const secret = process.env.JWT_ACCESS_SECRET || 'test-access-secret-only';
        decodedData = jwt.verify(token, secret) as AuthPayload;
      }
    } catch (error: any) {
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

    const userId = decodedData.userId || decodedData.id;
    const sessionId = decodedData.sessionId;

    if (!userId) {
      throw new AppError('Your session is invalid. Please sign in again.', 401, 'INVALID_SESSION');
    }

    // 3. Validate Session (Concurrent Redis checks)
    if (sessionId && rideRedisClient.isOpen) {
      try {
        const [storedSession] = await Promise.all([
          rideRedisClient.get(`auth:session:${sessionId}`) || rideRedisClient.get(`session:${sessionId}`),
        ]);

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
    request.user = {
      userId,
      id: userId,
      email: user.email,
      role: user.role,
      roles: request.role,
      fullName: user.fullName,
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
