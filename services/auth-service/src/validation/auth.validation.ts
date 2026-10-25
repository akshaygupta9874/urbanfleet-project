import { z } from 'zod';

export const registerSchema = z.object({
  firstName: z.string().min(2, 'First name must be at least 2 characters').max(50),
  lastName: z.string().min(1, 'Last name must be at least 1 character').max(50),
  email: z.string().email('Invalid email address format'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  roles: z.array(z.enum(['RIDER', 'DRIVER'])).optional().default(['RIDER']),
  userAgent: z.string({ required_error: 'User agent is required' }).min(1, 'User agent is required').max(1000),
  ipAddress: z.string({ required_error: 'IP address is required' }).ip('Invalid IP address format'),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address format'),
  password: z.string().min(1, 'Password is required'),
});

export const verifyOtpSchema = z.object({
  email: z.string().email('Invalid email address format'),
  otp: z.string().min(4, 'OTP must be at least 4 digits').max(8, 'OTP must be at most 8 digits'),
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

export const googleAuthSchema = z.object({
  credential: z.string().min(10, 'A valid Google credential token is required'),
  roles: z.array(z.enum(['RIDER', 'DRIVER'])).optional(),
  role: z.enum(['RIDER', 'DRIVER']).optional(),
  userAgent: z.string().optional(),
  ipAddress: z.string().optional(),
});
