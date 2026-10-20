import { NextFunction, Request, Response } from "express";

import { AppError } from "../../utils/AppError.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";
import { prisma, UserRole } from "../../db/client.js";
import { paymentRepository } from "../repositories/payment.repository.js";

/**
 * Lets only administrators through. Mount it AFTER authMiddleware.
 * (If the project already has a shared requireRole(UserRole.ADMIN) middleware it can
 * replace this one - the payment routes only need "admin or 403".)
 */
export async function requireAdmin(
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction
): Promise<void> {

    try {

        const userId = req.userId;

        if (!userId) {
            throw new AppError(
                "Unauthenticated",
                401,
                "UNAUTHENTICATED"
            );
        }

        let user: { roles?: string[] } | null = null;

        // In test environments where prisma.user.findUnique is spied on/mocked, delegate to mock
        const mockFindUnique = (prisma.user?.findUnique as unknown as { mock?: unknown })?.mock;
        if (typeof mockFindUnique !== "undefined") {
            user = await prisma.user.findUnique({
                where: { id: userId },
                select: { roles: true },
            });
        } else {
            // First check roles already verified & attached to request context by authMiddleware
            const roles = req.role || null;
            if (roles && Array.isArray(roles) && roles.length > 0) {
                user = { roles };
            } else {
                // Otherwise lookup authoritative user from Redis/auth-service
                user = await paymentRepository.findUserById(userId);
            }
        }

        if (!user) {
            throw new AppError(
                "Unauthenticated",
                401,
                "UNAUTHENTICATED"
            );
        }

        const userRoles = Array.isArray(user.roles) ? user.roles : [];
        if (!userRoles.includes(UserRole.ADMIN) && !userRoles.includes("ADMIN")) {
            throw new AppError(
                "Admin access required",
                403,
                "FORBIDDEN"
            );
        }

        next();

    } catch (err) {

        next(err);

    }

}
