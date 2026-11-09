import { z } from 'zod';

export const SocketMessageSchema = z.object({
  event: z.string().min(1, 'Event name cannot be empty.'),
  data: z.unknown().optional(),
});

export type SocketMessageInput = z.infer<typeof SocketMessageSchema>;