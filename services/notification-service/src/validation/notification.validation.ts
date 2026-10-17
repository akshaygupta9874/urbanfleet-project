import { z } from 'zod';

export const dispatchNotificationSchema = z.object({
  userId: z.string().uuid('Invalid user UUID'),
  channel: z.enum(['EMAIL', 'SMS', 'PUSH', 'IN_APP']),
  type: z.string().min(2),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(1000),
  templateId: z.string().optional(),
  data: z.record(z.unknown()).optional(),
});
