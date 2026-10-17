import { z } from 'zod';

const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const locationSchema = z.object({
  address: z.string().min(3),
  coordinates: coordinatesSchema,
});

export const estimateFareSchema = z.object({
  pickup: locationSchema,
  destination: locationSchema,
  vehicleCategory: z.enum(['CAR', 'BIKE', 'AUTO']).optional().default('CAR'),
});

export const requestRideSchema = z.object({
  pickup: locationSchema,
  destination: locationSchema,
  estimatedFare: z.number().int().positive('Estimated fare must be a positive integer in paise'),
  estimatedDistance: z.number().int().positive('Estimated distance must be positive in meters'),
  estimatedDuration: z.number().int().positive('Estimated duration must be positive in seconds'),
  vehicleCategory: z.enum(['CAR', 'BIKE', 'AUTO']).optional().default('CAR'),
});

export const rideIdParamSchema = z.object({
  rideId: z.string().uuid('Invalid ride UUID'),
});

export const startRideSchema = z.object({
  otp: z.string().length(4, 'OTP must be exactly 4 digits'),
});

export const completeRideSchema = z.object({
  actualDistance: z.number().int().positive().optional(),
  actualDuration: z.number().int().positive().optional(),
});

export const cancelRideSchema = z.object({
  reason: z.string().min(2, 'Cancellation reason is required').max(300),
});

export const rateRideSchema = z.object({
  score: z.number().int().min(1).max(5),
  review: z.string().max(500).optional(),
});
