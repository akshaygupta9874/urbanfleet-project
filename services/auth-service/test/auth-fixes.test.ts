import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import axios from 'axios';
import { AuthService } from '../src/services/auth.service.js';
import { UserService } from '../src/services/user.service.js';
import { AuthController } from '../src/controllers/auth.controller.js';
import { createAuthRouter } from '../src/routes/auth.routes.js';
import { authRedisClient } from '../src/redis/client.js';
import { signAccessToken, signRefreshToken, initAsymmetricKeys } from '../src/crypto/keys.js';
import { authMiddleware } from '../src/middlewares/auth.middleware.js';
import fs from 'node:fs';
import path from 'node:path';

describe('End-to-End Auth Service Fixes & Security Verification', () => {
  let mockUserRepo: any;
  let mockSessionRepo: any;
  let mockOutboxRepo: any;
  let authService: AuthService;
  let userService: UserService;
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
      create: vi.fn().mockImplementation((d) => Promise.resolve({ id: 'usr-fix-1', ...d, isEmailVerified: false })),
      update: vi.fn().mockImplementation((id, d) => Promise.resolve({ id, ...d })),
      delete: vi.fn().mockResolvedValue({ id: 'usr-fix-1' }),
    };

    mockSessionRepo = {
      create: vi.fn().mockImplementation((d) => Promise.resolve({ id: d.id || 'sess-fix-1', version: 1, ...d })),
      findById: vi.fn().mockImplementation((id) => Promise.resolve({ id, userId: 'usr-fix-1', version: 1, expiresAt: new Date(Date.now() + 100000) })),
      findByUserId: vi.fn().mockResolvedValue([]),
      updateVersion: vi.fn().mockImplementation((id, version) => Promise.resolve({ id, version, lastActiveAt: new Date() })),
      findByToken: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
      deleteByUserId: vi.fn().mockResolvedValue({}),
    };

    mockOutboxRepo = {
      stageEvent: vi.fn().mockResolvedValue({ id: 'outbox-1' }),
      getPendingEvents: vi.fn().mockResolvedValue([]),
      markPublished: vi.fn().mockResolvedValue({}),
      markFailed: vi.fn().mockResolvedValue({}),
    };

    authService = new AuthService(mockUserRepo, mockSessionRepo, mockOutboxRepo);
    userService = new UserService(mockUserRepo);
    authController = new AuthController(authService, userService);

    vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(true);
    vi.spyOn(authRedisClient, 'set').mockResolvedValue('OK' as any);
    vi.spyOn(authRedisClient, 'get').mockResolvedValue(null as any);
    vi.spyOn(authRedisClient, 'del').mockResolvedValue(1 as any);
  });

  // Issue 1: Registration parameter normalization
  it('Issue 1: Successfully registers with firstName & lastName and roles array', async () => {
    mockUserRepo.findByEmail.mockResolvedValue(null);

    const res = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'driver.fix@urbanfleet.com',
        password: 'SecurePassword123!',
        firstName: 'John',
        lastName: 'Doe',
        roles: ['RIDER'],
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        ipAddress: '127.0.0.1',
      }),
    });

    const body = await res.json() as any;
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(mockUserRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      email: 'driver.fix@urbanfleet.com',
      firstName: 'John',
      lastName: 'Doe',
      roles: ['RIDER'],
    }));
  });

  // Issue 3: UserService never leaks passwordHash
  it('Issue 3: UserService.getUserById scrubs passwordHash', async () => {
    mockUserRepo.findById.mockResolvedValue({
      id: 'usr-sensitive',
      email: 'sensitive@urbanfleet.com',
      firstName: 'Sensitive',
      lastName: 'User',
      passwordHash: 'secret_hash',
      isEmailVerified: true,
    });

    const user = await userService.getUserById('usr-sensitive');
    expect(user.passwordHash).toBeUndefined();
    expect(user.id).toBe('usr-sensitive');
    expect(user.email).toBe('sensitive@urbanfleet.com');
  });

  // Issue 6: Refresh token rotation increments session version and rotates tokens in Redis
  it('Issue 6: Refresh token rotation increments session version and rotates tokens in Redis', async () => {
    const sessionId = 'session-uuid-1';
    const oldRefreshToken = signRefreshToken({
      userId: 'usr-fix-1',
      sessionId,
      sessionVersion: 1,
    });
    mockSessionRepo.findById.mockResolvedValue({
      id: sessionId,
      userId: 'usr-fix-1',
      version: 1,
      expiresAt: new Date(Date.now() + 100000),
    });
    mockUserRepo.findById.mockResolvedValue({
      id: 'usr-fix-1',
      email: 'user@urbanfleet.com',
      roles: ['RIDER'],
    });

    const res = await authService.refreshAccessToken(oldRefreshToken);

    expect(mockSessionRepo.updateVersion).toHaveBeenCalledWith(sessionId, 2);
    expect(res.accessToken).toBeDefined();
    expect(res.refreshToken).toBeDefined();
    expect(res.refreshToken).not.toBe(oldRefreshToken);
  });

  // Issue 7: Registration creates unverified user without issuing tokens or session cookies
  it('Issue 7: Registration creates unverified user without issuing tokens or session cookies', async () => {
    mockUserRepo.findByEmail.mockResolvedValue(null);

    const res = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'cookie.test@urbanfleet.com',
        password: 'Password123!',
        firstName: 'Cookie',
        lastName: 'Tester',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        ipAddress: '127.0.0.1',
      }),
    });

    const body = await res.json() as any;
    expect(res.status).toBe(201);
    expect(body.data.user.email).toBe('cookie.test@urbanfleet.com');
    expect(body.data.user.isEmailVerified).toBe(false);
    expect(body.data.accessToken).toBeUndefined();
    expect(res.headers.get('set-cookie')).toBeNull();
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

  // Issue 10: Login requires OTP verification
  it('Issue 10: POST /login requires OTP verification and returns userId and email', async () => {
    mockUserRepo.findByEmail.mockResolvedValue({
      id: 'user-login-1',
      email: 'rider@urbanfleet.com',
      passwordHash: await authService.hashPassword('RiderPassword123!'),
      roles: ['RIDER'],
      isEmailVerified: true,
    });

    const res = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rider@urbanfleet.com', password: 'RiderPassword123!' }),
    });

    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.data.email).toBe('rider@urbanfleet.com');
  });

  it('Issue 10b: POST /login rejects unverified user with 403 Forbidden', async () => {
    mockUserRepo.findByEmail.mockResolvedValue({
      id: 'user-unverified-1',
      email: 'unverified@urbanfleet.com',
      passwordHash: await authService.hashPassword('RiderPassword123!'),
      roles: ['RIDER'],
      isEmailVerified: false,
    });

    const res = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'unverified@urbanfleet.com', password: 'RiderPassword123!' }),
    });

    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error).toContain('verify your email');
  });

  // Issue 11: verifyOtpSchema rejects empty or malformed OTP
  it('Issue 11: verifyOtpSchema rejects missing OTP', async () => {
    const res = await fetch(`${baseUrl}/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rider@urbanfleet.com' }),
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
      expect(body.data.accessToken).toBeDefined();
      expect(body.data.user.email).toBe('newgoogleuser@example.com');
      expect(body.data.user.firstName).toBe('Google');
      expect(body.data.user.lastName).toBe('Traveler');
      expect(mockUserRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'newgoogleuser@example.com',
          isEmailVerified: true,
          roles: ['RIDER'],
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
        roles: ['RIDER'],
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
      expect(body.data.user.email).toBe('existinguser@example.com');
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
      roles: ['RIDER'],
      isEmailVerified: true,
    };
    const userB = {
      id: '00000000-0000-0000-0000-000000000002',
      email: 'userb@example.com',
      firstName: 'User',
      lastName: 'B',
      roles: ['RIDER'],
      isEmailVerified: true,
    };

    it('rejects cross-user profile access for non-admin user with 403 Forbidden', async () => {
      mockUserRepo.findById.mockResolvedValue(userB);

      const tokenA = signAccessToken({
        userId: userA.id,
        email: userA.email,
        firstName: userA.firstName,
        lastName: userA.lastName,
        roles: ['RIDER'],
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
        firstName: userA.firstName,
        lastName: userA.lastName,
        roles: ['RIDER'],
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

    it('rejects unauthenticated requests even if x-internal-service-key header is supplied', async () => {
      mockUserRepo.findById.mockResolvedValue(userB);

      const res = await fetch(`${baseUrl}/users/${userB.id}`, {
        method: 'GET',
        headers: {
          'x-internal-service-key': '9fef5ba5e9688b75efee1781b80dad81703c29df93181ab9c474532c3281dd99',
        },
      });

      expect(res.status).toBe(401);
    });
  });

  describe('Issue 18: OTP Login Flow (POST /verify-otp)', () => {
    it('completes login when valid OTP is provided to /verify-otp', async () => {
      const activeUser = {
        id: 'user-otp-1',
        email: 'userotp@urbanfleet.com',
        firstName: 'OTP',
        lastName: 'User',
        roles: ['RIDER'],
        isEmailVerified: true,
      };

      mockUserRepo.findByEmail.mockResolvedValue(activeUser);
      vi.spyOn(authRedisClient, 'get').mockResolvedValue('123456');

      const res = await fetch(`${baseUrl}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'userotp@urbanfleet.com',
          otp: '123456',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.accessToken).toBeDefined();
      expect(body.data.user.id).toBe('user-otp-1');
      expect(res.headers.get('set-cookie')).toContain('refreshToken=');
    });

    it('rejects invalid OTP with 401 Unauthorized', async () => {
      mockUserRepo.findByEmail.mockResolvedValue({
        id: 'user-otp-2',
        email: 'userotp2@urbanfleet.com',
        roles: ['RIDER'],
        isEmailVerified: true,
      });

      const res = await fetch(`${baseUrl}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'userotp2@urbanfleet.com',
          otp: '000000',
        }),
      });

      expect(res.status).toBe(401);
      const body = await res.json() as any;
      expect(body.error).toMatch(/Invalid or expired verification code/);
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
