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

export function signAccessToken(payload: { userId: string; email: string; role: string; sessionId?: string }): string {
  if (!privateKey) initAsymmetricKeys();

  return jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    expiresIn: '15m',
    issuer: 'urbanfleet-auth',
    audience: 'urbanfleet-api'
  });
}

export function signRefreshToken(payload: { userId: string; sessionId: string }): string {
  if (!privateKey) initAsymmetricKeys();

  return jwt.sign(payload, privateKey, {
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
