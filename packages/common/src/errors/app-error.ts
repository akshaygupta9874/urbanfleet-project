
export type ValidationIssue = {
  field?: string;
  message: string;
  code?: string;
};

export type AppErrorOptions = {
  code?: string;
  isOperational?: boolean;
  cause?: unknown;
};

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly code: string;
  public readonly cause?: unknown;

  constructor(
    message: string,
    statusCode = 500,
    code = 'INTERNAL_ERROR',
    options: Omit<AppErrorOptions, 'code'> = {},
  ) {
    super(message);

    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = options.isOperational ?? statusCode < 500;
    this.cause = options.cause;

    Object.setPrototypeOf(this, new.target.prototype);

    Error.captureStackTrace?.(this, new.target);
  }
}

// 400 — Bad request
export class BadRequestError extends AppError {
  constructor(
    message = 'Bad request',
    code = 'BAD_REQUEST',
    options: Omit<AppErrorOptions, 'code'> = {},
  ) {
    super(message, 400, code, options);
  }
}

// 400 — Invalid input
export class ValidationError extends BadRequestError {
  public readonly errors: readonly ValidationIssue[];

  constructor(
    message = 'Validation failed',
    errors: ValidationIssue[] = [],
    code = 'VALIDATION_ERROR',
  ) {
    super(message, code);
    this.errors = errors;
  }
}

// 401 — Authentication is missing or invalid
export class UnauthorizedError extends AppError {
  constructor(
    message = 'Unauthorized access',
    code = 'UNAUTHORIZED',
  ) {
    super(message, 401, code);
  }
}

// 403 — Authenticated, but not permitted
export class ForbiddenError extends AppError {
  constructor(
    message = 'Forbidden access',
    code = 'FORBIDDEN',
  ) {
    super(message, 403, code);
  }
}

// 404 — Resource does not exist
export class NotFoundError extends AppError {
  constructor(
    message = 'Resource not found',
    code = 'NOT_FOUND',
  ) {
    super(message, 404, code);
  }
}

// 405 — HTTP method is not supported
export class MethodNotAllowedError extends AppError {
  constructor(
    message = 'HTTP method not allowed',
    code = 'METHOD_NOT_ALLOWED',
  ) {
    super(message, 405, code);
  }
}

// 409 — Conflicting state or duplicate resource
export class ConflictError extends AppError {
  constructor(
    message = 'Resource conflict',
    code = 'CONFLICT',
  ) {
    super(message, 409, code);
  }
}

// 410 — Resource is no longer available
export class GoneError extends AppError {
  constructor(
    message = 'Resource is no longer available',
    code = 'GONE',
  ) {
    super(message, 410, code);
  }
}

// 413 — Request body is too large
export class PayloadTooLargeError extends AppError {
  constructor(
    message = 'Request payload too large',
    code = 'PAYLOAD_TOO_LARGE',
  ) {
    super(message, 413, code);
  }
}

// 415 — Unsupported request content type
export class UnsupportedMediaTypeError extends AppError {
  constructor(
    message = 'Unsupported media type',
    code = 'UNSUPPORTED_MEDIA_TYPE',
  ) {
    super(message, 415, code);
  }
}

// 422 — Syntax is valid, but instructions cannot be processed
export class UnprocessableEntityError extends AppError {
  constructor(
    message = 'Unable to process the request',
    code = 'UNPROCESSABLE_ENTITY',
  ) {
    super(message, 422, code);
  }
}

// 429 — Rate limit exceeded
export class TooManyRequestsError extends AppError {
  public readonly retryAfterSeconds?: number;

  constructor(
    message = 'Too many requests',
    retryAfterSeconds?: number | string,
    code = 'RATE_LIMIT_EXCEEDED',
  ) {
    if (typeof retryAfterSeconds === 'string') {
      code = retryAfterSeconds;
      retryAfterSeconds = undefined;
    }
    super(message, 429, code);

    if (
      retryAfterSeconds !== undefined &&
      (!Number.isInteger(retryAfterSeconds) ||
        retryAfterSeconds < 0)
    ) {
      throw new RangeError(
        'retryAfterSeconds must be a non-negative integer',
      );
    }

    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// 500 — Unexpected internal failure
export class InternalServerError extends AppError {
  constructor(
    message = 'Internal server error',
    code = 'INTERNAL_ERROR',
    cause?: unknown,
  ) {
    super(message, 500, code, {
      isOperational: false,
      cause,
    });
  }
}

// 502 — Invalid response from an upstream service
export class BadGatewayError extends AppError {
  constructor(
    message = 'Invalid response from upstream service',
    code = 'BAD_GATEWAY',
    cause?: unknown,
  ) {
    super(message, 502, code, {
      isOperational: true,
      cause,
    });
  }
}

// 503 — Service is temporarily unavailable
export class ServiceUnavailableError extends AppError {
  constructor(
    message = 'Service temporarily unavailable',
    code = 'SERVICE_UNAVAILABLE',
    cause?: unknown,
  ) {
    super(message, 503, code, {
      isOperational: true,
      cause,
    });
  }
}

// 504 — Upstream service did not respond in time
export class GatewayTimeoutError extends AppError {
  constructor(
    message = 'Upstream service timed out',
    code = 'GATEWAY_TIMEOUT',
    cause?: unknown,
  ) {
    super(message, 504, code, {
      isOperational: true,
      cause,
    });
  }
}
