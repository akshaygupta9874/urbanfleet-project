import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller.js';
import { createAuthMiddleware, requireRole } from '../middlewares/jwt-auth.middleware.js';

export function createAdminRouter(controller: AdminController): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware();

  router.get('/stats', authMiddleware, requireRole('ADMIN'), controller.getSystemStats);

  return router;
}
