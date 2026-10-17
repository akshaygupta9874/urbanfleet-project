import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { validateRequest, formatZodError } from '../src/middlewares/validate.middleware.js';

describe('validateRequest Zod Middleware', () => {
  it('formats zod errors accurately with field dot-paths', () => {
    const schema = z.object({
      user: z.object({
        email: z.string().email(),
      }),
    });

    const result = schema.safeParse({ user: { email: 'bad-email' } });
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted['user.email']).toBeDefined();
      expect(formatted['user.email'][0]).toContain('email');
    }
  });

  it('passes valid body payload and calls next()', () => {
    const bodySchema = z.object({
      name: z.string().min(2),
      age: z.number().int().positive(),
    });

    const middleware = validateRequest({ body: bodySchema });
    const req: any = { body: { name: 'Alice', age: 25, extra: 'dropped' } };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.body.name).toBe('Alice');
    expect(req.body.age).toBe(25);
  });

  it('rejects invalid request with 422 and structured errors map', () => {
    const bodySchema = z.object({
      email: z.string().email(),
      amount: z.number().min(100),
    });

    const middleware = validateRequest({ body: bodySchema });
    const req: any = { body: { email: 'not-an-email', amount: 50 } };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: 'VALIDATION_ERROR',
        errors: expect.objectContaining({
          email: expect.any(Array),
          amount: expect.any(Array),
        }),
      })
    );
  });

  it('validates query and params parameters concurrently', () => {
    const querySchema = z.object({
      limit: z.coerce.number().min(1).max(50),
    });
    const paramsSchema = z.object({
      id: z.string().uuid(),
    });

    const middleware = validateRequest({ query: querySchema, params: paramsSchema });
    const validReq: any = {
      query: { limit: '20' },
      params: { id: '123e4567-e89b-12d3-a456-426614174000' },
    };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    middleware(validReq, res, next);
    expect(next).toHaveBeenCalled();
    expect(validReq.query.limit).toBe(20); // coerced number
  });
});
