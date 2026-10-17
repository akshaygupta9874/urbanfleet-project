import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/AppError.js";

export interface AuthenticatedRequest extends Request {
  user?: any;
  userId?: string;
}

export const protect = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user && !req.userId && !req.headers.authorization) {
    return next(new AppError("Not authorized", 401, "UNAUTHORIZED"));
  }
  next();
};

export const authMiddleware = protect;

export const requireRole = (...allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    if (!req.user && !req.userId && !req.headers.authorization) {
      return next(new AppError("User unauthenticated", 401, "UNAUTHORIZED"));
    }
    if (req.user?.role && !allowedRoles.includes(req.user.role)) {
      return next(new AppError(`Forbidden: Requires one of roles: ${allowedRoles.join(', ')}`, 403, "FORBIDDEN"));
    }
    next();
  };
};
