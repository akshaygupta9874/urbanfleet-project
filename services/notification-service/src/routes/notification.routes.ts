import { Router } from 'express';
import { NotificationRepository } from '../repositories/notification.repository.js';
import { authMiddleware, AuthenticatedRequest } from '../middlewares/auth.middleware.js';
import asyncHandler from '../middlewares/asyncHandler.js';

export function createNotificationRouter(notifRepo: NotificationRepository): Router {
  const router = Router();

  // List recent notifications for the authenticated user
  router.get('/my', authMiddleware, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const email = req.user?.email;
    const userId = req.userId;
    const records = await (notifRepo as any).prisma.notificationRecord.findMany({
      where: {
        OR: [
          email ? { recipient: email } : {},
          userId ? { recipient: userId } : {},
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.status(200).json({ success: true, data: records });
  }));

  // Get single notification status
  router.get('/:id', authMiddleware, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const record = await (notifRepo as any).prisma.notificationRecord.findUnique({
      where: { id: req.params.id },
    });
    if (!record) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    res.status(200).json({ success: true, data: record });
  }));

  return router;
}
