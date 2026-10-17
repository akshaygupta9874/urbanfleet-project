import { z } from 'zod';

export const registerSchema = z
  .object({
    firstName: z.string().min(2, 'First name must be at least 2 characters').max(50).optional(),
    lastName: z.string().min(2, 'Last name must be at least 2 characters').max(50).optional(),
    fullName: z.string().min(2, 'Full name must be at least 2 characters').max(100).optional(),
    email: z.string().email('Invalid email address format'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters long')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
    role: z.enum(['RIDER', 'DRIVER', 'ADMIN']).optional(),
    roles: z.array(z.enum(['RIDER', 'DRIVER', 'ADMIN'])).optional().default(['RIDER']),
  })
  .superRefine((data, ctx) => {
    if (!data.fullName && (!data.firstName || !data.lastName)) {
      if (!data.firstName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'First name is required',
          path: ['firstName'],
        });
      }
      if (!data.lastName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Last name is required',
          path: ['lastName'],
        });
      }
    }
  });

export const loginSchema = z.object({
  email: z.string().email('Invalid email address format'),
  password: z.string().min(1, 'Password is required'),
});

export const verifyOtpSchema = z.union([
  z
    .object({
      challengeToken: z.string().min(1, 'Challenge token is required'),
      token: z.string().min(4).max(8).optional(),
      code: z.string().min(4).max(8).optional(),
      otp: z.string().min(4).max(8).optional(),
      recoveryCode: z.string().min(6).optional(),
    })
    .refine((data) => !!(data.token || data.code || data.otp || data.recoveryCode), {
      message: 'Either a TOTP verification code or recovery code must be provided',
      path: ['code'],
    }),
  z
    .object({
      email: z.string().email('Invalid email address format').optional(),
      userId: z.string().optional(),
      otp: z.string().min(4, 'OTP must be at least 4 digits').max(8).optional(),
      token: z.string().min(4).max(8).optional(),
      code: z.string().min(4).max(8).optional(),
      recoveryCode: z.string().min(6).optional(),
    })
    .refine((data) => !!(data.otp || data.token || data.code || data.recoveryCode), {
      message: 'Verification code, OTP, or recovery code is required',
      path: ['code'],
    }),
]);

export const verify2FASchema = z.object({
  token: z.string().min(6, 'TOTP code must be 6 digits').max(8),
});

export const disable2FASchema = z.object({
  password: z.string().min(1, 'Password is required to disable 2FA'),
  code: z.string().optional(),
});

export const regenerateRecoveryCodesSchema = z.object({
  password: z.string().min(1, 'Password is required to regenerate recovery codes'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(10, 'Valid refresh token required').optional(),
});

export const verifyTokenParamSchema = z.object({
  token: z.string().min(5, 'Valid verification token required'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address format'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
});

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters long')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
});

export const resendVerificationSchema = z.object({
  email: z.string().email('Invalid email address format'),
});

