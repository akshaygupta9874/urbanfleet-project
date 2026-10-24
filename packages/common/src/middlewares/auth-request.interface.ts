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
  userId?: string;
  roles?: string[];
  role?: string[];
  driverId?: string;
  sessionId?: string;
  user?: AuthUser;
  cookies: Record<string, string | undefined>;
}

export function getAuthenticatedUserId(req: AuthenticatedRequest): string {
  const userId = req.userId;
  if (!userId) {
    throw new AppError('Unauthorized: User identity not found on request', 401, 'UNAUTHORIZED');
  }
  return userId;
}
