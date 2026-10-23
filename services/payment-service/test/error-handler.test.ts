import { describe, it, expect, vi } from 'vitest';
import { errorHandler, notFoundHandler } from '../src/middlewares/errorHandler.js';
import {
  AppError,
  NonRetryablePaymentError,
  PaymentNotFoundError,
  PaymentConflictError,
  PaymentSignatureInvalidError,
  PaymentGatewayError,
  InvalidFareBreakdownError,
  PaymentAmountOutOfRangeError,
} from '../src/errors/payment.errors.js';
import { z, ZodError } from 'zod';

describe('Payment Service Centralized Error Handler Middleware', () => {
  const createMockReqRes = (url = '/api/payments/test', method = 'POST') => {
    const req: any = { originalUrl: url, method, headers: {} };
    const res: any = {
      statusCode: 200,
      headersSent: false,
      body: undefined,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };
    const next = vi.fn();
    return { req, res, next };
  };

  it('delegates to next(err) if headers were already sent', () => {
    const { req, res, next } = createMockReqRes();
    res.headersSent = true;
    const err = new Error('Late failure');

    errorHandler(err, req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });

  it('formats AppError and its domain subclasses correctly', () => {
    const { req, res, next } = createMockReqRes();
    const err = new PaymentNotFoundError('Payment pay-123 not found', { paymentId: 'pay-123' });

    errorHandler(err, req, res, next);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      success: false,
      code: 'PAYMENT_NOT_FOUND',
      message: 'Payment pay-123 not found',
      details: { paymentId: 'pay-123' },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('formats NonRetryablePaymentError as 400 for HTTP callers', () => {
    const { req, res, next } = createMockReqRes();
    const err = new NonRetryablePaymentError('Order mismatch', 400, 'ORDER_MISMATCH');

    errorHandler(err, req, res, next);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      code: 'ORDER_MISMATCH',
      message: 'Order mismatch',
    });
  });

  it('formats ZodError as 422 with validation errors array', () => {
    const { req, res, next } = createMockReqRes();
    const schema = z.object({ amount: z.number().positive() });
    const result = schema.safeParse({ amount: -10 });
    expect(result.success).toBe(false);

    if (!result.success) {
      errorHandler(result.error, req, res, next);
      expect(res.statusCode).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors).toBeDefined();
    }
  });

  it('translates Prisma P2002 duplicate unique key to 409 CONFLICT', () => {
    const { req, res, next } = createMockReqRes();
    const prismaError = {
      code: 'P2002',
      meta: { target: ['idempotency_key'] },
      message: 'Unique constraint failed on the fields: (`idempotency_key`)',
    };

    errorHandler(prismaError, req, res, next);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      success: false,
      code: 'CONFLICT',
      message: 'A resource with this key already exists.',
      details: { fields: ['idempotency_key'] },
    });
  });

  it('translates Prisma P2025 record not found to 404 NOT_FOUND', () => {
    const { req, res, next } = createMockReqRes();
    const prismaError = {
      code: 'P2025',
      message: 'An operation failed because it depends on one or more records that were required but not found.',
    };

    errorHandler(prismaError, req, res, next);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      success: false,
      code: 'NOT_FOUND',
      message: 'Requested record was not found.',
    });
  });

  it('translates Prisma P2003 foreign key violation to 400 BAD_REQUEST', () => {
    const { req, res, next } = createMockReqRes();
    const prismaError = {
      code: 'P2003',
      message: 'Foreign key constraint failed on the field: `payment_id`',
    };

    errorHandler(prismaError, req, res, next);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      code: 'BAD_REQUEST',
      message: 'Related resource does not exist or invalid reference.',
    });
  });

  it('handles body-parser JSON SyntaxError as 400 INVALID_JSON', () => {
    const { req, res, next } = createMockReqRes();
    const syntaxError = new SyntaxError('Unexpected token } in JSON at position 12');
    Object.assign(syntaxError, { status: 400, body: '{"broken":}' });

    errorHandler(syntaxError, req, res, next);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      code: 'INVALID_JSON',
      message: 'Malformed JSON payload in request body.',
    });
  });

  it('handles downstream Axios ECONNREFUSED network failure as 503 SERVICE_UNAVAILABLE', () => {
    const { req, res, next } = createMockReqRes();
    const axiosError = new Error('connect ECONNREFUSED 127.0.0.1:4004');
    Object.assign(axiosError, { isAxiosError: true, code: 'ECONNREFUSED' });

    errorHandler(axiosError, req, res, next);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({
      success: false,
      code: 'SERVICE_UNAVAILABLE',
      message: 'A required downstream service is temporarily unavailable. Please retry shortly.',
    });
  });

  it('handles downstream Axios timeout as 504 GATEWAY_TIMEOUT', () => {
    const { req, res, next } = createMockReqRes();
    const axiosError = new Error('timeout of 5000ms exceeded');
    Object.assign(axiosError, { isAxiosError: true, code: 'ECONNABORTED' });

    errorHandler(axiosError, req, res, next);
    expect(res.statusCode).toBe(504);
    expect(res.body).toEqual({
      success: false,
      code: 'GATEWAY_TIMEOUT',
      message: 'Downstream service request timed out.',
    });
  });

  it('returns clean 500 error for unhandled internal errors without crashing', () => {
    const { req, res, next } = createMockReqRes();
    const unhandledError = new Error('Database pool connection exhaustion');

    errorHandler(unhandledError, req, res, next);
    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('INTERNAL_SERVER_ERROR');
  });

  it('notFoundHandler returns 404 with standard envelope', () => {
    const { req, res } = createMockReqRes('/api/payments/non-existent-endpoint', 'GET');

    notFoundHandler(req, res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      success: false,
      code: 'ROUTE_NOT_FOUND',
      message: 'Cannot GET /api/payments/non-existent-endpoint',
    });
  });
});
