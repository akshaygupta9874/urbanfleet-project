import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import axios from 'axios';
import { AuthService } from '../src/services/auth.service.js';
import { UserService } from '../src/services/user.service.js';
import { TwoFactorService } from '../src/services/two-factor.service.js';
import { AuthController } from '../src/controllers/auth.controller.js';
import { createAuthRouter } from '../src/routes/auth.routes.js';
import { authRedisClient } from '../src/redis/client.js';
import { signAccessToken, signRefreshToken, initAsymmetricKeys } from '../src/crypto/keys.js';
import { authMiddleware } from '../src/middlewares/auth.middleware.js';
import { authenticator } from 'otplib';
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
  it('Issue 1: Successfully registers with firstName & lastName and roles array', async () => {
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
      firstName: 'Jane',
      lastName: 'Doe',
      role: 'RIDER',
    }));
  });

  // Issue 3: UserService never leaks 2FA secrets or recovery codes
  it('Issue 3: UserService.getUserById scrubs twoFactorPendingSecret, twoFactorRecoveryCodes, and passwordHash', async () => {
    mockUserRepo.findById.mockResolvedValue({
      id: 'usr-sensitive',
      email: 'sensitive@urbanfleet.com',
      firstName: 'Sensitive',
      lastName: 'User',
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
      firstName: 'Outbox',
      lastName: 'User',
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

  // Issue 16: Google Authentication
  describe('Issue 16: Google Auth endpoint POST /google', () => {
    const originalFetch = globalThis.fetch;

    it('rejects request when credential is missing or too short', async () => {
      const res = await originalFetch(`${baseUrl}/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: 'abc' }),
      });

      expect(res.status).toBe(422);
    });

    it('rejects request when Google token verification fails', async () => {
      const axiosGetError = new Error('Request failed with status code 400');
      Object.assign(axiosGetError, {
        isAxiosError: true,
        response: { status: 400, data: { error: 'invalid_token' } }
      });
      const axiosSpy = vi.spyOn(axios, 'get').mockRejectedValue(axiosGetError);

      const res = await originalFetch(`${baseUrl}/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: 'invalid_google_credential_token' }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toMatch(/Google could not verify/);
      axiosSpy.mockRestore();
    });

    it('creates new user and signs in successfully with verified Google token', async () => {
      const axiosSpy = vi.spyOn(axios, 'get').mockResolvedValue({
        status: 200,
        data: {
          sub: 'google-sub-12345',
          email: 'newgoogleuser@example.com',
          email_verified: true,
          name: 'Google Traveler',
          picture: 'https://example.com/avatar.jpg',
          aud: process.env.GOOGLE_CLIENT_ID || '841434396195-7l7q5r78htpukv1v8muvo1jko4pm939j.apps.googleusercontent.com',
        },
      });

      mockUserRepo.findByEmail.mockResolvedValue(null);
      mockUserRepo.create.mockImplementation(async (data: any) => ({
        id: 'usr-google-1',
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      mockSessionRepo.create.mockResolvedValue({ id: 'sess-google-1' });

      const res = await originalFetch(`${baseUrl}/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: 'valid_google_credential_token_12345' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.accessToken).toBeDefined();
      expect(body.user.email).toBe('newgoogleuser@example.com');
      expect(body.user.firstName).toBe('Google');
      expect(body.user.lastName).toBe('Traveler');
      expect(mockUserRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'newgoogleuser@example.com',
          isEmailVerified: true,
          role: 'RIDER',
        })
      );
      axiosSpy.mockRestore();
    });

    it('logs in existing user successfully when authenticated with Google', async () => {
      const axiosSpy = vi.spyOn(axios, 'get').mockResolvedValue({
        status: 200,
        data: {
          sub: 'google-sub-99999',
          email: 'existinguser@example.com',
          email_verified: 'true',
          name: 'Existing Rider',
          aud: process.env.GOOGLE_CLIENT_ID || '841434396195-7l7q5r78htpukv1v8muvo1jko4pm939j.apps.googleusercontent.com',
        },
      });

      mockUserRepo.findByEmail.mockResolvedValue({
        id: 'usr-existing-1',
        email: 'existinguser@example.com',
        firstName: 'Existing',
        lastName: 'Rider',
        role: 'RIDER',
        isEmailVerified: true,
      });
      mockSessionRepo.create.mockResolvedValue({ id: 'sess-existing-1' });

      const res = await originalFetch(`${baseUrl}/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: 'valid_google_credential_token_existing' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.user.email).toBe('existinguser@example.com');
      expect(mockUserRepo.create).not.toHaveBeenCalled();
      axiosSpy.mockRestore();
    });
  });

  describe('Issue 17: Cross-User Profile Access Restrictions (GET /users/:id)', () => {
    const userA = {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'usera@example.com',
      firstName: 'User',
      lastName: 'A',
      role: 'RIDER',
      isEmailVerified: true,
    };
    const userB = {
      id: '00000000-0000-0000-0000-000000000002',
      email: 'userb@example.com',
      firstName: 'User',
      lastName: 'B',
      role: 'RIDER',
      isEmailVerified: true,
    };

    it('rejects cross-user profile access for non-admin user with 403 Forbidden', async () => {
      mockUserRepo.findById.mockResolvedValue(userB);

      const tokenA = signAccessToken({
        userId: userA.id,
        email: userA.email,
        role: 'RIDER',
      });

      const res = await fetch(`${baseUrl}/users/${userB.id}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${tokenA}` },
      });

      expect(res.status).toBe(403);
      const body = await res.json() as any;
      expect(body.code).toBe('FORBIDDEN');
    });

    it('allows a user to view their own profile via GET /users/:id', async () => {
      mockUserRepo.findById.mockResolvedValue(userA);

      const tokenA = signAccessToken({
        userId: userA.id,
        email: userA.email,
        role: 'RIDER',
      });

      const res = await fetch(`${baseUrl}/users/${userA.id}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${tokenA}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(userA.id);
    });

    it('allows an ADMIN user to view any user profile', async () => {
      mockUserRepo.findById.mockResolvedValue(userB);

      const adminToken = signAccessToken({
        userId: 'admin-uuid-1',
        email: 'admin@urbanfleet.com',
        role: 'ADMIN',
      });

      const res = await fetch(`${baseUrl}/users/${userB.id}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(userB.id);
    });

    it('allows internal services to query user profile with valid x-internal-service-key', async () => {
      mockUserRepo.findById.mockResolvedValue(userB);

      const res = await fetch(`${baseUrl}/users/${userB.id}`, {
        method: 'GET',
        headers: {
          'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY || '9fef5ba5e9688b75efee1781b80dad81703c29df93181ab9c474532c3281dd99',
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(userB.id);
    });
  });

  describe('Issue 18: 2FA Login & Setup Flow (POST /verify-otp)', () => {
    it('activates 2FA and completes login when userId is provided with pending 2FA setup', async () => {
      const secret = authenticator.generateSecret();
      const code = authenticator.generate(secret);

      const pendingAdmin = {
        id: 'admin-setup-1',
        email: 'admin-setup@urbanfleet.com',
        role: 'ADMIN',
        roles: ['ADMIN'],
        twoFactorEnabled: false,
        twoFactorPendingSecret: secret,
        twoFactorSetupRequestedAt: new Date(),
      };

      mockUserRepo.findById.mockResolvedValue(pendingAdmin);
      mockUserRepo.update.mockImplementation(async (id: string, updates: any) => {
        Object.assign(pendingAdmin, updates);
        return pendingAdmin;
      });

      const res = await fetch(`${baseUrl}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'admin-setup-1',
          code,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.accessToken).toBeDefined();
      expect(body.data.user.id).toBe('admin-setup-1');

      // Verify that 2FA was enabled and pending secret promoted
      expect(mockUserRepo.update).toHaveBeenCalledWith(
        'admin-setup-1',
        expect.objectContaining({
          twoFactorEnabled: true,
          twoFactorSecret: secret,
          twoFactorPendingSecret: null,
        })
      );
    });

    it('rejects invalid OTP when completing 2FA setup with 401', async () => {
      const secret = authenticator.generateSecret();
      const pendingAdmin = {
        id: 'admin-setup-2',
        email: 'admin-setup2@urbanfleet.com',
        role: 'ADMIN',
        roles: ['ADMIN'],
        twoFactorEnabled: false,
        twoFactorPendingSecret: secret,
        twoFactorSetupRequestedAt: new Date(),
      };

      mockUserRepo.findById.mockResolvedValue(pendingAdmin);

      const res = await fetch(`${baseUrl}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'admin-setup-2',
          code: '000000',
        }),
      });

      expect(res.status).toBe(401);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
    });

    it('completes login when valid challengeToken is provided to /verify-otp', async () => {
      const activeUser = {
        id: 'user-2fa-1',
        email: 'user2fa@urbanfleet.com',
        role: 'RIDER',
        roles: ['RIDER'],
        twoFactorEnabled: true,
      };

      vi.spyOn(twoFactorService, 'verifyLoginChallenge').mockResolvedValue(activeUser);

      const res = await fetch(`${baseUrl}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeToken: 'valid-challenge-token-123',
          code: '123456',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.accessToken).toBeDefined();
      expect(body.data.user.id).toBe('user-2fa-1');
      expect(twoFactorService.verifyLoginChallenge).toHaveBeenCalledWith(
        'valid-challenge-token-123',
        '123456',
        expect.anything()
      );
    });
  });

  describe('Auth Service Health Check', () => {
    it('returns UP with status and service name', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.status).toBe('UP');
      expect(data.service).toBe('auth-service');
    });
  });
});


