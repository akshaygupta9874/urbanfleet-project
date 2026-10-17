import { z } from 'zod';

const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
}).refine(
  (c) => (c.latitude !== undefined || c.lat !== undefined) && (c.longitude !== undefined || c.lng !== undefined),
  { message: 'Coordinates must contain latitude/lat and longitude/lng' }
);

export const locationSchema = z.object({
  address: z.string().optional().default('Unknown Location'),
  coordinates: coordinatesSchema.optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
}).refine(
  (data) => {
    const lat = data.lat ?? data.latitude ?? data.coordinates?.lat ?? data.coordinates?.latitude;
    const lng = data.lng ?? data.longitude ?? data.coordinates?.lng ?? data.coordinates?.longitude;
    return lat !== undefined && lng !== undefined;
  },
  { message: 'Valid latitude and longitude are required' }
);

export interface NormalizedLocation {
  lat: number;
  lng: number;
  address: string;
}

export function normalizeLocation(input: any): NormalizedLocation {
  if (!input) {
    throw new Error('Location is required');
  }
  const lat =
    input.lat ??
    input.latitude ??
    input.coordinates?.lat ??
    input.coordinates?.latitude;
  const lng =
    input.lng ??
    input.longitude ??
    input.coordinates?.lng ??
    input.coordinates?.longitude;
  const address = input.address || 'Unknown Location';

  return {
    lat: Number(lat),
    lng: Number(lng),
    address: String(address),
  };
}

export const vehicleCategorySchema = z.preprocess(
  (val) => (typeof val === 'string' ? val.toUpperCase() : val),
  z.enum(['CAR', 'BIKE', 'AUTO', 'SEDAN']).optional().default('CAR')
);

export const estimateFareSchema = z.object({
  pickup: locationSchema,
  destination: locationSchema,
  vehicleCategory: vehicleCategorySchema,
});

export const requestRideSchema = z.object({
  pickup: locationSchema,
  destination: locationSchema,
  estimatedFare: z.number().int().positive('Estimated fare must be a positive integer in paise').optional(),
  estimatedDistance: z.number().positive('Estimated distance must be positive in meters').optional(),
  estimatedDuration: z.number().int().positive('Estimated duration must be positive in seconds').optional(),
  vehicleCategory: vehicleCategorySchema,
});

export const rideIdParamSchema = z.object({
  id: z.string().uuid('Invalid ride UUID').optional(),
  rideId: z.string().uuid('Invalid ride UUID').optional(),
}).refine((data) => !!(data.id || data.rideId), {
  message: 'Valid ride UUID is required in path parameters',
  path: ['id'],
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
  reason: z.string().min(2, 'Cancellation reason is required').max(300),
});

export const rateRideSchema = z.object({
  score: z.number().int().min(1, 'Rating must be at least 1').max(5, 'Rating cannot exceed 5'),
  review: z.string().max(500).optional(),
  feedback: z.string().max(500).optional(),
});
