import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../src/middlewares/auth.middleware.js';
import { authClient } from '../src/clients/auth.client.js';
import { redisClient } from '../src/redis/client.js';
import { AppError } from '../src/utils/AppError.js';
import { ServiceUnavailableError } from '@urbanfleet/common';

describe('Payment Service Auth Middleware Fail-Closed Session Validation', () => {
  const privateKey = Buffer.from(process.env.JWT_PRIVATE_KEY_BASE64!, 'base64').toString('utf-8');

  function createValidToken(payload: Record<string, unknown> = {}) {
    return jwt.sign(
      {
        userId: 'usr-pay-test-1',
        sessionId: 'sess-test-1',
        email: 'payer@urbanfleet.com',
        roles: ['RIDER'],
        ...payload,
      },
      privateKey,
      {
        algorithm: 'RS256',
        expiresIn: '15m',
        issuer: 'urbanfleet-auth',
        audience: 'urbanfleet-api',
      }
    );
  }

  function mockValidRedisSession(userId = 'usr-pay-test-1', sessionId = 'sess-test-1') {
    vi.spyOn(redisClient, 'isOpen', 'get').mockReturnValue(true);
    vi.spyOn(redisClient, 'get').mockImplementation(async (key: string) => {
      if (key === `auth:session:${sessionId}` || key === `session:${sessionId}`) {
        return JSON.stringify({ userId, sessionId, createdAt: new Date().toISOString() });
      }
      return null;
    });
    vi.spyOn(redisClient, 'sMembers').mockImplementation(async (key: string) => {
      if (key === `auth:user-sessions:${userId}` || key === `user-sessions:${userId}`) {
        return [sessionId];
      }
      return [];
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects with 401 UNAUTHORIZED when Authorization header is missing', async () => {
    const req: any = { headers: {} };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('fails with 503 ServiceUnavailableError when Redis is unavailable during session validation (fail-closed)', async () => {
    vi.spyOn(redisClient, 'isOpen', 'get').mockReturnValue(false);

    const token = createValidToken();
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(ServiceUnavailableError));
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(503);
    expect(err.code).toBe('SESSION_VALIDATION_UNAVAILABLE');
    expect(req.user).toBeUndefined();
  });

  it('fails with 503 ServiceUnavailableError when Redis throws an infrastructure error (fail-closed)', async () => {
    vi.spyOn(redisClient, 'isOpen', 'get').mockReturnValue(true);
    vi.spyOn(redisClient, 'get').mockRejectedValue(new Error('ECONNRESET'));

    const token = createValidToken();
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(ServiceUnavailableError));
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(503);
    expect(err.code).toBe('SESSION_VALIDATION_UNAVAILABLE');
    expect(req.user).toBeUndefined();
  });

  it('rejects with 401 SESSION_EXPIRED when session does not exist in Redis (revoked session)', async () => {
    vi.spyOn(redisClient, 'isOpen', 'get').mockReturnValue(true);
    vi.spyOn(redisClient, 'get').mockResolvedValue(null);
    vi.spyOn(redisClient, 'sMembers').mockResolvedValue(['sess-test-1']);

    const token = createValidToken();
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('SESSION_EXPIRED');
    expect(req.user).toBeUndefined();
  });

  it('rejects with 401 SESSION_EXPIRED when sessionId is not in active user-sessions set', async () => {
    vi.spyOn(redisClient, 'isOpen', 'get').mockReturnValue(true);
    vi.spyOn(redisClient, 'get').mockResolvedValue(JSON.stringify({ userId: 'usr-pay-test-1', sessionId: 'sess-test-1' }));
    vi.spyOn(redisClient, 'sMembers').mockResolvedValue(['other-session-id']);

    const token = createValidToken();
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('SESSION_EXPIRED');
    expect(req.user).toBeUndefined();
  });

  it('rejects with 401 SESSION_MISMATCH when session userId does not match token', async () => {
    vi.spyOn(redisClient, 'isOpen', 'get').mockReturnValue(true);
    vi.spyOn(redisClient, 'get').mockResolvedValue(JSON.stringify({ userId: 'mismatched-user', sessionId: 'sess-test-1' }));
    vi.spyOn(redisClient, 'sMembers').mockResolvedValue(['sess-test-1']);

    const token = createValidToken();
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('SESSION_MISMATCH');
    expect(req.user).toBeUndefined();
  });

  it('authenticates and attaches user when session is valid and user is fetched via authClient', async () => {
    mockValidRedisSession();
    const token = createValidToken();
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    vi.spyOn(authClient, 'getUserById').mockResolvedValue({
      id: 'usr-pay-test-1',
      email: 'payer@urbanfleet.com',
      firstName: 'Payer',
      lastName: 'User',
      roles: ['RIDER'],
    } as any);

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.userId).toBe('usr-pay-test-1');
    expect(req.user).toMatchObject({
      userId: 'usr-pay-test-1',
      email: 'payer@urbanfleet.com',
    });
  });
});
