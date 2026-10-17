import jwt from 'jsonwebtoken';
import { UnauthorizedError, ForbiddenError } from '@urbanfleet/common';
import { getPublicKey } from '../crypto/keys.js';

export interface AuthenticatedUserPayload {
  userId: string;
  email: string;
  role: 'RIDER' | 'DRIVER' | 'ADMIN';
  sessionId?: string;
  iss?: string;
  aud?: string;
}

export interface AuthRequestLike {
  headers: {
    authorization?: string;
    [key: string]: any;
  };
  user?: AuthenticatedUserPayload;
}

/**
 * Validates RS256 JWT using injected Public Key or auth-service runtime key.
 * Enforces algorithm pinning, issuer, and audience.
 */
export function createAuthMiddleware(publicKeyBase64?: string) {
  let publicKeyPem: string;
  if (publicKeyBase64) {
    publicKeyPem = Buffer.from(publicKeyBase64, 'base64').toString('utf-8');
  } else if (process.env.JWT_PUBLIC_KEY_BASE64) {
    publicKeyPem = Buffer.from(process.env.JWT_PUBLIC_KEY_BASE64, 'base64').toString('utf-8');
  } else {
    publicKeyPem = getPublicKey();
  }

  return (req: AuthRequestLike, _res: any, next: (err?: any) => void) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(new UnauthorizedError('Missing or malformed Authorization header'));
    }

    const token = authHeader.substring(7);

    try {
      const decoded = jwt.verify(token, publicKeyPem, {
        algorithms: ['RS256'], // Explicit pinning to prevent HMAC downgrade attacks
        issuer: 'urbanfleet-auth',
        audience: 'urbanfleet-api',
      }) as AuthenticatedUserPayload;

      if ((decoded as any).tokenType && (decoded as any).tokenType !== 'ACCESS') {
        return next(new UnauthorizedError('Invalid token type. Access token required.', 'INVALID_TOKEN_TYPE'));
      }

      req.user = decoded;
      next();
    } catch (err: any) {
      if (err.name === 'TokenExpiredError') {
        return next(new UnauthorizedError('Token has expired', 'TOKEN_EXPIRED'));
      }
      return next(new UnauthorizedError('Invalid token signature or payload', 'INVALID_TOKEN'));
    }
  };
}

export function requireRole(...allowedRoles: string[]) {
  return (req: AuthRequestLike, _res: any, next: (err?: any) => void) => {
    if (!req.user) {
      return next(new UnauthorizedError('User unauthenticated'));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(new ForbiddenError(`Forbidden: Requires one of roles: ${allowedRoles.join(', ')}`));
    }
    next();
  };
}
