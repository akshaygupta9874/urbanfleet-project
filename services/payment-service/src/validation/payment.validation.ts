import { z } from 'zod';
import { PaymentStatus, PayoutMode } from '../types/payment.types.js';

export const uuidSchema = z.string().trim().uuid({ message: 'Must be a valid UUID' });
export const idSchema = uuidSchema;
export const objectIdSchema = uuidSchema;

export const createOrderSchema = z.object({
  body: z.object({
    rideId: uuidSchema,
  }),
});

export const verifyCheckoutSchema = z.object({
  body: z.object({
    razorpay_order_id: z.string().regex(/^order_[A-Za-z0-9]+$/, 'Invalid order id'),
    razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]+$/, 'Invalid payment id'),
    razorpay_signature: z.string().regex(/^[a-fA-F0-9]{64}$/, 'Invalid signature'),
  }),
});

export const paymentIdParamSchema = z.object({
  params: z.object({ paymentId: uuidSchema }),
});

export const rideIdParamSchema = z.object({
  params: z.object({ rideId: uuidSchema }),
});

export const listPaymentsQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    status: z.nativeEnum(PaymentStatus).optional(),
  }),
});

export const requestPayoutSchema = z.object({
  body: z.object({
    amountPaise: z.coerce.number().int().positive({ message: 'Valid amount in paise is required' }),
    rideId: uuidSchema.optional().nullable(),
    paymentId: uuidSchema.optional().nullable(),
    mode: z.nativeEnum(PayoutMode).optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
});

export const listPayoutsQuerySchema = z.object({
  query: z.object({
    driverId: z.string().trim().optional(),
  }),
});

export const adminMetricsQuerySchema = z.object({
  query: z.object({
    period: z.enum(['24h', '7d', '30d']).default('7d').optional(),
  }),
});

export const adminListPaymentsQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(25),
    status: z.nativeEnum(PaymentStatus).optional(),
    search: z.string().trim().optional(),
  }),
});

export { validate } from '../middlewares/validate.middleware.js';

