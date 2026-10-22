import { z } from 'zod';

// 1. UserRegistered Event
export const UserRegisteredPayloadSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  roles: z.array(z.enum(['RIDER', 'DRIVER', 'ADMIN'])).optional(),
});
export type UserRegisteredPayload = z.infer<typeof UserRegisteredPayloadSchema>;

// 2. DriverVerified Event
export const DriverVerifiedPayloadSchema = z.object({
  driverProfileId: z.string().uuid(),
  userId: z.string().uuid(),
  licenseNumber: z.string(),
  verifiedAt: z.string().datetime()
});
export type DriverVerifiedPayload = z.infer<typeof DriverVerifiedPayloadSchema>;

// 3. RideCompleted Event
export const RideCompletedPayloadSchema = z.object({
  rideId: z.string().uuid(),
  riderId: z.string().uuid(),
  driverId: z.string().uuid(),
  totalFarePaise: z.number().int().positive(),
  baseFarePaise: z.number().int().positive(),
  surgeMultiplier: z.number().positive(),
  distanceKm: z.number().positive(),
  durationMinutes: z.number().int().positive(),
  driverEarningPaise: z.number().int().nonnegative(),
  platformCommissionPaise: z.number().int().nonnegative(),
  completedAt: z.string().datetime()
});
export type RideCompletedPayload = z.infer<typeof RideCompletedPayloadSchema>;

// 4. RideCancelled Event
export const RideCancelledPayloadSchema = z.object({
  rideId: z.string().uuid(),
  riderId: z.string().uuid(),
  driverId: z.string().uuid().optional(),
  cancelledBy: z.string(),
  cancellationReason: z.string().optional(),
  cancellationFeePaise: z.number().int().nonnegative().optional(),
  cancelledAt: z.string().datetime()
});
export type RideCancelledPayload = z.infer<typeof RideCancelledPayloadSchema>;

// 5. PaymentCaptured Event
export const PaymentCapturedPayloadSchema = z.object({
  paymentId: z.string().uuid(),
  rideId: z.string().uuid(),
  riderId: z.string().uuid(),
  driverId: z.string().uuid().optional(),
  amountPaise: z.number().int().positive(),
  gatewayPaymentId: z.string(),
  capturedAt: z.string().datetime()
});
export type PaymentCapturedPayload = z.infer<typeof PaymentCapturedPayloadSchema>;

// 6. PaymentRefunded Event
export const PaymentRefundedPayloadSchema = z.object({
  refundId: z.string().uuid(),
  paymentId: z.string().uuid(),
  rideId: z.string().uuid(),
  amountPaise: z.number().int().positive(),
  reason: z.string().optional(),
  gatewayRefundId: z.string().optional(),
  refundedAt: z.string().datetime()
});
export type PaymentRefundedPayload = z.infer<typeof PaymentRefundedPayloadSchema>;
