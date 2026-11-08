import { Router } from 'express';
import { NotificationRepository } from '../repositories/notification.repository.js';
import { NotificationController } from '../controllers/notification.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';

export function createNotificationRouter(
  controllerOrRepo: NotificationController | NotificationRepository
): Router {
  const controller =
    controllerOrRepo instanceof NotificationController
      ? controllerOrRepo
      : new NotificationController(controllerOrRepo);

  const router = Router();

  // Public health check
  router.get('/health', (_req, res) => res.status(200).json({ status: 'UP', service: 'notification-service' }));

  // List recent notifications for the authenticated user
  router.get('/my', authMiddleware, controller.getMyNotifications);

  // Get single notification status (strictly enforcing recipient ownership or admin privilege)
  router.get('/:id', authMiddleware, controller.getNotificationById);

  return router;
}

export default createNotificationRouter;
