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
    if (process.env.NODE_ENV === 'production') {
      logger.error('CRITICAL: Missing JWT_PRIVATE_KEY_BASE64 or JWT_PUBLIC_KEY_BASE64 in production! Failing fast.');
      throw new Error('Production deployment requires JWT_PRIVATE_KEY_BASE64 and JWT_PUBLIC_KEY_BASE64 environment variables.');
    }
    logger.warn('No base64 RS256 keys found in environment. Generating ephemeral 2048-bit RS256 keypair for local dev...');
    const pair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
  }

  return { privateKey, publicKey };
}

export function signAccessToken(payload: {
  userId: string;
  email: string;
  role: string;
  roles?: string[];
  firstName?: string;
  lastName?: string;
  sessionId?: string;
  tokenType?: string;
}): string {
  if (!privateKey) initAsymmetricKeys();

  return jwt.sign({ ...payload, tokenType: 'ACCESS' }, privateKey, {
    algorithm: 'RS256',
    expiresIn: '15m',
    issuer: 'urbanfleet-auth',
    audience: 'urbanfleet-api'
  });
}

export function signRefreshToken(payload: { userId: string; sessionId: string; tokenType?: string }): string {
  if (!privateKey) initAsymmetricKeys();

  return jwt.sign({ ...payload, tokenType: 'REFRESH' }, privateKey, {
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

export function verifyToken(token: string): any {
  if (!publicKey) initAsymmetricKeys();
  return jwt.verify(token, publicKey, {
    algorithms: ['RS256'],
    issuer: 'urbanfleet-auth',
    audience: 'urbanfleet-api'
  });
}
