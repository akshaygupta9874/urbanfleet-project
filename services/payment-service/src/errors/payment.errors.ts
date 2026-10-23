import { AppError } from '../utils/AppError.js';

export { AppError };

/**
 * An error that will never succeed on retry (unknown order, amount mismatch,
 * malformed payload ...).
 *
 * - For HTTP callers it behaves exactly like AppError (same status + code).
 * - For webhooks and Kafka consumers it means "acknowledge with 200/commit and alert a human".
 *   Answering with a 4xx/5xx would only make Razorpay or Kafka retry endlessly and can get the
 *   webhook auto-disabled or partition blocked.
 */
export class NonRetryablePaymentError extends AppError {
  constructor(message: string, statusCode = 400, code = 'NON_RETRYABLE_PAYMENT_ERROR', details?: unknown) {
    super(message, statusCode, code, true, details);
  }
}

/** Error thrown when a payment record is not found */
export class PaymentNotFoundError extends AppError {
  constructor(message = 'Payment not found', details?: unknown) {
    super(message, 404, 'PAYMENT_NOT_FOUND', true, details);
  }
}

/** Error thrown when a ride record is not found */
export class RideNotFoundError extends AppError {
  constructor(message = 'Ride not found', details?: unknown) {
    super(message, 404, 'RIDE_NOT_FOUND', true, details);
  }
}

/** Error thrown when payment state conflict occurs (double capture, already refunded, etc.) */
export class PaymentConflictError extends AppError {
  constructor(message: string, code = 'PAYMENT_CONFLICT', details?: unknown) {
    super(message, 409, code, true, details);
  }
}

/** Error thrown when payment cryptographic signature fails validation */
export class PaymentSignatureInvalidError extends AppError {
  constructor(message = 'Invalid payment signature', details?: unknown) {
    super(message, 400, 'INVALID_SIGNATURE', true, details);
  }
}

/** Error thrown when the payment gateway fails or returns an ambiguous error */
export class PaymentGatewayError extends AppError {
  constructor(message = 'Payment gateway error', statusCode = 502, code = 'PAYMENT_GATEWAY_ERROR', details?: unknown) {
    super(message, statusCode, code, true, details);
  }
}

/** Error thrown when fare breakdown does not balance or is missing required fields */
export class InvalidFareBreakdownError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, 'FARE_BREAKDOWN_INVALID', true, details);
  }
}

/** Error thrown when payment amount is negative, zero, or exceeds allowed maximum */
export class PaymentAmountOutOfRangeError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, 'PAYMENT_AMOUNT_OUT_OF_RANGE', true, details);
  }
}

/** Unique-constraint / duplicate-key detector (PostgreSQL 23505, Prisma P2002, or numeric violation code). */
export function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const code = (err as { code?: unknown }).code;
  return code === 'P2002' || code === '23505' || code === 11000 || code === '11000';
}

/**
 * The razorpay SDK rejects with a plain object `{ statusCode, error }` for HTTP
 * errors (it is NOT an Error instance) and with a TypeError for network
 * failures / timeouts.
 *
 * A 4xx means the gateway definitely did NOT perform the operation.
 * Anything else (5xx, timeout, DNS ...) is AMBIGUOUS - the operation may or may
 * not have happened, so callers must not assume either outcome.
 */
export function isGatewayRejection(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }

  const statusCode = Number((err as { statusCode?: unknown }).statusCode);
  return statusCode >= 400 && statusCode < 500;
}

export function describeGatewayError(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const inner = (err as { error?: { description?: unknown } }).error;

    if (inner && typeof inner.description === 'string') {
      return inner.description;
    }

    if (err instanceof Error) {
      return err.message;
    }
  }

  return 'Unknown gateway error';
}
