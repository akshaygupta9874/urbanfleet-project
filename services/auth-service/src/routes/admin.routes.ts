import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller.js';
import { authMiddleware, requireAdmin } from '../middlewares/auth.middleware.js';

export function createAdminRouter(controller: AdminController): Router {
  const router = Router();

  router.get('/stats', authMiddleware, requireAdmin, controller.getSystemStats);

  return router;
}
