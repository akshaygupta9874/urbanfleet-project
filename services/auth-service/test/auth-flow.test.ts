import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import express from 'express';
import { createAuthRouter } from '../src/routes/auth.routes.js';
import { signAccessToken } from '../src/crypto/keys.js';

describe('Auth Service Validation & Route Flow Integration Suite', () => {
  let app: express.Express;
  let server: http.Server;
  let baseUrl: string;
  let mockAuthController: any;

  beforeAll(async () => {
    mockAuthController = {
      register: vi.fn(async (req, res) => {
        res.status(201).json({
          success: true,
          message: 'User registered successfully. Please verify your email before logging in.',
          data: { user: { id: 'usr-1', email: req.body.email, isEmailVerified: false } },
        });
      }),
      login: vi.fn(async (req, res) => {
        res.status(200).json({
          success: true,
          data: { requiresOtp: true, message: 'OTP sent' },
        });
      }),
      googleAuth: vi.fn(async (req, res) => {
        res.status(200).json({
          success: true,
          message: 'Signed in with Google successfully.',
          accessToken: 'act_google_test',
          user: { id: 'usr-google', email: 'google@test.com' },
        });
      }),
      verifyOtp: vi.fn(async (req, res) => {
        res.status(200).json({
          success: true,
          data: { tokens: { accessToken: 'act_verified', refreshToken: 'rft_verified' } },
        });
      }),
      verifyEmail: vi.fn(async (req, res) => {
        res.status(200).json({ success: true, message: 'Email verified' });
      }),
      refreshToken: vi.fn(async (req, res) => {
        res.status(200).json({ success: true, data: { accessToken: 'act_refreshed' } });
      }),
      logout: vi.fn(async (req, res) => {
        res.status(200).json({ success: true, message: 'Logged out' });
      }),
      getProfile: vi.fn(async (req, res) => {
        if (!req.headers.authorization) {
          return res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Not authorized' });
        }
        res.status(200).json({ success: true, data: { id: 'usr-1', email: 'test@example.com' } });
      }),
      getUserById: vi.fn(async (req, res) => {
        res.status(200).json({ success: true, data: { id: req.params.id, email: 'test@example.com' } });
      }),
    };

    app = express();
    app.use(express.json());
    app.use('/v1/auth', createAuthRouter(mockAuthController));

    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}/v1/auth`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  describe('1. Zod Registration Validation Middleware', () => {
    it('rejects registration with invalid email format', async () => {
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'not-an-email',
          password: 'Password123!',
          firstName: 'John',
          lastName: 'Doe',
          userAgent: 'Mozilla/5.0',
          ipAddress: '127.0.0.1',
        }),
      });

      const body = await res.json() as any;
      expect(res.status).toBe(422);
      expect(body.errors.email).toBeDefined();
    });

    it('rejects registration with weak password (missing number)', async () => {
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'john.doe@example.com',
          password: 'PasswordWithoutNumbers!',
          firstName: 'John',
          lastName: 'Doe',
          userAgent: 'Mozilla/5.0',
          ipAddress: '127.0.0.1',
        }),
      });

      const body = await res.json() as any;
      expect(res.status).toBe(422);
      expect(body.errors.password).toBeDefined();
    });

    it('rejects registration with short first name (< 2 characters)', async () => {
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'john.doe@example.com',
          password: 'Password123!',
          firstName: 'J',
          lastName: 'Doe',
          userAgent: 'Mozilla/5.0',
          ipAddress: '127.0.0.1',
        }),
      });

      const body = await res.json() as any;
      expect(res.status).toBe(422);
      expect(body.errors.firstName).toBeDefined();
    });

    it('rejects registration when userAgent is missing from request body', async () => {
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'john.doe@example.com',
          password: 'Password123!',
          firstName: 'John',
          lastName: 'Doe',
          ipAddress: '127.0.0.1',
        }),
      });

      const body = await res.json() as any;
      expect(res.status).toBe(422);
      expect(body.errors.userAgent).toBeDefined();
    });

    it('rejects registration when ipAddress is missing or has invalid format', async () => {
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'john.doe@example.com',
          password: 'Password123!',
          firstName: 'John',
          lastName: 'Doe',
          userAgent: 'Mozilla/5.0',
          ipAddress: 'not-an-ip-address',
        }),
      });

      const body = await res.json() as any;
      expect(res.status).toBe(422);
      expect(body.errors.ipAddress).toBeDefined();
    });

    it('passes registration without tokens when all validation criteria are met', async () => {
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'john.doe@example.com',
          password: 'Password123!',
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
      expect(mockAuthController.register).toHaveBeenCalled();
      expect(body.data?.tokens).toBeUndefined();
    });
  });

  describe('2. Zod Login & OTP Validation Middleware', () => {
    it('rejects login with missing email or password', async () => {
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const body = await res.json() as any;
      expect(res.status).toBe(422);
      expect(body.errors.email).toBeDefined();
      expect(body.errors.password).toBeDefined();
    });

    it('passes login when email and password are provided', async () => {
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'john.doe@example.com',
          password: 'Password123!',
        }),
      });

      const body = await res.json() as any;
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(mockAuthController.login).toHaveBeenCalled();
    });

    it('rejects verify-otp with invalid OTP length or format', async () => {
      const res = await fetch(`${baseUrl}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'john.doe@example.com',
          otp: '1',
        }),
      });

      const body = await res.json() as any;
      expect(res.status).toBe(422);
      expect(body.errors.otp).toBeDefined();
    });

    it('passes verify-otp when email and 6-digit OTP are valid', async () => {
      const res = await fetch(`${baseUrl}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'john.doe@example.com',
          otp: '123456',
        }),
      });

      const body = await res.json() as any;
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(mockAuthController.verifyOtp).toHaveBeenCalled();
    });
  });

  describe('3. Token Verification, Profile, and Lifecycle', () => {
    it('rejects verification with token that is too short', async () => {
      const res = await fetch(`${baseUrl}/verify/ab`, {
        method: 'POST',
      });

      const body = await res.json() as any;
      expect(res.status).toBe(422);
      expect(body.errors.token).toBeDefined();
    });

    it('passes verification with valid token param format', async () => {
      const res = await fetch(`${baseUrl}/verify/valid-token-12345`, {
        method: 'POST',
      });

      const body = await res.json() as any;
      expect(res.status).toBe(200);
      expect(mockAuthController.verifyEmail).toHaveBeenCalled();
    });

    it('rejects unauthenticated profile request without bearer token', async () => {
      const res = await fetch(`${baseUrl}/me`, {
        method: 'GET',
      });

      const body = await res.json() as any;
      expect(res.status).toBe(401);
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('fetches authenticated user profile when Bearer token is provided', async () => {
      const validToken = signAccessToken({ userId: 'usr-1', email: 'test@example.com', firstName: 'Test', lastName: 'User', roles: ['RIDER'] });
      const res = await fetch(`${baseUrl}/me`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${validToken}` },
      });

      const body = await res.json() as any;
      expect(res.status).toBe(200);
      expect(body.data.email).toBe('test@example.com');
    });
  });
});
