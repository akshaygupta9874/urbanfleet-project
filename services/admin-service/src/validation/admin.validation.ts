import { z } from 'zod';

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(),
  status: z.string().trim().optional(),
});

export const analyticsQuerySchema = z.object({
  period: z.enum(['24h', '7d', '30d']).default('7d'),
});

export const driverVerificationSchema = z.object({
  status: z.enum(['PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'APPROVED', 'SUSPENDED']),
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters').max(500),
});

export const userSuspensionSchema = z.object({
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters').max(500),
});

export const refundRequestSchema = z.object({
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters').max(500),
  amountPaise: z.coerce.number().int().positive().optional(),
});

export const systemSettingsSchema = z.object({
  surgeMultiplier: z.coerce.number().min(1.0).max(5.0).default(1.0),
  autoDriverVerification: z.boolean().default(false),
  maintenanceMode: z.boolean().default(false),
  maintenanceNotice: z.string().trim().max(300).default('Scheduled platform maintenance in progress. Services will resume shortly.'),
  sessionTimeoutMins: z.coerce.number().int().min(15).max(10080).default(1440),
  maxActiveRidesPerDriver: z.coerce.number().int().min(1).max(5).default(1),
  reason: z.string().trim().min(3, 'Audit justification must be at least 3 characters').max(500),
});

export const auditLogSchema = z.object({
  action: z.string().trim().min(2).max(100),
  resource: z.string().trim().min(2).max(50),
  resourceId: z.string().max(100).optional(),
  reason: z.string().trim().min(3).max(500),
});

export const idParamSchema = z.object({
  id: z.string().trim().min(1, 'ID is required'),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
export type DriverVerificationInput = z.infer<typeof driverVerificationSchema>;
export type UserSuspensionInput = z.infer<typeof userSuspensionSchema>;
export type RefundRequestInput = z.infer<typeof refundRequestSchema>;
export type SystemSettingsInput = z.infer<typeof systemSettingsSchema>;
export type AuditLogInput = z.infer<typeof auditLogSchema>;
