import { Router } from 'express';
import { NotificationRepository } from '../repositories/notification.repository.js';
import { authMiddleware, AuthenticatedRequest } from '../middlewares/auth.middleware.js';
import asyncHandler from '../middlewares/asyncHandler.js';

export function createNotificationRouter(notifRepo: NotificationRepository): Router {
  const router = Router();

  // Public health check
  router.get('/health', (_req, res) => res.status(200).json({ status: 'UP', service: 'notification-service' }));

  // List recent notifications for the authenticated user
  router.get('/my', authMiddleware, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const email = req.user?.email;
    const userId = req.userId || req.user?.id || req.user?.userId;

    const conditions: Array<{ recipient: string }> = [];
    if (email && typeof email === 'string' && email.trim().length > 0) {
      conditions.push({ recipient: email.trim() });
    }
    if (userId && typeof userId === 'string' && userId.trim().length > 0) {
      conditions.push({ recipient: userId.trim() });
    }

    // If no valid recipient identifier is present, safely return empty list without whole-table scan
    if (conditions.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    const records = await (notifRepo as any).prisma.notificationRecord.findMany({
      where: conditions.length === 1 ? conditions[0] : { OR: conditions },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.status(200).json({ success: true, data: records });
  }));

  // Get single notification status (strictly enforcing recipient ownership or admin privilege)
  router.get('/:id', authMiddleware, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const record = await (notifRepo as any).prisma.notificationRecord.findUnique({
      where: { id: req.params.id },
    });
    if (!record) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    const userEmail = req.user?.email;
    const userId = req.userId || req.user?.id || req.user?.userId;
    const roles: string[] = req.role || req.user?.roles || (req.user?.role ? [req.user.role] : []);
    const isPrivileged = roles.includes('ADMIN') || req.userId === 'internal-service';

    const isOwner =
      (userEmail && record.recipient.toLowerCase() === userEmail.toLowerCase()) ||
      (userId && record.recipient === userId) ||
      (userId && typeof record.payload === 'object' && record.payload !== null && (
        (record.payload as any).userId === userId ||
        (record.payload as any).riderId === userId ||
        (record.payload as any).driverId === userId
      ));

    if (!isPrivileged && !isOwner) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'You are not authorized to view this notification',
      });
    }

    res.status(200).json({ success: true, data: record });
  }));

  return router;
}
