import { describe, it, expect, vi } from 'vitest';
import { asyncHandler, normalizeError } from '../src/middlewares/async-handler.middleware.js';

describe('Robust AsyncHandler Middleware Suite', () => {
  it('successfully executes async route handler without error', async () => {
    const req: any = { method: 'GET', url: '/test' };
    const res: any = { headersSent: false, json: vi.fn() };
    const next = vi.fn();

    const handler = asyncHandler(async (rq, rs) => {
      rs.json({ success: true });
    });

    await handler(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(next).not.toHaveBeenCalled();
  });

  it('catches asynchronous Promise rejection and routes to next(err)', async () => {
    const req: any = { method: 'POST', url: '/error' };
    const res: any = { headersSent: false };
    const next = vi.fn();

    const testError = new Error('Database transaction deadlocked');
    const handler = asyncHandler(async () => {
      await Promise.resolve();
      throw testError;
    });

    await handler(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(testError);
  });

  it('catches synchronous exception thrown before any await yields', async () => {
    const req: any = { method: 'POST', url: '/sync-error' };
    const res: any = { headersSent: false };
    const next = vi.fn();

    const testError = new Error('Synchronous parsing fault');
    const handler = asyncHandler(() => {
      throw testError;
    });

    handler(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(testError);
  });

  it('normalizes string rejections into standard Error objects', async () => {
    const req: any = { method: 'GET', url: '/string-err' };
    const res: any = { headersSent: false };
    const next = vi.fn();

    const handler = asyncHandler(async () => {
      throw 'string rejection failure';
    });

    await handler(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const passedErr = next.mock.calls[0][0];
    expect(passedErr).toBeInstanceOf(Error);
    expect(passedErr.message).toBe('string rejection failure');
  });

  it('normalizes object rejections into standard Error objects with assigned properties', async () => {
    const req: any = { method: 'GET', url: '/obj-err' };
    const res: any = { headersSent: false };
    const next = vi.fn();

    const handler = asyncHandler(async () => {
      throw { code: 'CUSTOM_ERR', statusCode: 400, message: 'Custom object rejection' };
    });

    await handler(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const passedErr = next.mock.calls[0][0];
    expect(passedErr).toBeInstanceOf(Error);
    expect(passedErr.message).toBe('Custom object rejection');
    expect(passedErr.code).toBe('CUSTOM_ERR');
  });

  it('does not attempt execution if client aborted or stream already ended', async () => {
    const req: any = { method: 'GET', url: '/aborted', destroyed: true };
    const res: any = { headersSent: true, writableEnded: true };
    const next = vi.fn();
    const mockAction = vi.fn();

    const handler = asyncHandler(async () => {
      mockAction();
    });

    await handler(req, res, next);

    expect(mockAction).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('preserves function name descriptor for tracing and APM', () => {
    async function mySpecificControllerAction() {}
    const handler = asyncHandler(mySpecificControllerAction);
    expect(handler.name).toBe('mySpecificControllerAction');
  });
});
