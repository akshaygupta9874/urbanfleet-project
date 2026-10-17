import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import { AuthService } from '../src/services/auth.service.js';
import { UserService } from '../src/services/user.service.js';
import { TwoFactorService } from '../src/services/two-factor.service.js';
import { AuthController } from '../src/controllers/auth.controller.js';
import { createAuthRouter } from '../src/routes/auth.routes.js';
import { authRedisClient } from '../src/redis/client.js';
import { signRefreshToken, initAsymmetricKeys } from '../src/crypto/keys.js';
import { authMiddleware } from '../src/middlewares/auth.middleware.js';
import fs from 'node:fs';
import path from 'node:path';

describe('End-to-End Auth Service Fixes & Security Verification', () => {
  let mockUserRepo: any;
  let mockSessionRepo: any;
  let mockAuditRepo: any;
  let mockOutboxRepo: any;
  let authService: AuthService;
  let userService: UserService;
  let twoFactorService: TwoFactorService;
  let authController: AuthController;
  let app: express.Express;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    // Attach error handler so any unhandled errors return JSON
    app.use('/api/auth', (req, res, next) => createAuthRouter(authController)(req, res, next));
    app.use((err: any, req: any, res: any, next: any) => {
      console.error('Test server error:', err);
      res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
    });

    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}/api/auth`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  beforeEach(() => {
    vi.restoreAllMocks();

    mockUserRepo = {
      findById: vi.fn(),
      findByEmail: vi.fn(),
      findByPhone: vi.fn(),
      create: vi.fn().mockImplementation((d) => Promise.resolve({ id: 'usr-fix-1', ...d, isEmailVerified: false, twoFactorEnabled: false })),
      update: vi.fn().mockImplementation((id, d) => Promise.resolve({ id, ...d })),
      delete: vi.fn().mockResolvedValue({ id: 'usr-fix-1' }),
      consumeRecoveryCode: vi.fn(),
    };

    mockSessionRepo = {
      create: vi.fn().mockImplementation((d) => Promise.resolve({ id: d.id || 'sess-fix-1', ...d })),
      findByToken: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
      deleteByUserId: vi.fn().mockResolvedValue({}),
    };

    mockAuditRepo = {
      record: vi.fn().mockResolvedValue({}),
    };

    mockOutboxRepo = {
      stageEvent: vi.fn().mockResolvedValue({ id: 'outbox-1' }),
      getPendingEvents: vi.fn().mockResolvedValue([]),
      markPublished: vi.fn().mockResolvedValue({}),
      markFailed: vi.fn().mockResolvedValue({}),
    };

    authService = new AuthService(mockUserRepo, mockSessionRepo, mockAuditRepo, mockOutboxRepo);
    userService = new UserService(mockUserRepo);
    twoFactorService = new TwoFactorService(mockUserRepo, mockAuditRepo);
    authController = new AuthController(authService, userService, twoFactorService);
  });

  // Issue 1: Registration parameter normalization
  it('Issue 1: Successfully registers with firstName & lastName, computing fullName and roles array', async () => {
    mockUserRepo.findByEmail.mockResolvedValue(null);

    const res = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane.doe@urbanfleet.com',
        password: 'Password123!',
        roles: ['RIDER'],
      }),
    });

    const body = await res.json() as any;
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(mockUserRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      fullName: 'Jane Doe',
      role: 'RIDER',
    }));
  });

  // Issue 3: UserService never leaks 2FA secrets or recovery codes
  it('Issue 3: UserService.getUserById scrubs twoFactorPendingSecret, twoFactorRecoveryCodes, and passwordHash', async () => {
    mockUserRepo.findById.mockResolvedValue({
      id: 'usr-sensitive',
      email: 'sensitive@urbanfleet.com',
      fullName: 'Sensitive User',
      passwordHash: 'secret_hash',
      twoFactorSecret: 'active_secret',
      twoFactorPendingSecret: 'pending_secret',
      twoFactorRecoveryCodes: JSON.stringify(['hash1', 'hash2']),
      twoFactorSetupRequestedAt: new Date(),
    });

    const user = await userService.getUserById('usr-sensitive');
    expect(user.passwordHash).toBeUndefined();
    expect(user.twoFactorSecret).toBeUndefined();
    expect(user.twoFactorPendingSecret).toBeUndefined();
    expect(user.twoFactorRecoveryCodes).toBeUndefined();
    expect(user.twoFactorSetupRequestedAt).toBeUndefined();
    expect(user.id).toBe('usr-sensitive');
    expect(user.email).toBe('sensitive@urbanfleet.com');
  });

  // Issue 5: Recovery code rate-limiting (lockout after 5 failed attempts)
  it('Issue 5: Locks out recovery-code verification after 5 failed attempts', async () => {
    vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(true);
    vi.spyOn(authRedisClient, 'get').mockResolvedValue(JSON.stringify({ userId: 'usr-fix-1', attempts: 5 }));
    const delSpy = vi.spyOn(authRedisClient, 'del').mockResolvedValue(1 as any);

    await expect(
      twoFactorService.verifyRecoveryCode('chall-locked', 'wrong-code')
    ).rejects.toThrow('Too many failed 2FA attempts');

    expect(delSpy).toHaveBeenCalled();
  });

  // Issue 5 (atomic consumption): Uses atomic consumeRecoveryCode
  it('Issue 5 (atomic): Consumes recovery code via atomic repository transaction', async () => {
    vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(true);
    vi.spyOn(authRedisClient, 'get').mockResolvedValue(JSON.stringify({ userId: 'usr-fix-1', attempts: 0 }));
    vi.spyOn(authRedisClient, 'del').mockResolvedValue(1 as any);

    mockUserRepo.findById.mockResolvedValue({
      id: 'usr-fix-1',
      twoFactorRecoveryCodes: JSON.stringify(['dummy']),
    });

    mockUserRepo.consumeRecoveryCode.mockResolvedValue({
      success: true,
      user: { id: 'usr-fix-1', email: 'test@example.com' },
      remainingCount: 7,
    });

    const res = await twoFactorService.verifyRecoveryCode('chall-valid', 'abcd-1234');
    expect(res.user.id).toBe('usr-fix-1');
    expect(res.remainingRecoveryCodes).toBe(7);
    expect(mockUserRepo.consumeRecoveryCode).toHaveBeenCalled();
  });

  // Issue 6: Session rotation synchronization
  it('Issue 6: Refresh token rotation generates a new sessionId and synchronizes token and database session', async () => {
    const oldSessionId = 'old-session-uuid';
    mockSessionRepo.findByToken.mockResolvedValue({
      id: oldSessionId,
      userId: 'usr-fix-1',
      expiresAt: new Date(Date.now() + 100000),
    });
    mockUserRepo.findById.mockResolvedValue({
      id: 'usr-fix-1',
      email: 'user@urbanfleet.com',
      role: 'RIDER',
    });

    const res = await authService.refreshAccessToken('old-refresh-token');

    expect(mockSessionRepo.delete).toHaveBeenCalledWith(oldSessionId);
    expect(mockSessionRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.any(String),
      userId: 'usr-fix-1',
      refreshToken: res.refreshToken,
    }));

    // Verify created session ID does not match the old deleted session ID
    const createdSessionId = mockSessionRepo.create.mock.calls[0][0].id;
    expect(createdSessionId).not.toBe(oldSessionId);
  });

  // Issue 7: Cookie-only refresh tokens (omitted from JSON response)
  it('Issue 7: Login and register omit refreshToken from JSON response body', async () => {
    mockUserRepo.findByEmail.mockResolvedValue({
      id: 'usr-fix-1',
      email: 'user@urbanfleet.com',
      passwordHash: await authService.hashPassword('Password123!'),
      twoFactorEnabled: false,
      role: 'RIDER',
    });

    const res = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@urbanfleet.com', password: 'Password123!' }),
    });

    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.data.accessToken).toBeDefined();
    // refreshToken must NOT be exposed in JSON response body
    expect(body.data.refreshToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
    // But cookie must be set
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('refreshToken=');
  });

  // Issue 8: verifyEmail accepts path params, body params, and query params
  it('Issue 8: verifyEmail extracts token from path param', async () => {
    vi.spyOn(authService, 'verifyEmail').mockResolvedValue({ success: true, message: 'Email verified' } as any);

    const res = await fetch(`${baseUrl}/verify/path-token-12345`, {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(authService.verifyEmail).toHaveBeenCalledWith('path-token-12345');
  });

  // Issue 9: Password recovery endpoints registered and dispatch notifications
  it('Issue 9: forgot-password endpoint dispatches event', async () => {
    mockUserRepo.findByEmail.mockResolvedValue({
      id: 'usr-fix-1',
      email: 'user@urbanfleet.com',
    });
    vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(true);
    vi.spyOn(authRedisClient, 'set').mockResolvedValue('OK' as any);

    const res = await fetch(`${baseUrl}/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@urbanfleet.com' }),
    });

    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.data.message).toContain('Password reset instructions dispatched');
  });

  // Issue 10: Enforce 2FA for ADMIN login
  it('Issue 10: Enforces 2FA setup requirement when ADMIN logs in without 2FA', async () => {
    mockUserRepo.findByEmail.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@urbanfleet.com',
      passwordHash: await authService.hashPassword('AdminPassword123!'),
      role: 'ADMIN',
      twoFactorEnabled: false,
    });
    mockUserRepo.findById.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@urbanfleet.com',
      twoFactorEnabled: false,
    });

    const res = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@urbanfleet.com', password: 'AdminPassword123!' }),
    });

    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.data.requiresTwoFactorSetup).toBe(true);
    expect(body.data.qrCodeUrl).toBeDefined();
    expect(body.data.message).toContain('Admin policy requires Two-Factor Authentication');
  });

  // Issue 11: Missing OTP validation refinement
  it('Issue 11: verifyOtpSchema rejects empty verification code / recovery code', async () => {
    const res = await fetch(`${baseUrl}/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken: 'valid-token' }),
    });

    expect(res.status).toBe(422);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
  });

  // Issue 12: Durable Outbox staging during registration
  it('Issue 12: Stages USER_REGISTERED event in Outbox table during registration', async () => {
    mockUserRepo.findByEmail.mockResolvedValue(null);

    await authService.register({
      email: 'outbox.user@urbanfleet.com',
      password: 'Password123!',
      fullName: 'Outbox User',
    });

    expect(mockOutboxRepo.stageEvent).toHaveBeenCalledWith(null, expect.objectContaining({
      topic: 'urbanfleet.auth.events',
      eventType: 'USER_REGISTERED',
    }));
  });

  // Issue 13: Checked-in Prisma migrations exist
  it('Issue 13: Initial Prisma migration files exist on disk for deployment', () => {
    const migrationSqlPath = path.resolve(
      __dirname,
      '../prisma/migrations/0_init/migration.sql'
    );
    expect(fs.existsSync(migrationSqlPath)).toBe(true);
    const sql = fs.readFileSync(migrationSqlPath, 'utf-8');
    expect(sql).toContain('CREATE TABLE "users"');
    expect(sql).toContain('CREATE TABLE "outbox_events"');
  });

  // Issue 14: Production fail-fast on missing keys
  it('Issue 14: initAsymmetricKeys throws error in production when environment keys are absent', () => {
    const originalEnv = process.env.NODE_ENV;
    const origPriv = process.env.JWT_PRIVATE_KEY_BASE64;
    const origPub = process.env.JWT_PUBLIC_KEY_BASE64;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.JWT_PRIVATE_KEY_BASE64;
      delete process.env.JWT_PUBLIC_KEY_BASE64;

      expect(() => initAsymmetricKeys()).toThrow('Production deployment requires');
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (origPriv) process.env.JWT_PRIVATE_KEY_BASE64 = origPriv;
      if (origPub) process.env.JWT_PUBLIC_KEY_BASE64 = origPub;
    }
  });

  // Issue 15: Token type distinction (ACCESS vs REFRESH)
  it('Issue 15: Auth middleware rejects REFRESH token passed as Bearer token', async () => {
    const refreshToken = signRefreshToken({ userId: 'usr-1', sessionId: 'sess-1' });

    const req: any = {
      headers: { authorization: `Bearer ${refreshToken}` },
      cookies: {},
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'INVALID_TOKEN_TYPE',
    }));
    expect(next).not.toHaveBeenCalled();
  });
});
