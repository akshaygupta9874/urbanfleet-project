import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError.js';
import { createLogger } from '@urbanfleet/common';
import { ZodError } from 'zod';

const logger = createLogger('payment-error-handler');

export interface ErrorResponse {
  success: boolean;
  code: string;
  message: string;
  details?: unknown;
  errors?: unknown;
  stack?: string;
}

/**
 * Production-grade Centralized Error Handling Middleware for Payment Service
 * Normalizes all error types (AppError, Zod, Prisma, Axios, SyntaxError, generic)
 * into a structured, consistent JSON error payload without leaking secrets or crashing.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    return next(err);
  }

  // 1. AppError and its domain subclasses (e.g. NonRetryablePaymentError, PaymentNotFoundError)
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error(`[AppError ${err.statusCode}] ${err.code}: ${err.message}`, {
        path: req.originalUrl,
        method: req.method,
        code: err.code,
        details: err.details,
        stack: err.stack,
      });
    } else {
      logger.warn(`[AppError ${err.statusCode}] ${err.code}: ${err.message}`, {
        path: req.originalUrl,
        method: req.method,
        code: err.code,
      });
    }

    const payload: ErrorResponse = {
      success: false,
      code: err.code,
      message: err.message,
    };
    if (err.details !== undefined) {
      payload.details = err.details;
    }
    res.status(err.statusCode).json(payload);
    return;
  }

  // 2. Zod Validation Errors
  if (err instanceof ZodError) {
    logger.warn(`[ValidationError] 422: Request validation failed`, {
      path: req.originalUrl,
      method: req.method,
      issues: err.issues,
    });
    res.status(422).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      errors: err.flatten(),
    });
    return;
  }

  // 3. Prisma Known Request Errors
  const errObj = (typeof err === 'object' && err !== null ? err : {}) as Record<string, unknown>;
  const errCode = typeof errObj.code === 'string' ? errObj.code : undefined;

  if (errCode === 'P2002' || errCode === '23505') {
    const target = (errObj.meta as Record<string, unknown> | undefined)?.target;
    logger.warn(`[DuplicateConflict] 409: Duplicate unique constraint`, { target });
    res.status(409).json({
      success: false,
      code: 'CONFLICT',
      message: 'A resource with this key already exists.',
      details: target ? { fields: target } : undefined,
    });
    return;
  }

  if (errCode === 'P2025') {
    logger.warn(`[RecordNotFound] 404: Prisma record not found`);
    res.status(404).json({
      success: false,
      code: 'NOT_FOUND',
      message: 'Requested record was not found.',
    });
    return;
  }

  if (errCode === 'P2003') {
    logger.warn(`[ForeignKeyViolation] 400: Foreign key constraint failed`);
    res.status(400).json({
      success: false,
      code: 'BAD_REQUEST',
      message: 'Related resource does not exist or invalid reference.',
    });
    return;
  }

  // 4. JSON Syntax Errors (Malformed Body from express.json())
  if (err instanceof SyntaxError && 'status' in err && (err as { status: number }).status === 400 && 'body' in err) {
    logger.warn(`[MalformedJson] 400: Malformed JSON body`);
    res.status(400).json({
      success: false,
      code: 'INVALID_JSON',
      message: 'Malformed JSON payload in request body.',
    });
    return;
  }

  // 5. Downstream Axios Network / Service Errors
  if (errObj.code === 'ECONNABORTED' || (err instanceof Error && err.message.toLowerCase().includes('timeout'))) {
    logger.error(`[DownstreamTimeout] 504: Gateway timeout`, {
      message: err instanceof Error ? err.message : String(err),
    });
    res.status(504).json({
      success: false,
      code: 'GATEWAY_TIMEOUT',
      message: 'Downstream service request timed out.',
    });
    return;
  }

  if (errObj.isAxiosError === true || (typeof errObj.code === 'string' && (errObj.code === 'ECONNREFUSED' || errObj.code === 'ENOTFOUND'))) {
    logger.error(`[DownstreamUnavailable] 503: Network connection refused`, {
      code: errObj.code,
      message: err instanceof Error ? err.message : String(err),
    });
    res.status(503).json({
      success: false,
      code: 'SERVICE_UNAVAILABLE',
      message: 'A required downstream service is temporarily unavailable. Please retry shortly.',
    });
    return;
  }

  // 6. Generic object with statusCode / status (e.g. from Razorpay or custom libraries)
  const statusCode = typeof errObj.statusCode === 'number'
    ? errObj.statusCode
    : typeof errObj.status === 'number'
      ? errObj.status
      : 500;

  const isOperational = errObj.isOperational === true || statusCode < 500;
  const message = typeof errObj.message === 'string'
    ? errObj.message
    : (err instanceof Error ? err.message : 'Internal server error');
  const code = typeof errObj.code === 'string'
    ? errObj.code
    : (statusCode === 404 ? 'NOT_FOUND' : statusCode === 401 ? 'UNAUTHORIZED' : statusCode === 403 ? 'FORBIDDEN' : 'INTERNAL_SERVER_ERROR');

  if (isOperational) {
    res.status(statusCode).json({
      success: false,
      code,
      message,
    });
    return;
  }

  // 7. Unhandled Server Error (500)
  logger.error(`[UnhandledError] 500: Unexpected internal error:`, {
    error: err instanceof Error ? err.stack || err.message : String(err),
    path: req.originalUrl,
    method: req.method,
  });

  res.status(500).json({
    success: false,
    code: 'INTERNAL_SERVER_ERROR',
    message: process.env.NODE_ENV === 'production' ? 'An internal server error occurred.' : message,
  });
}

/**
 * 404 handler for routes not found
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    code: 'ROUTE_NOT_FOUND',
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
}
