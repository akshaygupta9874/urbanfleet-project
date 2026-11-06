import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../src/middlewares/auth.middleware.js';
import { signAccessToken, signRefreshToken } from '../src/crypto/keys.js';
import { authRedisClient } from '../src/redis/client.js';

describe('RS256 Asymmetric JWT Verification in authMiddleware', () => {
  beforeEach(() => {
    vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(true);
    vi.spyOn(authRedisClient, 'get').mockImplementation(async (key: string) => {
      if (key.includes('session:')) {
        return JSON.stringify({ userId: 'u-1' });
      }
      if (key.includes('user:')) {
        return JSON.stringify({
          id: 'u-1',
          email: 'test@example.com',
          roles: ['RIDER'],
          firstName: 'Test',
          lastName: 'User',
        });
      }
      return null;
    });
    vi.spyOn(authRedisClient, 'sMembers').mockResolvedValue(['sess-jwt-1'] as any);
  });

  it('should authenticate a valid RS256 token with pinned issuer, audience, and sessionId', async () => {
    const token = signAccessToken({
      userId: 'u-1',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      roles: ['RIDER'],
      sessionId: 'sess-jwt-1',
    });

    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    let nextCalled = false;
    let nextErr: any;

    await authMiddleware(req, res, ((err: any) => {
      nextCalled = true;
      nextErr = err;
    }) as any);

    if (nextErr) console.error('AUTH_MIDDLEWARE_ERR:', nextErr);
    expect(nextErr).toBeUndefined();

    expect(nextCalled).toBe(true);
    expect(req.user.userId).toBe('u-1');
    expect(req.user.roles).toContain('RIDER');
  });

  it('should reject a token with incorrect issuer or audience', async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const rogueToken = jwt.sign(
      { userId: 'u-1', role: 'RIDER' },
      privateKey,
      { algorithm: 'RS256', expiresIn: '15m', issuer: 'rogue-issuer', audience: 'urbanfleet-api' }
    );

    const req: any = { headers: { authorization: `Bearer ${rogueToken}` } };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    let nextCalled = false;
    let nextErr: any;

    await authMiddleware(req, res, ((err: any) => {
      nextCalled = true;
      nextErr = err;
    }) as any);

    if (nextErr) console.error('AUTH_MIDDLEWARE_ERR:', nextErr);
    expect(nextErr).toBeUndefined();

    expect(nextCalled).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: 'INVALID_TOKEN',
      })
    );
  });

  it('should reject an expired RS256 token with TOKEN_EXPIRED code', async () => {
    const privateKey = Buffer.from(process.env.JWT_PRIVATE_KEY_BASE64!, 'base64').toString('utf-8');
    const expiredToken = jwt.sign(
      { userId: 'u-1', role: 'RIDER', tokenType: 'ACCESS' },
      privateKey,
      { algorithm: 'RS256', expiresIn: '-1s', issuer: 'urbanfleet-auth', audience: 'urbanfleet-api' }
    );

    const req: any = { headers: { authorization: `Bearer ${expiredToken}` } };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    let nextCalled = false;
    let nextErr: any;

    await authMiddleware(req, res, ((err: any) => {
      nextCalled = true;
      nextErr = err;
    }) as any);

    if (nextErr) console.error('AUTH_MIDDLEWARE_ERR:', nextErr);
    expect(nextErr).toBeUndefined();

    expect(nextCalled).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: 'TOKEN_EXPIRED',
      })
    );
  });

  it('should require sessionId as compulsory when signing access token', () => {
    expect(() =>
      signAccessToken({
        userId: 'u-test',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        roles: ['RIDER'],
        sessionId: '',
      } as any)
    ).toThrow(/sessionId is compulsory/);
  });

  it('should require sessionId as compulsory when signing refresh token', () => {
    expect(() =>
      signRefreshToken({
        userId: 'u-test',
        sessionId: '',
        sessionVersion: 1,
      } as any)
    ).toThrow(/sessionId is compulsory/);
  });

  it('should require sessionVersion as compulsory when signing refresh token', () => {
    expect(() =>
      signRefreshToken({
        userId: 'u-test',
        sessionId: 'sess-1',
      } as any)
    ).toThrow(/sessionVersion is compulsory/);
  });
});
