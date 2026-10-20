import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCookieOptions, getCsrfCookieOptions, clearCookieOptions } from '../src/utils/cookie.js';
import {
  generateCSRFToken,
  verifyCsrfToken,
  revokeCSRFToken,
  refreshCSRFToken,
} from '../src/middlewares/csrf.middleware.js';
import { authRedisClient, authRedisKey } from '../src/redis/client.js';

describe('CSRF Protection & Secure Cookie Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Cookie Security Options', () => {
    it('generates secure httpOnly cookie options for session and refresh tokens', () => {
      const opts = getCookieOptions();
      expect(opts.httpOnly).toBe(true);
      expect(opts.path).toBe('/');
      expect(['lax', 'none']).toContain(opts.sameSite);
    });

    it('generates httpOnly=false cookie options for CSRF tokens to enable client JS access', () => {
      const opts = getCsrfCookieOptions();
      expect(opts.httpOnly).toBe(false);
      expect(opts.path).toBe('/');
      expect(['lax', 'none']).toContain(opts.sameSite);
    });

    it('generates matching path and clear options for cookie revocation on logout', () => {
      const opts = clearCookieOptions();
      expect(opts.path).toBe('/');
      expect(['lax', 'none']).toContain(opts.sameSite);
    });
  });

  describe('CSRF Token Generation & Redis Storage', () => {
    it('generates a 64-character hex CSRF token and sets cookie with httpOnly: false', async () => {
      const setExSpy = vi.spyOn(authRedisClient, 'setEx').mockResolvedValue('OK' as any);
      const mockRes: any = {
        cookie: vi.fn(),
      };

      const token = await generateCSRFToken('user-123', mockRes);

      expect(typeof token).toBe('string');
      expect(token).toHaveLength(64); // 32 bytes in hex = 64 chars
      expect(mockRes.cookie).toHaveBeenCalledWith(
        'csrfToken',
        token,
        expect.objectContaining({
          httpOnly: false,
          path: '/',
        })
      );
      setExSpy.mockRestore();
    });
  });

  describe('verifyCsrfToken Middleware', () => {
    it('skips verification for safe HTTP methods (GET, HEAD, OPTIONS)', async () => {
      const safeMethods = ['GET', 'HEAD', 'OPTIONS'];

      for (const method of safeMethods) {
        const req: any = { method };
        const res: any = {};
        const next = vi.fn();

        await verifyCsrfToken(req, res, next);
        expect(next).toHaveBeenCalledWith();
      }
    });

    it('rejects state-changing request if user is not authenticated', async () => {
      const req: any = { method: 'POST', headers: {} };
      const res: any = {};
      const next = vi.fn();

      await verifyCsrfToken(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
        })
      );
    });

    it('rejects state-changing request if CSRF header is missing', async () => {
      const req: any = {
        method: 'POST',
        userId: 'user-123',
        headers: {},
      };
      const res: any = {};
      const next = vi.fn();

      await verifyCsrfToken(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'CSRF_TOKEN_MISSING',
          statusCode: 403,
        })
      );
    });

    it('rejects request if CSRF token in header does not match Redis stored token', async () => {
      const getSpy = vi.spyOn(authRedisClient, 'get').mockResolvedValue('expected-valid-token' as any);
      vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(true);

      const req: any = {
        method: 'POST',
        userId: 'user-123',
        headers: { 'x-csrf-token': 'wrong-token' },
      };
      const res: any = {};
      const next = vi.fn();

      await verifyCsrfToken(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'CSRF_TOKEN_INVALID',
          statusCode: 403,
        })
      );
      getSpy.mockRestore();
    });

    it('rejects request if CSRF token in Redis has expired', async () => {
      const getSpy = vi.spyOn(authRedisClient, 'get').mockResolvedValue(null as any);
      vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(true);

      const req: any = {
        method: 'POST',
        userId: 'user-123',
        headers: { 'x-csrf-token': 'some-expired-token' },
      };
      const res: any = {};
      const next = vi.fn();

      await verifyCsrfToken(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'CSRF_TOKEN_EXPIRED',
          statusCode: 403,
        })
      );
      getSpy.mockRestore();
    });

    it('passes state-changing request when x-csrf-token matches Redis token', async () => {
      const validToken = 'valid-matched-token-12345';
      const getSpy = vi.spyOn(authRedisClient, 'get').mockResolvedValue(validToken as any);
      vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(true);

      const req: any = {
        method: 'POST',
        userId: 'user-123',
        headers: { 'x-csrf-token': validToken },
      };
      const res: any = {};
      const next = vi.fn();

      await verifyCsrfToken(req, res, next);
      expect(next).toHaveBeenCalledWith();
      getSpy.mockRestore();
    });

    it('enforces canonical x-csrf-token and rejects legacy csrf-token header', async () => {
      const validToken = 'valid-matched-token-67890';
      const getSpy = vi.spyOn(authRedisClient, 'get').mockResolvedValue(validToken as any);
      vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(true);

      const req: any = {
        method: 'PUT',
        userId: 'user-123',
        headers: { 'csrf-token': validToken },
      };
      const res: any = {};
      const next = vi.fn();

      await verifyCsrfToken(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'CSRF_TOKEN_MISSING',
          statusCode: 403,
        })
      );
      getSpy.mockRestore();
    });
  });

  describe('CSRF Token Revocation & Rotation', () => {
    it('revokes CSRF token by deleting Redis key and clearing cookie', async () => {
      const delSpy = vi.spyOn(authRedisClient, 'del').mockResolvedValue(1 as any);
      vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(true);
      const mockRes: any = { clearCookie: vi.fn() };

      await revokeCSRFToken('user-123', mockRes);

      expect(delSpy).toHaveBeenCalledWith(authRedisKey('csrf:user-123'));
      expect(mockRes.clearCookie).toHaveBeenCalledWith('csrfToken', expect.any(Object));
      delSpy.mockRestore();
    });

    it('rotates CSRF token by deleting old and generating new token', async () => {
      const delSpy = vi.spyOn(authRedisClient, 'del').mockResolvedValue(1 as any);
      const setExSpy = vi.spyOn(authRedisClient, 'setEx').mockResolvedValue('OK' as any);
      vi.spyOn(authRedisClient, 'isOpen', 'get').mockReturnValue(true);
      const mockRes: any = { cookie: vi.fn(), clearCookie: vi.fn() };

      const newToken = await refreshCSRFToken('user-123', mockRes);

      expect(delSpy).toHaveBeenCalledWith(authRedisKey('csrf:user-123'));
      expect(setExSpy).toHaveBeenCalledWith(authRedisKey('csrf:user-123'), expect.any(Number), newToken);
      expect(mockRes.cookie).toHaveBeenCalledWith('csrfToken', newToken, expect.any(Object));

      delSpy.mockRestore();
      setExSpy.mockRestore();
    });
  });
});
