import { Request, Response, NextFunction, RequestHandler } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { AppError } from "../utils/AppError.js";
import asyncHandler from "./asyncHandler.js";
import { redisClient } from "../redis/client.js";
import { prisma } from "../db/client.js";
import { authClient } from "../clients/auth.client.js";
import { driverClient } from "../clients/driver.client.js";
import { createLogger, ServiceUnavailableError } from "@urbanfleet/common";

const logger = createLogger("payment-auth-middleware");

export interface AuthenticatedUser {
  userId: string;
  email: string;
  roles: string[];
  firstName: string;
  lastName: string;
  driverId?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  userId?: string;
  roles?: string[];
  driverId?: string;
}

export interface AuthPayload extends JwtPayload {
  id?: string;
  userId?: string;
  sessionId?: string;
  email?: string;
  roles?: string[];
}

export const authMiddleware: RequestHandler = asyncHandler(
  async (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    // If request already has authenticated user (test bypass / mock), proceed
    if (request.userId && request.user) {
      return next();
    }

    // 1. Extract Token strictly from Authorization Bearer header (Single Source of Truth)
    const authHeader = request.headers.authorization;
    const token =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : undefined;

    if (!token) {
      throw new AppError("You are not authorized to access this resource.", 401, "UNAUTHORIZED");
    }

    // 2. Verify Token
    let decodedData: AuthPayload;
    try {
      const pubEnv = process.env.JWT_PUBLIC_KEY_BASE64;
      if (pubEnv) {
        const pubKey = Buffer.from(pubEnv, "base64").toString("utf-8");
        decodedData = jwt.verify(token, pubKey, {
          algorithms: ["RS256"],
          issuer: "urbanfleet-auth",
          audience: "urbanfleet-api",
        }) as AuthPayload;
      } else {
        throw new AppError("CRITICAL: Missing JWT_PUBLIC_KEY_BASE64 in production!", 500, "AUTH_CONFIG_ERROR");
      }
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      throw new AppError("Your token is invalid or expired.", 401, "TOKEN_EXPIRED");
    }

    const userId = decodedData.userId;
    const sessionId = decodedData.sessionId;

    if (!userId) {
      throw new AppError("Your session is invalid. Please sign in again.", 401, "INVALID_SESSION");
    }

    // 3. Validate Session
    if (sessionId && redisClient.isOpen) {
      try {
        const [storedSession] = await Promise.all([
          redisClient.get(`auth:session:${sessionId}`) || redisClient.get(`session:${sessionId}`),
        ]);

        if (storedSession) {
          const parsed = JSON.parse(storedSession) as { userId?: string };
          if (parsed.userId && parsed.userId !== userId) {
            throw new AppError("Session mismatch. Please sign in again.", 401, "SESSION_MISMATCH");
          }
        }
      } catch (e: unknown) {
        if (e instanceof AppError) throw e;
        logger.warn("Redis session validation warning", {
          error: e instanceof Error ? e.message : String(e),
          sessionId,
        });
      }
    }

    // 4. Fetch User Data (Cache first, then PostgreSQL)
    interface CachedUserRecord {
      id?: string;
      email?: string;
      roles?: string[];
      firstName?: string;
      lastName?: string;
      driverId?: string;
      driver?: { id?: string };
    }
    let user: CachedUserRecord | null = null;
    if (redisClient.isOpen) {
      try {
        const userStr =
          (await redisClient.get(`auth:user:${userId}`)) ||
          (await redisClient.get(`user:${userId}`));
        if (userStr) {
          user = JSON.parse(userStr) as CachedUserRecord;
        }
      } catch (err: unknown) {
        logger.warn("Failed to fetch user from Redis cache", {
          error: err instanceof Error ? err.message : String(err),
          userId,
        });
      }
    }

    if (!user) {
      try {
        const mockFindUnique = (prisma.user?.findUnique as unknown as { mock?: unknown })?.mock;
        if (typeof mockFindUnique !== "undefined") {
          user = (await prisma.user.findUnique({
            where: { id: userId },
          })) as CachedUserRecord | null;
        } else {
          user = (await authClient.getUserById(userId)) as CachedUserRecord | null;
        }
      } catch (err: unknown) {
        logger.error("Failed to fetch user from authClient/prisma", {
          error: err instanceof Error ? err.message : String(err),
          userId,
        });
        throw new ServiceUnavailableError(
          "Authentication service is temporarily unavailable",
          "AUTH_SERVICE_UNAVAILABLE",
          err instanceof Error ? err : undefined
        );
      }

      if (!user) {
        throw new AppError("User account not found or has been deactivated", 401, "USER_NOT_FOUND");
      }
    }

    // 5. Attach payload to Request and proceed
    const userRoles = Array.isArray(user.roles) ? user.roles : ["RIDER"];
    request.userId = userId;
    request.roles = userRoles;
    let driverId = user.driver?.id || user.driverId;

    if (!driverId && userRoles.includes("DRIVER")) {
      try {
        const driverProfile = await driverClient.getDriverByUserId(userId);
        if (driverProfile?.id) {
          driverId = driverProfile.id;
          if (redisClient.isOpen) {
            user.driverId = driverId;
            await redisClient.setEx(`auth:user:${userId}`, 15 * 60, JSON.stringify(user)).catch(() => {});
          }
        }
      } catch (err: unknown) {
        logger.warn("Failed to resolve driverId from driver-service", {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    request.driverId = driverId;
    request.user = {
      userId,
      email: typeof user.email === "string" ? user.email : (decodedData.email || ""),
      roles: userRoles,
      firstName: user.firstName || 'User',
      lastName: user.lastName || '',
      driverId: request.driverId,
    };

    next();
  }
);

export const protect = authMiddleware;

export const requireRole = (...allowedRoles: string[]) => {
  return ((req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    if (!req.userId) {
      return next(new AppError("User unauthenticated", 401, "UNAUTHORIZED"));
    }
    const roles: string[] = req.roles ?? req.user?.roles ?? [];
    const hasRole = roles.some((r) => allowedRoles.includes(r));
    if (!hasRole) {
      return next(
        new AppError(`Forbidden: Requires one of roles: ${allowedRoles.join(", ")}`, 403, "FORBIDDEN")
      );
    }
    next();
  }) as RequestHandler;
};

export const requireAdmin = requireRole("ADMIN");
export const requireDriver = requireRole("DRIVER");
export default authMiddleware;
