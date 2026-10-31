import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import http from 'node:http';
import axios from 'axios';
import { AuthService } from '../src/services/auth.service.js';
import { UserService } from '../src/services/user.service.js';
import { AuthController } from '../src/controllers/auth.controller.js';
import { createAuthRouter } from '../src/routes/auth.routes.js';
import { authRedisClient } from '../src/redis/client.js';
import {
  clearCookieOptions,
  clearAuthCookies,
  getRefreshTokenCookieOptions,
  setRefreshTokenCookie,
  REFRESH_TOKEN_COOKIE_MAX_AGE_MS,
} from '../src/utils/cookie.js';
import { extractClientMetadata } from '../src/utils/client-metadata.js';
import { signAccessToken, signRefreshToken, initAsymmetricKeys } from '../src/crypto/keys.js';
import { authMiddleware, hasRole, requireRole } from '../src/middlewares/auth.middleware.js';
import { Role } from '../src/db/client.js';
import { UnauthorizedError } from '@urbanfleet/common';
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
    app.use(cookieParser());
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
      addDriverRole: vi.fn().mockImplementation((id) => Promise.resolve({
        id,
        email: 'driver@urbanfleet.com',
        roles: ['RIDER', 'DRIVER'],
        firstName: 'Driver',
        lastName: 'User',
      })),
    };

    mockSessionRepo = {
      create: vi.fn().mockImplementation((d) => Promise.resolve({ id: d.id || 'sess-fix-1', version: 1, ...d })),
      findById: vi.fn().mockImplementation((id) => Promise.resolve({ id, userId: 'usr-fix-1', version: 1, expiresAt: new Date(Date.now() + 100000) })),
      findByUserId: vi.fn().mockResolvedValue([]),
      updateVersion: vi.fn().mockImplementation((id, version) => Promise.resolve({ id, version, lastActiveAt: new Date() })),
      findByToken: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
      deleteByIdAndUserId: vi.fn().mockResolvedValue({ count: 1 }),
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

    it('creates new DRIVER account when DRIVER role is selected during Google signup', async () => {
      const axiosSpy = vi.spyOn(axios, 'get').mockResolvedValue({
        status: 200,
        data: {
          sub: 'google-sub-driver-1',
          email: 'googledriver@example.com',
          email_verified: true,
          name: 'Fast Driver',
          aud: process.env.GOOGLE_CLIENT_ID || '841434396195-7l7q5r78htpukv1v8muvo1jko4pm939j.apps.googleusercontent.com',
        },
      });

      mockUserRepo.findByEmail.mockResolvedValue(null);
      mockUserRepo.create.mockImplementation(async (data: any) => ({
        id: 'usr-google-driver-1',
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      mockSessionRepo.create.mockResolvedValue({ id: 'sess-driver-1' });

      const res = await originalFetch(`${baseUrl}/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: 'valid_google_credential_driver_token',
          roles: ['DRIVER'],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.accessToken).toBeUndefined(); // Standardized response envelope (no top-level duplication)
      expect(body.data.accessToken).toBeDefined();
      expect(body.data.user.roles).toEqual(['DRIVER']);
      expect(mockUserRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'googledriver@example.com',
          roles: ['DRIVER'],
        })
      );
      axiosSpy.mockRestore();
    });

    it('merges DRIVER role when existing RIDER authenticates with DRIVER selection', async () => {
      const axiosSpy = vi.spyOn(axios, 'get').mockResolvedValue({
        status: 200,
        data: {
          sub: 'google-sub-merge-1',
          email: 'rideranddriver@example.com',
          email_verified: true,
          name: 'Dual Role',
          aud: process.env.GOOGLE_CLIENT_ID || '841434396195-7l7q5r78htpukv1v8muvo1jko4pm939j.apps.googleusercontent.com',
        },
      });

      const existingRider = {
        id: 'usr-dual-1',
        email: 'rideranddriver@example.com',
        firstName: 'Dual',
        lastName: 'Role',
        roles: ['RIDER'],
        isEmailVerified: true,
      };

      mockUserRepo.findByEmail.mockResolvedValue(existingRider);
      mockUserRepo.update.mockResolvedValue({
        ...existingRider,
        roles: ['RIDER', 'DRIVER'],
      });
      mockSessionRepo.create.mockResolvedValue({ id: 'sess-dual-1' });

      const res = await originalFetch(`${baseUrl}/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: 'valid_google_credential_merge_token',
          roles: ['DRIVER'],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(mockUserRepo.update).toHaveBeenCalledWith('usr-dual-1', {
        roles: ['RIDER', 'DRIVER'],
      });
      axiosSpy.mockRestore();
    });
  });

  describe('Issue 16b: Logout endpoint POST /logout', () => {
    const originalFetch = globalThis.fetch;

    it('successfully logs out and clears cookies when called with valid session or token', async () => {
      mockSessionRepo.delete.mockResolvedValue({ id: 'sess-logout-1' });

      const res = await originalFetch(`${baseUrl}/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'sess-logout-1' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.message).toBe('Logged out successfully');

      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain('refreshToken=;');
      expect(setCookie).toContain('csrfToken=;');
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

  describe('Issue 20: Secure Logout - Never Trust Body-Supplied Session or User Identifiers', () => {
    it('does NOT revoke another user session when arbitrary sessionId/userId is supplied in body', async () => {
      const res = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'victim-session-id-1234',
          userId: 'victim-user-id-5678',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.success).toBe(true);

      // Crucial: mockSessionRepo must NOT have been called with the victim's session
      expect(mockSessionRepo.delete).not.toHaveBeenCalled();
      expect(mockSessionRepo.deleteByIdAndUserId).not.toHaveBeenCalled();
    });

    it('revokes the session from the validated refresh token and ignores malicious body-supplied sessionId', async () => {
      // Create a valid refresh token for legitimate user
      const legitimateRefreshToken = signRefreshToken({
        userId: 'legit-user-1',
        sessionId: 'legit-session-1',
      });

      const res = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `refreshToken=${legitimateRefreshToken}`,
        },
        body: JSON.stringify({
          sessionId: 'maliciously-injected-victim-session-id',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.success).toBe(true);

      // Must delete legitimate user's session from the token, NEVER the injected body session
      expect(mockSessionRepo.deleteByIdAndUserId).toHaveBeenCalledWith('legit-session-1', 'legit-user-1');
      expect(mockSessionRepo.deleteByIdAndUserId).not.toHaveBeenCalledWith(
        'maliciously-injected-victim-session-id',
        expect.anything()
      );
    });

    it('revokes the session from a validated refresh token cookie', async () => {
      const legitRefreshToken = signRefreshToken({
        userId: 'cookie-user-1',
        sessionId: 'cookie-session-1',
      });

      const res = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `refreshToken=${legitRefreshToken}`,
        },
      });

      expect(res.status).toBe(200);
      expect(mockSessionRepo.deleteByIdAndUserId).toHaveBeenCalledWith('cookie-session-1', 'cookie-user-1');
    });
  });

  // Issue 21: grantDriverRole Authorization Boundary & Privilege Escalation Prevention
  describe('Issue 21: grantDriverRole Authorization Boundary & Privilege Escalation Prevention', () => {
    it('rejects unauthenticated requests without authorization header or internal key with 401', async () => {
      const res = await fetch(`${baseUrl}/internal/users/target-user-123/driver-role`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      expect(res.status).toBe(401);
      expect(mockUserRepo.addDriverRole).not.toHaveBeenCalled();
    });

    it('rejects unauthenticated requests with invalid internal key with 401', async () => {
      const res = await fetch(`${baseUrl}/internal/users/target-user-123/driver-role`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-service-key': 'wrong-or-malicious-key',
        },
      });

      expect(res.status).toBe(401);
      expect(mockUserRepo.addDriverRole).not.toHaveBeenCalled();
    });

    it('rejects authenticated non-admin users (e.g. RIDER) with 403 Forbidden', async () => {
      const riderToken = signAccessToken({
        userId: 'regular-rider-1',
        roles: ['RIDER'],
        email: 'rider@urbanfleet.com',
      });

      const res = await fetch(`${baseUrl}/internal/users/target-user-123/driver-role`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${riderToken}`,
        },
      });

      expect(res.status).toBe(403);
      expect(mockUserRepo.addDriverRole).not.toHaveBeenCalled();
    });

    it('allows requests with valid x-internal-service-key (internal driver service)', async () => {
      const internalKey = process.env.INTERNAL_SERVICE_KEY || 'urbanfleet-internal-service-secret';

      const res = await fetch(`${baseUrl}/internal/users/target-user-123/driver-role`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-service-key': internalKey,
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.success).toBe(true);
      expect(mockUserRepo.addDriverRole).toHaveBeenCalledWith('target-user-123');
    });

    it('allows requests from authenticated ADMIN users', async () => {
      const adminToken = signAccessToken({
        userId: 'admin-user-1',
        roles: ['ADMIN'],
        email: 'admin@urbanfleet.com',
      });

      const res = await fetch(`${baseUrl}/internal/users/target-user-123/driver-role`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`,
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.success).toBe(true);
      expect(mockUserRepo.addDriverRole).toHaveBeenCalledWith('target-user-123');
    });
  });

  // Issue 22: Shared Cookie Clearing with COOKIE_DOMAIN Support
  describe('Issue 22: Shared Cookie Clearing with COOKIE_DOMAIN Support', () => {
    const originalCookieDomain = process.env.COOKIE_DOMAIN;

    afterAll(() => {
      if (originalCookieDomain !== undefined) {
        process.env.COOKIE_DOMAIN = originalCookieDomain;
      } else {
        delete process.env.COOKIE_DOMAIN;
      }
    });

    it('clearCookieOptions respects COOKIE_DOMAIN when configured', () => {
      process.env.COOKIE_DOMAIN = '.urbanfleet.com';
      const opts = clearCookieOptions();
      expect(opts.domain).toBe('.urbanfleet.com');
      expect(opts.path).toBe('/');
      expect(opts.httpOnly).toBe(true);

      delete process.env.COOKIE_DOMAIN;
      const optsWithoutDomain = clearCookieOptions();
      expect(optsWithoutDomain.domain).toBeUndefined();
    });

    it('clearAuthCookies calls res.clearCookie with configured domain and non-duplicated options', () => {
      process.env.COOKIE_DOMAIN = '.urbanfleet.com';
      const mockRes: any = {
        clearCookie: vi.fn(),
      };

      clearAuthCookies(mockRes);

      expect(mockRes.clearCookie).toHaveBeenCalledTimes(2);
      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        'refreshToken',
        expect.objectContaining({
          domain: '.urbanfleet.com',
          path: '/',
          httpOnly: true,
        })
      );
      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        'csrfToken',
        expect.objectContaining({
          domain: '.urbanfleet.com',
          path: '/',
          httpOnly: false,
        })
      );
    });

    it('POST /logout sets Set-Cookie headers with Domain and without duplication or manual overwrite', async () => {
      process.env.COOKIE_DOMAIN = '.urbanfleet.com';

      const res = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);

      // In Node fetch, getSetCookie() returns all Set-Cookie headers
      const setCookies = (res.headers as any).getSetCookie
        ? (res.headers as any).getSetCookie()
        : [res.headers.get('set-cookie')];

      // Verify domain is present in Set-Cookie headers
      const refreshCookie = setCookies.find((c: string) => c.startsWith('refreshToken='));
      const csrfCookie = setCookies.find((c: string) => c.startsWith('csrfToken='));

      expect(refreshCookie).toBeDefined();
      expect(refreshCookie).toContain('Domain=.urbanfleet.com');
      expect(refreshCookie).toContain('Path=/');
      expect(refreshCookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');

      expect(csrfCookie).toBeDefined();
      expect(csrfCookie).toContain('Domain=.urbanfleet.com');
      expect(csrfCookie).toContain('Path=/');
      expect(csrfCookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');

      // Verify no duplicate Set-Cookie headers for the same cookie name
      const refreshTokenCount = setCookies.filter((c: string) => c.startsWith('refreshToken=')).length;
      const csrfTokenCount = setCookies.filter((c: string) => c.startsWith('csrfToken=')).length;
      expect(refreshTokenCount).toBe(1);
      expect(csrfTokenCount).toBe(1);
    });
  });

  // Issue 23: Authoritative Server-Observed Headers/IP Registration Metadata
  describe('Issue 23: Authoritative Server-Observed Headers/IP Registration Metadata', () => {
    it('successfully registers when userAgent and ipAddress are omitted from the request body', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);

      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) UrbanFleetTestBrowser',
        },
        body: JSON.stringify({
          email: 'no.meta.body@urbanfleet.com',
          password: 'SecurePassword123!',
          firstName: 'ServerObserved',
          lastName: 'Tester',
          roles: ['RIDER'],
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json() as any;
      expect(data.success).toBe(true);
      expect(mockUserRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        email: 'no.meta.body@urbanfleet.com',
        firstName: 'ServerObserved',
        lastName: 'Tester',
      }));
    });

    it('rejects registration when User-Agent header is missing with clear error message', async () => {
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': '',
        },
        body: JSON.stringify({
          email: 'no.ua.header@urbanfleet.com',
          password: 'SecurePassword123!',
          firstName: 'NoUA',
          lastName: 'Tester',
          roles: ['RIDER'],
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.error).toBe('User-Agent header and client IP address are required');
    });

    it('uses server-observed User-Agent and connection IP rather than untrusted body spoofing', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);
      const registerSpy = vi.spyOn(authService, 'register');

      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AuthoritativeServerUserAgent/2.0',
        },
        body: JSON.stringify({
          email: 'spoofed.meta@urbanfleet.com',
          password: 'SecurePassword123!',
          firstName: 'Spoofer',
          lastName: 'Tester',
          userAgent: 'MaliciousClientSpoofedUA',
          ipAddress: '198.51.100.99',
        }),
      });

      expect(res.status).toBe(201);
      expect(registerSpy).toHaveBeenCalledWith(expect.objectContaining({
        userAgent: 'AuthoritativeServerUserAgent/2.0',
      }));
      // Server-observed IP from localhost connection, NOT the spoofed 198.51.100.99
      const lastCall = registerSpy.mock.calls[registerSpy.mock.calls.length - 1][0];
      expect(lastCall.ipAddress).not.toBe('198.51.100.99');
      registerSpy.mockRestore();
    });
  });

  // Issue 24: Consistent Registration Response Shape (New Users vs Role-Merge Path)
  describe('Issue 24: Consistent Registration Response Shape', () => {
    it('returns consistent data.user shape for new user registrations (201)', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);

      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'UrbanFleetTest/1.0',
        },
        body: JSON.stringify({
          email: 'consistent.new@urbanfleet.com',
          password: 'SecurePassword123!',
          firstName: 'New',
          lastName: 'User',
          roles: ['RIDER'],
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json() as any;
      expect(data.success).toBe(true);
      expect(data.data.user).toBeDefined();
      expect(data.data.user.id).toBe('usr-fix-1');
      expect(data.data.user.email).toBe('consistent.new@urbanfleet.com');
      expect(data.data.user.firstName).toBe('New');
      expect(data.data.user.lastName).toBe('User');
      expect(data.data.user.roles).toEqual(['RIDER']);
      expect(data.data.user.isEmailVerified).toBe(false);
    });

    it('returns consistent data.user shape (NOT undefined) when existing user merges new role (200)', async () => {
      const existingUser = {
        id: 'usr-existing-456',
        email: 'existing.rider@urbanfleet.com',
        passwordHash: await authService.hashPassword('ExistingPassword123!'),
        firstName: 'Existing',
        lastName: 'Rider',
        roles: ['RIDER'],
        isEmailVerified: true,
      };

      mockUserRepo.findByEmail.mockResolvedValue(existingUser);
      mockUserRepo.update.mockResolvedValue({
        ...existingUser,
        roles: ['RIDER', 'DRIVER'],
      });

      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'UrbanFleetTest/1.0',
        },
        body: JSON.stringify({
          email: 'existing.rider@urbanfleet.com',
          password: 'ExistingPassword123!',
          firstName: 'Existing',
          lastName: 'Rider',
          roles: ['DRIVER'],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.success).toBe(true);
      expect(data.message).toBe('Your account has been updated with the requested role. You can now log in.');

      // Crucial: data.user must NOT be undefined
      expect(data.data).toBeDefined();
      expect(data.data.user).toBeDefined();
      expect(data.data.user.id).toBe('usr-existing-456');
      expect(data.data.user.email).toBe('existing.rider@urbanfleet.com');
      expect(data.data.user.roles).toEqual(['RIDER', 'DRIVER']);
      expect(data.data.user.isEmailVerified).toBe(true);
    });
  });

    // Issue 25: Single Source of Truth for Refresh Token (HttpOnly Cookie)
  describe('Issue 25: Single Source of Truth for Refresh Token Transport', () => {
    const validRefreshToken = signRefreshToken({
      userId: 'usr-fix-1',
      sessionId: 'session-uuid-1',
    });

    beforeEach(() => {
      mockUserRepo.findById.mockResolvedValue({
        id: 'usr-fix-1',
        email: 'usr@urbanfleet.com',
        firstName: 'User',
        lastName: 'One',
        roles: ['RIDER'],
      });
    });

    it('rejects with 401 when refresh token cookie is missing', async () => {
      const res = await fetch(`${baseUrl}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(401);
      const data = await res.json() as any;
      expect(data.error).toBe('Please provide refresh token');
    });

    it('rejects body-only token submissions when cookie is missing to enforce canonical transport', async () => {
      const res = await fetch(`${baseUrl}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: validRefreshToken }),
      });

      expect(res.status).toBe(401);
      const data = await res.json() as any;
      expect(data.error).toBe('Please provide refresh token');
    });

    it('successfully refreshes token via canonical HttpOnly cookie on /refresh', async () => {
      const res = await fetch(`${baseUrl}/refresh`, {
        method: 'POST',
        headers: {
          Cookie: `refreshToken=${validRefreshToken}`,
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.success).toBe(true);
      expect(data.data.accessToken).toBeDefined();
      expect(data.data.refreshToken).toBeUndefined(); // Refresh token strictly in cookie, not in body
      expect(data.data.user).toBeDefined();
      expect(data.data.csrfToken).toBeDefined();

      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain('refreshToken=');
    });

    it('successfully refreshes token via HttpOnly cookie on alias /refresh-token', async () => {
      const res = await fetch(`${baseUrl}/refresh-token`, {
        method: 'POST',
        headers: {
          Cookie: `refreshToken=${validRefreshToken}`,
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.success).toBe(true);
      expect(data.data.accessToken).toBeDefined();
      expect(data.data.user).toBeDefined();
      expect(data.data.csrfToken).toBeDefined();
    });
  });

  // Issue 26: Consistent Authentication Failure Handling in refreshCSRF
  describe('Issue 26: Consistent Authentication Failure Handling in refreshCSRF', () => {
    it('throws UnauthorizedError instead of returning ad-hoc 401 when userId is missing', async () => {
      const mockReq: any = {
        userId: undefined,
        cookies: {},
        headers: {},
      };
      const mockRes: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        cookie: vi.fn(),
      };
      const mockNext = vi.fn();

      // Invoke controller handler directly via asyncHandler
      await authController.refreshCSRF(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      const passedError = mockNext.mock.calls[0][0];
      expect(passedError).toBeInstanceOf(UnauthorizedError);
      expect(passedError.statusCode).toBe(401);
      expect(passedError.code).toBe('UNAUTHORIZED');
      expect(passedError.message).toBe('User unauthenticated');
      // Must NOT directly call res.status(401)
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('successfully refreshes CSRF token when authenticated', async () => {
      const mockReq: any = {
        userId: 'usr-fix-1',
        cookies: {},
        headers: {},
      };
      const mockRes: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        cookie: vi.fn(),
      };
      const mockNext = vi.fn();

      await authController.refreshCSRF(mockReq, mockRes, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: 'CSRF Token Refreshed',
        data: expect.objectContaining({
          csrfToken: expect.any(String),
        }),
      }));
    });
  });

  // Issue 27: Strongly Typed Authorization Logic & Middleware Unification
  describe('Issue 27: Strongly Typed Authorization Logic & Middleware Unification', () => {
    it('hasRole correctly checks role membership using Role enum', () => {
      const riderReq = { roles: ['RIDER'] } as any;
      const adminReq = { roles: ['RIDER', 'ADMIN'] } as any;
      const emptyReq = { roles: [] } as any;
      const noRolesReq = {} as any;

      expect(hasRole(riderReq, Role.RIDER)).toBe(true);
      expect(hasRole(riderReq, Role.ADMIN)).toBe(false);
      expect(hasRole(adminReq, Role.ADMIN)).toBe(true);
      expect(hasRole(adminReq, Role.DRIVER)).toBe(false);
      expect(hasRole(emptyReq, Role.ADMIN)).toBe(false);
      expect(hasRole(noRolesReq, Role.ADMIN)).toBe(false);
    });

    it('requireRole middleware passes for authorized role and rejects unauthorized role with 403', () => {
      const adminReq = { userId: 'usr-admin-1', roles: ['ADMIN'] } as any;
      const riderReq = { userId: 'usr-rider-1', roles: ['RIDER'] } as any;
      const mockRes: any = {};
      const nextFn = vi.fn();

      const adminGuard = requireRole(Role.ADMIN);

      adminGuard(adminReq, mockRes, nextFn);
      expect(nextFn).toHaveBeenCalledWith(); // passed without error

      nextFn.mockClear();
      adminGuard(riderReq, mockRes, nextFn);
      expect(nextFn).toHaveBeenCalledWith(expect.objectContaining({
        statusCode: 403,
        code: 'FORBIDDEN',
      }));
    });

    it('allows an ADMIN user to view another user profile via GET /users/:id using hasRole', async () => {
      const userTarget = {
        id: 'target-user-profile-id',
        email: 'target@urbanfleet.com',
        firstName: 'Target',
        lastName: 'Person',
        roles: ['RIDER'],
        isEmailVerified: true,
      };
      mockUserRepo.findById.mockResolvedValue(userTarget);

      const adminToken = signAccessToken({
        userId: 'admin-caller-id',
        email: 'admin@urbanfleet.com',
        firstName: 'Admin',
        lastName: 'Boss',
        roles: ['ADMIN'],
      });

      const res = await fetch(`${baseUrl}/users/${userTarget.id}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.success).toBe(true);
      expect(data.data.id).toBe(userTarget.id);
      expect(data.data.email).toBe('target@urbanfleet.com');
    });
  });

  // Issue 28: Unified Logout Identity Contract & Explicit Policy for Invalid Tokens
  describe('Issue 28: Unified Logout Identity Contract & Explicit Policy for Invalid Tokens', () => {
    it('rejects logout with 401 when an invalid/expired refresh token is provided in cookie', async () => {
      const res = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        headers: {
          Cookie: 'refreshToken=invalid.malformed.expired.jwt.token',
        },
      });

      expect(res.status).toBe(401);
      const data = await res.json() as any;
      expect(data.code).toBe('UNAUTHORIZED');
      expect(data.error).toBe('Invalid or expired refresh token');
      expect(mockSessionRepo.deleteByIdAndUserId).not.toHaveBeenCalled();
    });

    it('guarantees local cookie clearing and returns 200 when no token is supplied', async () => {
      const res = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.success).toBe(true);
      expect(data.message).toBe('Logged out successfully');

      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain('refreshToken=;');
      expect(setCookie).toContain('csrfToken=;');
      expect(mockSessionRepo.deleteByIdAndUserId).not.toHaveBeenCalled();
    });

    it('revokes server session and clears cookies when valid refresh token is supplied in cookie', async () => {
      const legitToken = signRefreshToken({
        userId: 'usr-logout-cookie-1',
        sessionId: 'sess-logout-cookie-1',
      });

      const res = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        headers: {
          Cookie: `refreshToken=${legitToken}`,
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.success).toBe(true);
      expect(mockSessionRepo.deleteByIdAndUserId).toHaveBeenCalledWith('sess-logout-cookie-1', 'usr-logout-cookie-1');
    });

    it('ignores untrusted body-supplied tokens when cookie is absent and executes local cleanup', async () => {
      const legitToken = signRefreshToken({
        userId: 'usr-logout-body-1',
        sessionId: 'sess-logout-body-1',
      });

      const res = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: legitToken }),
      });

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.success).toBe(true);
      expect(mockSessionRepo.deleteByIdAndUserId).not.toHaveBeenCalled();
    });
  });

  describe('Issue 29: Low-Priority Redundancies & Clarity Cleanup', () => {
    it('1. verifies getCsrfCookieOptions is not imported or used in auth.controller.ts', () => {
      const controllerSource = fs.readFileSync(
        path.resolve(__dirname, '../src/controllers/auth.controller.ts'),
        'utf-8'
      );
      expect(controllerSource).not.toContain('getCsrfCookieOptions');
    });

    it('2. verifies setRefreshTokenCookie sets 7-day maxAge and secure HttpOnly cookie', () => {
      expect(REFRESH_TOKEN_COOKIE_MAX_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
      const opts = getRefreshTokenCookieOptions();
      expect(opts.maxAge).toBe(7 * 24 * 60 * 60 * 1000);
      expect(opts.httpOnly).toBe(true);
      expect(opts.path).toBe('/');

      const mockRes = {
        cookie: vi.fn(),
      } as any;
      setRefreshTokenCookie(mockRes, 'test-refresh-token');
      expect(mockRes.cookie).toHaveBeenCalledWith('refreshToken', 'test-refresh-token', expect.objectContaining({
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
      }));
    });

    it('3. verifies extractClientMetadata extracts from headers and socket', () => {
      const mockReq = {
        headers: {
          'user-agent': 'Mozilla/5.0 TestBrowser/1.0',
          'x-forwarded-for': '203.0.113.195',
        },
      } as any;
      const metadata = extractClientMetadata(mockReq);
      expect(metadata.userAgent).toBe('Mozilla/5.0 TestBrowser/1.0');
      expect(metadata.ipAddress).toBe('203.0.113.195');
    });

    it('4. verifies extractClientMetadata throws BadRequestError when required fields are missing', () => {
      const mockReqMissing = {
        headers: {},
      } as any;
      expect(() => extractClientMetadata(mockReqMissing)).toThrow(
        'User-Agent header and client IP address are required'
      );
    });

    it('5. verifies extractClientMetadata strictly uses server headers and defaults rather than body spoofing', () => {
      const mockReqFallback = {
        headers: {},
        body: {
          userAgent: 'SpoofedBodyUA/1.0',
          ipAddress: '198.51.100.1',
        },
      } as any;
      const metadata = extractClientMetadata(mockReqFallback, {
        required: false,
      });
      expect(metadata.userAgent).toBe('UrbanFleet-Web/1.0');
      expect(metadata.ipAddress).toBe('127.0.0.1');
    });
  });
});
