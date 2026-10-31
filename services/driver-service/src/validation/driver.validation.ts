import { z } from 'zod';

export const createProfileSchema = z.object({
  userId: z.string().uuid('Invalid user UUID').optional(),
  licenseNumber: z.string().min(4).max(50),
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

export const updateProfileSchema = z.object({
  licenseNumber: z.string().min(4).max(50).optional(),
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
  isAvailable: z.boolean().optional(),
  isOnline: z.boolean().optional(),
});

export const uploadDocumentSchema = z.object({
  type: z.enum(['DRIVING_LICENSE', 'REGISTRATION_CERTIFICATE', 'INSURANCE', 'POLLUTION']),
  documentNumber: z.string().min(4).max(50),
  fileUrl: z.string().url('File URL must be a valid URL'),
});

export const driverIdParamSchema = z.object({
  driverId: z.string().uuid('Invalid driver UUID'),
});

export const uuidParamSchema = z.object({
  id: z.string().uuid('Invalid UUID parameter'),
});

export const driverRegistrationSchema = z.object({
  userId: z.string().optional(),
  vehicle: z.object({
    type: z.enum(['CAR', 'BIKE', 'AUTO']),
    brand: z.string().trim().min(1, 'Brand is required'),
    model: z.string().trim().min(1, 'Model is required'),
    color: z.string().trim().min(1, 'Color is required'),
    registrationNumber: z
      .string()
      .trim()
      .min(1, 'Registration number is required')
      .transform((val) => val.toUpperCase()),
    registrationYear: z.coerce
      .number()
      .int()
      .min(1900)
      .max(new Date().getFullYear() + 1),
  }),
  documents: z.object({
    drivingLicense: z.object({
      number: z.string().trim().min(1, 'Driving license number is required'),
      expiryDate: z.coerce.date().optional(),
    }),
    registrationCertificate: z.object({
      number: z
        .string()
        .trim()
        .min(1, 'Registration certificate number is required'),
    }),
    insurance: z.object({
      number: z.string().trim().min(1, 'Insurance number is required'),
      expiryDate: z.coerce.date().optional(),
    }),
    pollutionCertificate: z.object({
      expiryDate: z.coerce.date().optional(),
    }),
    aadhar: z
      .object({
        number: z.string().trim().min(12, 'Valid 12-digit Aadhaar number is required'),
      })
      .optional(),
  }),
  banking: z
    .object({
      accountHolderName: z.string().trim().min(1, 'Account holder name is required'),
      accountNumber: z.string().trim().min(5, 'Account number is required'),
      ifscCode: z.string().trim().min(4, 'IFSC code is required').transform((val) => val.toUpperCase()),
      bankName: z.string().trim().optional(),
      upiId: z.string().trim().min(3, 'Valid UPI ID is required'),
    })
    .optional(),
});

export const updateBankDetailsSchema = z.object({
  accountHolderName: z.string().trim().min(1, 'Account holder name is required'),
  accountNumber: z.string().trim().min(5, 'Account number is required'),
  ifscCode: z.string().trim().min(4, 'IFSC code is required').transform((val) => val.toUpperCase()),
  bankName: z.string().trim().optional(),
  upiId: z.string().trim().min(3, 'Valid UPI ID is required'),
});

export type DriverRegistrationInput = z.infer<typeof driverRegistrationSchema>;
export type UpdateBankDetailsInput = z.infer<typeof updateBankDetailsSchema>;
