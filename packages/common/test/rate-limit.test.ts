import { describe, it, expect, vi, beforeEach } from 'vitest';
import { slidingWindowRateLimit } from '../src/middlewares/rate-limit.middleware.js';
import { ServiceUnavailableError } from '../src/errors/app-error.js';

describe('Sliding Window Rate Limiter Middleware', () => {
  let mockRedis: any;

  beforeEach(() => {
    mockRedis = {
      isOpen: true,
      eval: vi.fn(),
    };
  });

  it('validates options and rejects invalid limit or window', () => {
    expect(() =>
      slidingWindowRateLimit({ redis: mockRedis, limit: 0, windowSeconds: 60 })
    ).toThrow(RangeError);

    expect(() =>
      slidingWindowRateLimit({ redis: mockRedis, limit: 10, windowSeconds: -5 })
    ).toThrow(RangeError);
  });

  it('allows request when within rate limit and sets appropriate headers', async () => {
    // result: [allowed (1), postCount (1), previousCount (0), elapsedFraction ('0.1')]
    mockRedis.eval.mockResolvedValue([1, 1, 0, '0.1']);

    const limiter = slidingWindowRateLimit({
      redis: mockRedis,
      limit: 10,
      windowSeconds: 60,
    });

    const req: any = { ip: '127.0.0.1', headers: {} };
    const headers: Record<string, string> = {};
    const res: any = {
      setHeader: vi.fn((k, v) => {
        headers[k] = v;
      }),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    let nextCalled = false;

    await limiter(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(res.setHeader).toHaveBeenCalledWith('RateLimit-Limit', '10');
    expect(res.setHeader).toHaveBeenCalledWith('RateLimit-Remaining', '9');
    expect(res.setHeader).toHaveBeenCalledWith('RateLimit-Reset', expect.any(String));
  });

  it('blocks request with 429 when rate limit is exceeded', async () => {
    // result: [allowed (0), currentCount (10), previousCount (5), elapsedFraction ('0.5')]
    mockRedis.eval.mockResolvedValue([0, 10, 5, '0.5']);

    const limiter = slidingWindowRateLimit({
      redis: mockRedis,
      limit: 10,
      windowSeconds: 60,
    });

    const req: any = { ip: '127.0.0.1', headers: {} };
    const res: any = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    let nextCalled = false;

    await limiter(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: 'RATE_LIMIT_EXCEEDED',
      })
    );
  });

  it('fails open when redis is closed and failOpen is true', async () => {
    mockRedis.isOpen = false;

    const limiter = slidingWindowRateLimit({
      redis: mockRedis,
      limit: 10,
      windowSeconds: 60,
      failOpen: true,
    });

    const req: any = { ip: '127.0.0.1' };
    const res: any = {};
    let nextCalled = false;

    await limiter(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
  });

  it('throws ServiceUnavailableError when redis is closed and failOpen is false', async () => {
    mockRedis.isOpen = false;

    const limiter = slidingWindowRateLimit({
      redis: mockRedis,
      limit: 10,
      windowSeconds: 60,
      failOpen: false,
    });

    const req: any = { ip: '127.0.0.1' };
    const res: any = {};
    let nextError: any = null;

    await limiter(req, res, (err) => {
      nextError = err;
    });

    expect(nextError).toBeInstanceOf(ServiceUnavailableError);
    expect(nextError.code).toBe('RATE_LIMITER_REDIS_UNAVAILABLE');
  });
});
