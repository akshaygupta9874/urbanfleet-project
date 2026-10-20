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
  otp: z.string().optional(),
});

export const RideCancelSchema = z.object({
  rideId: z.string().min(1),
  reason: z.string().optional().default('Cancelled by driver'),
});
