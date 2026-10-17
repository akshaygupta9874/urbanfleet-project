import { z } from 'zod';

export const createProfileSchema = z.object({
  userId: z.string().uuid('Invalid user UUID'),
  vehicle: z
    .object({
      type: z.enum(['CAR', 'BIKE', 'AUTO']),
      brand: z.string().min(2),
      model: z.string().min(1),
      registrationNumber: z.string().min(4).max(20),
      registrationYear: z.number().int().min(2000).max(new Date().getFullYear() + 1),
      color: z.string().min(2),
    })
    .optional(),
});

export const updateStatusSchema = z.object({
  isOnline: z.boolean(),
});

export const uploadDocumentSchema = z.object({
  type: z.enum(['DRIVING_LICENSE', 'REGISTRATION_CERTIFICATE', 'INSURANCE', 'POLLUTION']),
  documentNumber: z.string().min(4).max(50),
  fileUrl: z.string().url('File URL must be a valid URL'),
});

export const driverIdParamSchema = z.object({
  driverId: z.string().uuid('Invalid driver UUID'),
});
