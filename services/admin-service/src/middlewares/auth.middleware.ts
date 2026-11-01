import { type Request, type Response, type NextFunction } from 'express';
import { verifyAdminToken, type AccessPayload } from '../auth.js';
import { config } from '../config/config.js';
import { adminRedisClient } from '../redis/client.js';

export interface AdminRequest extends Request {
  adminUserId?: string;
  bearer?: string;
  roles?: string[];
}

export async function requireAdmin(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!token) {
    res.status(401).json({
      success: false,
      message: 'Administrator authentication required: Bearer token missing',
    });
    return;
  }

  if (!config.jwtPublicKeyBase64) {
    res.status(500).json({
      success: false,
      message: 'JWT public key is not configured on admin service',
    });
    return;
  }

  let payload: AccessPayload;
  try {
    payload = verifyAdminToken(token, config.jwtPublicKeyBase64);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid administrator token';
    res.status(401).json({
      success: false,
      message,
    });
    return;
  }

  // Fail-closed Session & Suspension Check when Redis is available
  if (adminRedisClient && adminRedisClient.isOpen) {
    try {
      const sessionId = payload.sessionId;
      const userId = payload.userId;

      // 1. If token has sessionId, verify session is active in Redis
      if (sessionId) {
        const stored = (await adminRedisClient.get(`auth:session:${sessionId}`)) || (await adminRedisClient.get(`session:${sessionId}`));
        if (!stored) {
          res.status(401).json({
            success: false,
            message: 'Admin session is expired or revoked. Please sign in again.',
          });
          return;
        }
      }

      // 2. Check if user account is suspended in Redis
      const cachedUser = (await adminRedisClient.get(`auth:user:${userId}`)) || (await adminRedisClient.get(`user:${userId}`));
      if (cachedUser) {
        try {
          const parsed = JSON.parse(cachedUser);
          if (parsed.isSuspended) {
            res.status(403).json({
              success: false,
              message: 'Administrator account has been suspended',
            });
            return;
          }
        } catch {
          // Ignore parse errors
        }
      }
    } catch (redisErr) {
      console.warn('[admin-auth] Error validating session in Redis:', redisErr);
    }
  }

  req.adminUserId = payload.userId;
  req.bearer = token;
  req.roles = payload.roles;
  next();
}
