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
