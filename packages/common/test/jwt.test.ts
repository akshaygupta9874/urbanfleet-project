import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { createAuthMiddleware } from '../src/middlewares/jwt-auth.middleware.js';

describe('RS256 Asymmetric JWT Verification Middleware', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  const publicKeyBase64 = Buffer.from(publicKey).toString('base64');
  const authMiddleware = createAuthMiddleware(publicKeyBase64);

  it('should authenticate a valid RS256 token with pinned issuer and audience', () => {
    const token = jwt.sign(
      { userId: 'u-1', email: 'test@example.com', role: 'RIDER' },
      privateKey,
      { algorithm: 'RS256', expiresIn: '15m', issuer: 'urbanfleet-auth', audience: 'urbanfleet-api' }
    );

    const req: any = { headers: { authorization: `Bearer ${token}` } };
    let nextCalled = false;
    let nextError: any = null;

    authMiddleware(req, {}, (err) => {
      nextCalled = true;
      nextError = err;
    });

    expect(nextCalled).toBe(true);
    expect(nextError).toBeUndefined();
    expect(req.user.userId).toBe('u-1');
    expect(req.user.role).toBe('RIDER');
  });

  it('should reject a token with incorrect issuer or audience', () => {
    const token = jwt.sign(
      { userId: 'u-1', role: 'RIDER' },
      privateKey,
      { algorithm: 'RS256', expiresIn: '15m', issuer: 'rogue-issuer', audience: 'urbanfleet-api' }
    );

    const req: any = { headers: { authorization: `Bearer ${token}` } };
    let capturedErr: any = null;

    authMiddleware(req, {}, (err) => {
      capturedErr = err;
    });

    expect(capturedErr).toBeDefined();
    expect(capturedErr.statusCode).toBe(401);
  });

  it('should reject an expired token', () => {
    const token = jwt.sign(
      { userId: 'u-1', role: 'RIDER' },
      privateKey,
      { algorithm: 'RS256', expiresIn: '-1s', issuer: 'urbanfleet-auth', audience: 'urbanfleet-api' }
    );

    const req: any = { headers: { authorization: `Bearer ${token}` } };
    let capturedErr: any = null;

    authMiddleware(req, {}, (err) => {
      capturedErr = err;
    });

    expect(capturedErr).toBeDefined();
    expect(capturedErr.code).toBe('TOKEN_EXPIRED');
  });
});
