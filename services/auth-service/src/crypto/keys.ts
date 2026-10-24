import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createLogger } from '@urbanfleet/common';

const logger = createLogger('auth-crypto');

let privateKey: string;
let publicKey: string;

export function initAsymmetricKeys(): { privateKey: string; publicKey: string } {
  const privEnv = process.env.JWT_PRIVATE_KEY_BASE64;
  const pubEnv = process.env.JWT_PUBLIC_KEY_BASE64;

  if (privEnv && pubEnv) {
    privateKey = Buffer.from(privEnv, 'base64').toString('utf-8');
    publicKey = Buffer.from(pubEnv, 'base64').toString('utf-8');
    logger.info('Loaded RS256 keypair from runtime environment secrets.');
  } else {
    logger.error('CRITICAL: Missing JWT_PRIVATE_KEY_BASE64 or JWT_PUBLIC_KEY_BASE64! Failing fast.');
    throw new Error('Production deployment requires JWT_PRIVATE_KEY_BASE64 and JWT_PUBLIC_KEY_BASE64 environment variables.');
  }

  return { privateKey, publicKey };
}

export interface AccessTokenPayloadInput {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  driverId?: string;
  sessionId?: string;
  tokenType?: string;
  role?: string;
}

export function signAccessToken(payload: AccessTokenPayloadInput): string {
  if (!privateKey) initAsymmetricKeys();

  const roles = payload.roles && payload.roles.length > 0 ? payload.roles : ['RIDER'];
  const role = payload.role || roles[0] || 'RIDER';
  return jwt.sign({ ...payload, role, roles, tokenType: 'ACCESS' }, privateKey, {
    algorithm: 'RS256',
    expiresIn: '15m',
    issuer: 'urbanfleet-auth',
    audience: 'urbanfleet-api'
  });
}

export function signRefreshToken(payload: { userId: string; sessionId: string; sessionVersion?: number; tokenType?: string }): string {
  if (!privateKey) initAsymmetricKeys();

  const sessionVersion = payload.sessionVersion ?? 1;
  return jwt.sign({ ...payload, sessionVersion, tokenType: 'REFRESH' }, privateKey, {
    algorithm: 'RS256',
    expiresIn: '7d',
    issuer: 'urbanfleet-auth',
    audience: 'urbanfleet-api'
  });
}

export function getPublicKey(): string {
  if (!publicKey) initAsymmetricKeys();
  return publicKey;
}

export interface AuthTokenPayload extends jwt.JwtPayload {
  userId?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  roles?: string[];
  driverId?: string;
  sessionId?: string;
  sessionVersion?: number;
  tokenType?: string;
}

export function verifyToken(token: string): AuthTokenPayload {
  if (!publicKey) initAsymmetricKeys();
  return jwt.verify(token, publicKey, {
    algorithms: ['RS256'],
    issuer: 'urbanfleet-auth',
    audience: 'urbanfleet-api'
  }) as AuthTokenPayload;
}
