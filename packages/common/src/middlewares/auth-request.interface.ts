import { Request } from 'express';
import { AppError } from '../errors/app-error.js';

export interface AuthUser {
  userId: string;
  email: string;
  roles: string[];
  driverId?: string;
  firstName: string;
  lastName: string;
}

export interface AuthenticatedRequest extends Request {
  userId: string;
  roles: string[];
  driverId?: string;
  sessionId: string;
  user: AuthUser;
  cookies: Record<string, string | undefined>;
}

export function getAuthenticatedUserId(req: AuthenticatedRequest): string {
  return req.userId;
}
