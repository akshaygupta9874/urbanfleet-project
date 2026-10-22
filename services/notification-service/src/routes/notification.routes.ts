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
    const userId = req.userId;

    const recipients: string[] = [];
    if (email && typeof email === 'string' && email.trim().length > 0) {
      recipients.push(email.trim());
    }
    if (userId && typeof userId === 'string' && userId.trim().length > 0) {
      recipients.push(userId.trim());
    }

    if (recipients.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    const records = await notifRepo.findByRecipients(recipients, 50);
    res.status(200).json({ success: true, data: records });
  }));

  // Get single notification status (strictly enforcing recipient ownership or admin privilege)
  router.get('/:id', authMiddleware, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const record = await notifRepo.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    const userEmail = req.user?.email;
    const userId = req.userId;
    const roles: string[] = req.role || [];
    const isPrivileged = roles.includes('ADMIN');

    const payload = typeof record.payload === 'object' && record.payload !== null
      ? (record.payload as Record<string, unknown>)
      : null;

    const isOwner =
      Boolean(userEmail && record.recipient.toLowerCase() === userEmail.toLowerCase()) ||
      Boolean(userId && record.recipient === userId) ||
      Boolean(userId && payload && (
        payload.userId === userId ||
        payload.riderId === userId ||
        payload.driverId === userId
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
