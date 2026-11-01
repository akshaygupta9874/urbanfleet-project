import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../src/middlewares/auth.middleware.js';
import { authClient } from '../src/clients/auth.client.js';
import { notificationRedisClient } from '../src/redis/client.js';
import { AppError, ServiceUnavailableError } from '@urbanfleet/common';

describe('Notification Service Auth Middleware Strict DB Verification & Fail-Closed Session Validation', () => {
  const privateKey = Buffer.from(process.env.JWT_PRIVATE_KEY_BASE64!, 'base64').toString('utf-8');

  function createValidToken(payload: Record<string, unknown> = {}) {
    return jwt.sign(
      {
        userId: 'usr-notif-test-1',
        sessionId: 'sess-test-1',
        email: 'user@urbanfleet.com',
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

  function mockValidRedisSession(userId = 'usr-notif-test-1', sessionId = 'sess-test-1') {
    vi.spyOn(notificationRedisClient, 'isOpen', 'get').mockReturnValue(true);
    vi.spyOn(notificationRedisClient, 'get').mockImplementation(async (key: string) => {
      if (key === `auth:session:${sessionId}` || key === `session:${sessionId}`) {
        return JSON.stringify({ userId, sessionId, createdAt: new Date().toISOString() });
      }
      return null;
    });
    vi.spyOn(notificationRedisClient, 'sMembers').mockImplementation(async (key: string) => {
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

  it('rejects with 401 TOKEN_EXPIRED when token is malformed or invalid', async () => {
    const req: any = { headers: { authorization: 'Bearer invalid.token.value' } };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('TOKEN_EXPIRED');
  });

  it('fails with 503 ServiceUnavailableError when Redis is unavailable during session validation (fail-closed)', async () => {
    vi.spyOn(notificationRedisClient, 'isOpen', 'get').mockReturnValue(false);

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
    vi.spyOn(notificationRedisClient, 'isOpen', 'get').mockReturnValue(true);
    vi.spyOn(notificationRedisClient, 'get').mockRejectedValue(new Error('ECONNRESET'));

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
    vi.spyOn(notificationRedisClient, 'isOpen', 'get').mockReturnValue(true);
    vi.spyOn(notificationRedisClient, 'get').mockResolvedValue(null);
    vi.spyOn(notificationRedisClient, 'sMembers').mockResolvedValue(['sess-test-1']);

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
    vi.spyOn(notificationRedisClient, 'isOpen', 'get').mockReturnValue(true);
    vi.spyOn(notificationRedisClient, 'get').mockResolvedValue(JSON.stringify({ userId: 'usr-notif-test-1', sessionId: 'sess-test-1' }));
    vi.spyOn(notificationRedisClient, 'sMembers').mockResolvedValue(['other-session-id']);

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
    vi.spyOn(notificationRedisClient, 'isOpen', 'get').mockReturnValue(true);
    vi.spyOn(notificationRedisClient, 'get').mockResolvedValue(JSON.stringify({ userId: 'mismatched-user', sessionId: 'sess-test-1' }));
    vi.spyOn(notificationRedisClient, 'sMembers').mockResolvedValue(['sess-test-1']);

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

  it('HALTS AND REJECTS with 401 USER_NOT_FOUND when user is not found in database / AuthClient', async () => {
    mockValidRedisSession();
    const token = createValidToken();
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    // AuthClient returns null (user not found in DB / 404 from Auth service)
    vi.spyOn(authClient, 'getUserById').mockResolvedValue(null);

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('USER_NOT_FOUND');
    expect(err.message).toBe('User account not found or has been deactivated');
    expect(req.user).toBeUndefined();
  });

  it('fails with 503 ServiceUnavailableError when AuthClient encounters a connection/infrastructure error', async () => {
    mockValidRedisSession();
    const token = createValidToken();
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    vi.spyOn(authClient, 'getUserById').mockRejectedValue(new Error('Connection ECONNREFUSED'));

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(ServiceUnavailableError));
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(503);
    expect(err.code).toBe('AUTH_SERVICE_UNAVAILABLE');
    expect(req.user).toBeUndefined();
  });

  it('authenticates and attaches user when user exists in database / AuthClient', async () => {
    mockValidRedisSession();
    const token = createValidToken();
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    vi.spyOn(authClient, 'getUserById').mockResolvedValue({
      id: 'usr-notif-test-1',
      email: 'user@urbanfleet.com',
      firstName: 'Bob',
      lastName: 'Smith',
      role: 'RIDER',
      isEmailVerified: true,
    } as any);

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.userId).toBe('usr-notif-test-1');
    expect(req.roles).toEqual(['RIDER']);
    expect(req.user).toMatchObject({
      userId: 'usr-notif-test-1',
      email: 'user@urbanfleet.com',
      firstName: 'Bob',
      lastName: 'Smith',
      roles: ['RIDER'],
    });
  });

  it('uses cached user from Redis when present without calling AuthClient', async () => {
    const token = createValidToken();
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    const cachedUser = {
      id: 'usr-notif-test-1',
      email: 'cached@urbanfleet.com',
      roles: ['RIDER'],
      firstName: 'Cached',
      lastName: 'User',
    };

    vi.spyOn(notificationRedisClient, 'isOpen', 'get').mockReturnValue(true);
    vi.spyOn(notificationRedisClient, 'get').mockImplementation(async (key: string) => {
      if (key === 'auth:session:sess-test-1' || key === 'session:sess-test-1') {
        return JSON.stringify({ userId: 'usr-notif-test-1', sessionId: 'sess-test-1' });
      }
      if (key === 'auth:user:usr-notif-test-1') return JSON.stringify(cachedUser);
      return null;
    });
    vi.spyOn(notificationRedisClient, 'sMembers').mockResolvedValue(['sess-test-1']);
    vi.spyOn(notificationRedisClient, 'setEx').mockResolvedValue('OK');

    const authClientSpy = vi.spyOn(authClient, 'getUserById');

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(authClientSpy).not.toHaveBeenCalled();
    expect(req.userId).toBe('usr-notif-test-1');
    expect(req.user.email).toBe('cached@urbanfleet.com');
  });
});
