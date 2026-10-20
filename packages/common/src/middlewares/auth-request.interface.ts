import { Request } from 'express';
import { AppError } from '../errors/app-error.js';

export interface AuthUser {
  id: string;
  userId: string;
  email?: string;
  role?: string;
  roles?: string[];
  driverId?: string;
  firstName?: string;
  lastName?: string;
  [key: string]: unknown;
}

export interface AuthenticatedRequest extends Request {
  userId?: string;
  role?: string[];
  driverId?: string;
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
