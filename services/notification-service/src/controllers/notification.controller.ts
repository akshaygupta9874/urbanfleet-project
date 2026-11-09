import { Response } from 'express';
import { NotificationRepository } from '../repositories/notification.repository.js';
import { AuthenticatedRequest } from '../middlewares/auth.middleware.js';
import asyncHandler from '../middlewares/asyncHandler.js';

export class NotificationController {
  constructor(private notifRepo: NotificationRepository) {}

  getMyNotifications = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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

    const records = await this.notifRepo.findByRecipients(recipients, 50);
    res.status(200).json({ success: true, data: records });
  });

  getNotificationById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const record = await this.notifRepo.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    const userEmail = req.user?.email;
    const userId = req.userId;
    const driverId = req.driverId;
    const roles: string[] = req.roles || [];
    const isPrivileged = roles.includes('ADMIN');

    const payload = typeof record.payload === 'object' && record.payload !== null
      ? (record.payload as Record<string, unknown>)
      : null;

    const isOwner =
      Boolean(userEmail && record.recipient.toLowerCase() === userEmail.toLowerCase()) ||
      Boolean(userId && record.recipient === userId) ||
      Boolean(driverId && record.recipient === driverId) ||
      Boolean(userId && payload && (
        payload.userId === userId ||
        payload.riderId === userId
      )) ||
      Boolean(driverId && payload && payload.driverId === driverId);

    if (!isPrivileged && !isOwner) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'You are not authorized to view this notification',
      });
    }

    res.status(200).json({ success: true, data: record });
  });
}
