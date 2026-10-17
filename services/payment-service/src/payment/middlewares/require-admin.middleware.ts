import { NextFunction, Request, Response } from "express";

import { AppError } from "../../utils/AppError.js";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware.js";
import { prisma } from "../../db/client.js";
import { UserRole } from "@prisma/client";

/**
 * Lets only administrators through. Mount it AFTER authMiddleware.
 * (If the project already has a shared requireRole(UserRole.ADMIN) middleware it can
 * replace this one - the payment routes only need "admin or 403".)
 */
export async function requireAdmin(
    req: Request,
    _res: Response,
    next: NextFunction
): Promise<void> {

    try {

        const userId = (req as AuthenticatedRequest).userId;

        if (!userId) {
            throw new AppError(
                "Unauthenticated",
                401,
                "UNAUTHENTICATED"
            );
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { roles: true },
        });

        if (!user) {
            throw new AppError(
                "Unauthenticated",
                401,
                "UNAUTHENTICATED"
            );
        }

        if (!user.roles.includes(UserRole.ADMIN)) {
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
