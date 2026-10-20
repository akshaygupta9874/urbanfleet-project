import { z } from 'zod';
import { coordinatesSchema } from '../../validation/ride.validation.js';

export const UpdateDriverLocationSchema = coordinatesSchema;

export type UpdateDriverLocationInput = z.infer<typeof UpdateDriverLocationSchema>;

export const DriverHeartbeatSchema = z.object({}).passthrough();

export const DriverAvailabilitySchema = z.object({
  available: z.boolean().optional(),
});

export const RideActionSchema = z.object({
  rideId: z.string().min(1),
});

export const AcceptRideSchema = RideActionSchema;

export const StartRideSchema = RideActionSchema.extend({
  otp: z.string().regex(/^\d{4}$/, 'OTP must be a 4-digit code'),
});

export const RideCancelSchema = z.object({
  rideId: z.string().min(1),
  reason: z.string().optional().default('Cancelled by driver'),
});
