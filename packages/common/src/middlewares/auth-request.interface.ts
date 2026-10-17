import { Request } from 'express';

export interface AuthUser {
  id: string;
  userId: string;
  email?: string;
  role?: string;
  roles?: string[];
  driverId?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  [key: string]: any;
}

export interface AuthenticatedRequest extends Request {
  userId?: string;
  role?: string[];
  driverId?: string;
  user?: AuthUser;
  cookies: Record<string, any>;
  files?: any;
}
