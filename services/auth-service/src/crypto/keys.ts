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
  sessionId: string;
  sessionVersion?: number;
  driverId?: string;
  tokenType?: string;
}

export function signAccessToken(payload: AccessTokenPayloadInput): string {
  if (!privateKey) initAsymmetricKeys();

  if (!payload.sessionId || typeof payload.sessionId !== 'string' || payload.sessionId.trim() === '') {
    throw new Error('sessionId is compulsory when signing an access token');
  }

  const roles = payload.roles && payload.roles.length > 0 ? payload.roles : ['RIDER'];
  return jwt.sign({ ...payload, roles, tokenType: 'ACCESS' }, privateKey, {
    algorithm: 'RS256',
    expiresIn: '15m',
    issuer: 'urbanfleet-auth',
    audience: 'urbanfleet-api'
  });
}

export interface RefreshTokenPayloadInput {
  userId: string;
  sessionId: string;
  sessionVersion: number;
  tokenType?: string;
}

export function signRefreshToken(payload: RefreshTokenPayloadInput): string {
  if (!privateKey) initAsymmetricKeys();

  if (!payload.sessionId || typeof payload.sessionId !== 'string' || payload.sessionId.trim() === '') {
    throw new Error('sessionId is compulsory when signing a refresh token');
  }

  if (typeof payload.sessionVersion !== 'number' || Number.isNaN(payload.sessionVersion)) {
    throw new Error('sessionVersion is compulsory when signing a refresh token');
  }

  return jwt.sign(
    {
      userId: payload.userId,
      sessionId: payload.sessionId,
      sessionVersion: payload.sessionVersion,
      tokenType: 'REFRESH',
    },
    privateKey,
    {
      algorithm: 'RS256',
      expiresIn: '7d',
      issuer: 'urbanfleet-auth',
      audience: 'urbanfleet-api',
    }
  );
}

export function getPublicKey(): string {
  if (!publicKey) initAsymmetricKeys();
  return publicKey;
}

export interface AuthTokenPayload extends jwt.JwtPayload {
  userId: string;
  sessionId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  roles?: string[];
  driverId?: string;
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
