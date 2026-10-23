import { AppError } from '../utils/AppError.js';

/**
 * An error that will never succeed on retry (unknown order, amount mismatch,
 * malformed payload ...).
 *
 * - For HTTP callers it behaves exactly like AppError (same status + code).
 * - For webhooks it means "acknowledge with 200 and alert a human". Answering
 *   with a 4xx/5xx would only make Razorpay retry for ~24h and can get the
 *   webhook auto-disabled.
 */
export class NonRetryablePaymentError extends AppError {}

/** Unique-constraint / duplicate-key detector (PostgreSQL 23505, Prisma P2002, or numeric violation code). */
export function isDuplicateKeyError(err: unknown): boolean {
    if (typeof err !== "object" || err === null) {
        return false;
    }
    const code = (err as { code?: unknown }).code;
    return code === "P2002" || code === "23505" || code === 11000 || code === "11000";
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
    if (typeof err !== "object" || err === null) {
        return false;
    }

    const statusCode = Number(
        (err as { statusCode?: unknown }).statusCode
    );

    return statusCode >= 400 && statusCode < 500;
}

export function describeGatewayError(err: unknown): string {
    if (typeof err === "object" && err !== null) {
        const inner = (err as { error?: { description?: unknown } }).error;

        if (inner && typeof inner.description === "string") {
            return inner.description;
        }

        if (err instanceof Error) {
            return err.message;
        }
    }

    return "Unknown gateway error";
}
