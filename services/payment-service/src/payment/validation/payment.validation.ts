import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { PaymentStatus } from '../types/payment.types.js';

const ID_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-fA-F]{24})$/;
export const idSchema = z.string().trim().refine((val) => ID_PATTERN.test(val), 'Invalid id');
export const objectIdSchema = idSchema;

/**
 * @deprecated The fare is NEVER taken from the client - the server prices the ride from
 * its own stored fare. Kept only so existing imports keep compiling.
 */
export const fareBreakdownSchema = z.object({
  baseFarePaise: z.number().int().nonnegative(),
  distanceFarePaise: z.number().int().nonnegative(),
  timeFarePaise: z.number().int().nonnegative(),
  surgePaise: z.number().int().nonnegative().default(0),
  platformCommissionPaise: z.number().int().nonnegative(),
  driverEarningPaise: z.number().int().nonnegative(),
  totalPaise: z.number().int().positive(),
});

// Only rideId matters. `driverId`, `fareBreakdown` (and `idempotencyKey`) sent by older
// clients are silently dropped by zod: the server derives all of them itself.
export const createOrderSchema = z.object({
  body: z.object({
    rideId: objectIdSchema,
  }),
});

export const verifyCheckoutSchema = z.object({
  body: z.object({
    razorpay_order_id: z.string().regex(/^order_[A-Za-z0-9]+$/, 'Invalid order id'),
    razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]+$/, 'Invalid payment id'),
    razorpay_signature: z.string().regex(/^[a-fA-F0-9]{64}$/, 'Invalid signature'),
  }),
});

export const refundSchema = z.object({
  body: z.object({
    amountPaise: z.number().int().positive().optional(),
    reason: z.string().min(3).max(500),
  }),
});

export const paymentIdParamSchema = z.object({
  params: z.object({ paymentId: objectIdSchema }),
});

export const rideIdParamSchema = z.object({
  params: z.object({ rideId: objectIdSchema }),
});

export const listPaymentsQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    status: z.nativeEnum(PaymentStatus).optional(),
  }),
});

export function validate(schema : z.ZodType) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse({ body: req.body, params: req.params, query: req.query });
    if (!result.success) {
      const zWithTreeify = z as typeof z & { treeifyError?: (err: z.ZodError) => unknown };
      res.status(422).json({
        message: 'Validation failed',
        errors: typeof zWithTreeify.treeifyError === 'function' ? zWithTreeify.treeifyError(result.error) : result.error.flatten(),
      });
      return;
    }
    const parsed = result.data as { body?: unknown; params?: unknown; query?: unknown };
    if (parsed.body !== undefined) req.body = parsed.body;
    if (parsed.params !== undefined) req.params = parsed.params as typeof req.params;
    if (parsed.query !== undefined) req.query = parsed.query as typeof req.query;

    next();
  };
}
