import { z } from 'zod';

export const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const locationSchema = z.object({
  address: z.string().trim().min(1),
  coordinates: coordinatesSchema,
});

export const vehicleCategorySchema = z.preprocess(
  (val: unknown) => (typeof val === 'string' ? val.toUpperCase() : val),
  z.enum(['CAR', 'BIKE', 'AUTO', 'SEDAN']).optional().default('CAR')
);

export const estimateFareSchema = z.object({
  pickup: locationSchema,
  destination: locationSchema,
  vehicleCategory: vehicleCategorySchema,
});

export const requestRideSchema = z.preprocess(
  (val: unknown) => {
    if (val && typeof val === 'object') {
      const obj = val as Record<string, unknown>;
      const rawCategory = obj.vehicleCategory || obj.vehicleType || 'CAR';
      const fareObj = (obj.fare && typeof obj.fare === 'object') ? (obj.fare as Record<string, unknown>) : undefined;
      const rawFare = obj.estimatedFare ?? fareObj?.estimated ?? obj.fare;
      const distObj = (obj.distance && typeof obj.distance === 'object') ? (obj.distance as Record<string, unknown>) : undefined;
      const rawDistance = obj.estimatedDistance ?? distObj?.estimated ?? obj.distance;
      const durObj = (obj.duration && typeof obj.duration === 'object') ? (obj.duration as Record<string, unknown>) : undefined;
      const rawDuration = obj.estimatedDuration ?? durObj?.estimated ?? obj.duration;

      return {
        ...obj,
        vehicleCategory: rawCategory,
        vehicleType: rawCategory,
        estimatedFare: typeof rawFare === 'number' ? Math.round(rawFare) : undefined,
        estimatedDistance: typeof rawDistance === 'number' ? rawDistance : undefined,
        estimatedDuration: typeof rawDuration === 'number' ? Math.round(rawDuration) : undefined,
      };
    }
    return val;
  },
  z.object({
    pickup: locationSchema,
    destination: locationSchema,
    estimatedFare: z.number().optional(),
    estimatedDistance: z.number().optional(),
    estimatedDuration: z.number().optional(),
    vehicleCategory: vehicleCategorySchema,
    vehicleType: vehicleCategorySchema,
    fare: z.unknown().optional(),
    distance: z.unknown().optional(),
    duration: z.unknown().optional(),
    rider: z.string().optional(),
    riderId: z.string().optional(),
  })
);

export const rideIdParamSchema = z.object({
  id: z.string().uuid('Invalid ride UUID'),
});

export const paymentStatusSchema = z.object({
  paymentStatus: z.enum(['PENDING', 'PAID', 'CAPTURED', 'FAILED', 'REFUNDED'], {
    errorMap: () => ({ message: 'Invalid payment status. Must be one of: PENDING, PAID, CAPTURED, FAILED, REFUNDED' }),
  }),
});

export const startRideSchema = z.object({
  otp: z.string().length(4, 'OTP must be exactly 4 digits'),
});

export const completeRideSchema = z.object({
  actualDistance: z.number().int().positive().optional(),
  actualDuration: z.number().int().positive().optional(),
});

export const cancelRideSchema = z.object({
  cancellationReason: z.string().max(300).optional().default('Ride cancelled by user'),
});

export const rateRideSchema = z.object({
  score: z.number().int().min(1, 'Rating must be at least 1').max(5, 'Rating cannot exceed 5'),
  feedback: z.string().max(500).optional().default(''),
});

export type EstimateFareDTO = z.infer<typeof estimateFareSchema>;
export type RequestRideDTO = z.infer<typeof requestRideSchema>;
export type StartRideDTO = z.infer<typeof startRideSchema>;
export type CompleteRideDTO = z.infer<typeof completeRideSchema>;
export type CancelRideDTO = z.infer<typeof cancelRideSchema>;
export type RateRideDTO = z.infer<typeof rateRideSchema>;
export type PaymentStatusDTO = z.infer<typeof paymentStatusSchema>;
