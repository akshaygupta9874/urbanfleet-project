
import { describe, it, expect } from 'vitest';

import {
  AppError,
  BadRequestError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  MethodNotAllowedError,
  ConflictError,
  GoneError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  UnprocessableEntityError,
  TooManyRequestsError,
  InternalServerError,
  BadGatewayError,
  ServiceUnavailableError,
  GatewayTimeoutError,
} from '../src/errors/app-error.js';

describe('Application Error Hierarchy', () => {
  describe('AppError', () => {
    it('initializes all properties correctly', () => {
      const error = new AppError(
        'Something went wrong',
        500,
        'INTERNAL_ERROR',
      );

      expect(error.message).toBe('Something went wrong');
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.isOperational).toBe(false);
    });

    it('uses default constructor arguments', () => {
      const error = new AppError('Custom error');

      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.isOperational).toBe(false);
    });

    it('allows explicitly setting operational status', () => {
      const error = new AppError(
        'Expected server-side failure',
        500,
        'CUSTOM_ERROR',
        { isOperational: true },
      );

      expect(error.isOperational).toBe(true);
    });

    it('extends the native Error class', () => {
      const error = new AppError('Test error');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error.name).toBe('AppError');
    });

    it('preserves the error prototype chain', () => {
      const error = new NotFoundError();

      expect(error).toBeInstanceOf(NotFoundError);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(Error);
    });

    it('captures a stack trace', () => {
      const error = new AppError('Stack trace test');

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('Stack trace test');
    });

    it('preserves the supplied cause', () => {
      const cause = new Error('Database connection failed');

      const error = new AppError(
        'Unable to process request',
        500,
        'INTERNAL_ERROR',
        { cause },
      );

      expect(error.cause).toBe(cause);
    });

    it('defaults operational status based on HTTP status', () => {
      expect(new AppError('Client error', 400).isOperational).toBe(true);
      expect(new AppError('Server error', 500).isOperational).toBe(false);
    });
  });

  describe('BadRequestError', () => {
    it('uses the correct defaults', () => {
      const error = new BadRequestError();

      expect(error.message).toBe('Bad request');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('BAD_REQUEST');
      expect(error.isOperational).toBe(true);
    });

    it('accepts a custom message and code', () => {
      const error = new BadRequestError(
        'Invalid request body',
        'INVALID_BODY',
      );

      expect(error.message).toBe('Invalid request body');
      expect(error.code).toBe('INVALID_BODY');
    });
  });

  describe('ValidationError', () => {
    it('uses the correct defaults', () => {
      const error = new ValidationError();

      expect(error.message).toBe('Validation failed');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.errors).toEqual([]);
      expect(error.isOperational).toBe(true);
    });

    it('preserves validation issues', () => {
      const issues = [
        {
          field: 'email',
          message: 'Invalid email address',
          code: 'invalid_format',
        },
        {
          field: 'password',
          message: 'Password is too short',
          code: 'too_small',
        },
      ];

      const error = new ValidationError(
        'Request validation failed',
        issues,
      );

      expect(error.errors).toEqual(issues);
      expect(error.message).toBe('Request validation failed');
      expect(error.statusCode).toBe(400);
    });

    it('supports a custom error code', () => {
      const error = new ValidationError(
        'Invalid registration data',
        [],
        'INVALID_REGISTRATION',
      );

      expect(error.code).toBe('INVALID_REGISTRATION');
    });

    it('extends BadRequestError and AppError', () => {
      const error = new ValidationError();

      expect(error).toBeInstanceOf(ValidationError);
      expect(error).toBeInstanceOf(BadRequestError);
      expect(error).toBeInstanceOf(AppError);
    });
  });

  describe('HTTP error subclasses', () => {
    it.each([
      [BadRequestError, 400, 'Bad request', 'BAD_REQUEST'],
      [UnauthorizedError, 401, 'Unauthorized access', 'UNAUTHORIZED'],
      [ForbiddenError, 403, 'Forbidden access', 'FORBIDDEN'],
      [NotFoundError, 404, 'Resource not found', 'NOT_FOUND'],
      [MethodNotAllowedError, 405, 'HTTP method not allowed', 'METHOD_NOT_ALLOWED'],
      [ConflictError, 409, 'Resource conflict', 'CONFLICT'],
      [GoneError, 410, 'Resource is no longer available', 'GONE'],
      [PayloadTooLargeError, 413, 'Request payload too large', 'PAYLOAD_TOO_LARGE'],
      [UnsupportedMediaTypeError, 415, 'Unsupported media type', 'UNSUPPORTED_MEDIA_TYPE'],
      [UnprocessableEntityError, 422, 'Unable to process the request', 'UNPROCESSABLE_ENTITY'],
      [TooManyRequestsError, 429, 'Too many requests', 'RATE_LIMIT_EXCEEDED'],
      [InternalServerError, 500, 'Internal server error', 'INTERNAL_ERROR'],
      [BadGatewayError, 502, 'Invalid response from upstream service', 'BAD_GATEWAY'],
      [ServiceUnavailableError, 503, 'Service temporarily unavailable', 'SERVICE_UNAVAILABLE'],
      [GatewayTimeoutError, 504, 'Upstream service timed out', 'GATEWAY_TIMEOUT'],
    ] as const)(
      '%s has the correct default status, message and code',
      (ErrorClass, statusCode, message, code) => {
        const error = new ErrorClass();

        expect(error.statusCode).toBe(statusCode);
        expect(error.message).toBe(message);
        expect(error.code).toBe(code);
        expect(error).toBeInstanceOf(AppError);
        expect(error).toBeInstanceOf(Error);
      },
    );

    it.each([
      [BadRequestError, 400],
      [UnauthorizedError, 401],
      [ForbiddenError, 403],
      [NotFoundError, 404],
      [MethodNotAllowedError, 405],
      [ConflictError, 409],
      [GoneError, 410],
      [PayloadTooLargeError, 413],
      [UnsupportedMediaTypeError, 415],
      [UnprocessableEntityError, 422],
      [TooManyRequestsError, 429],
      [InternalServerError, 500],
      [BadGatewayError, 502],
      [ServiceUnavailableError, 503],
      [GatewayTimeoutError, 504],
    ] as const)(
      '%s accepts a custom message and code',
      (ErrorClass, statusCode) => {
        const error = new ErrorClass(
          'Custom error message',
          'CUSTOM_ERROR',
        );

        expect(error.statusCode).toBe(statusCode);
        expect(error.message).toBe('Custom error message');
        expect(error.code).toBe('CUSTOM_ERROR');
      },
    );
  });

  describe('Operational status', () => {
    it('marks client errors as operational by default', () => {
      const errors = [
        new BadRequestError(),
        new UnauthorizedError(),
        new ForbiddenError(),
        new NotFoundError(),
        new ConflictError(),
        new ValidationError(),
        new TooManyRequestsError(),
      ];

      for (const error of errors) {
        expect(error.isOperational).toBe(true);
      }
    });

    it('marks unexpected internal errors as non-operational', () => {
      expect(new InternalServerError().isOperational).toBe(false);
    });

    it('marks upstream errors as operational', () => {
      expect(new BadGatewayError().isOperational).toBe(true);
      expect(new ServiceUnavailableError().isOperational).toBe(true);
      expect(new GatewayTimeoutError().isOperational).toBe(true);
    });
  });

  describe('TooManyRequestsError', () => {
    it('stores the retry-after duration', () => {
      const error = new TooManyRequestsError(
        'Rate limit exceeded',
        60,
      );

      expect(error.retryAfterSeconds).toBe(60);
      expect(error.statusCode).toBe(429);
    });

    it('allows an omitted retry-after duration', () => {
      const error = new TooManyRequestsError();

      expect(error.retryAfterSeconds).toBeUndefined();
    });

    it.each([-1, 1.5, NaN, Infinity])(
      'rejects an invalid retry-after duration: %s',
      (seconds) => {
        expect(
          () => new TooManyRequestsError(
            'Too many requests',
            seconds,
          ),
        ).toThrow(RangeError);
      },
    );

    it('accepts zero seconds', () => {
      const error = new TooManyRequestsError(
        'Retry immediately',
        0,
      );

      expect(error.retryAfterSeconds).toBe(0);
    });
  });

  describe('Upstream error causes', () => {
    it.each([
      BadGatewayError,
      ServiceUnavailableError,
      GatewayTimeoutError,
      InternalServerError,
    ])('%s preserves the underlying cause', (ErrorClass) => {
      const cause = new Error('Underlying failure');
      const error = new ErrorClass(
        'Operation failed',
        'UPSTREAM_FAILURE',
        cause,
      );

      expect(error.cause).toBe(cause);
      expect(error.code).toBe('UPSTREAM_FAILURE');
    });
  });
});
