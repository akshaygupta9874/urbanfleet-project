import { Router } from 'express';
import { validateRequest } from '@urbanfleet/common';
import { authMiddleware, requireRole } from '../middlewares/auth.middleware.js';
import { AdminController } from '../controllers/admin.controller.js';
import { AdminService } from '../services/admin.service.js';
import { UserService } from '../services/user.service.js';
import { SessionRepository } from '../repositories/session.repository.js';
import {
  paginationQuerySchema,
  idParamSchema,
  userSuspensionSchema,
} from '../validation/admin.validation.js';

export function createAdminRouter(
  controllerOrUserService: AdminController | UserService,
  sessionRepository?: SessionRepository,
): Router {
  const controller =
    controllerOrUserService instanceof AdminController
      ? controllerOrUserService
      : new AdminController(new AdminService(controllerOrUserService, sessionRepository!));

  const router = Router();
  router.use(authMiddleware, requireRole('ADMIN'));

  router.get('/users', validateRequest({ query: paginationQuerySchema }), controller.getUsers);
  router.get('/sessions', validateRequest({ query: paginationQuerySchema }), controller.getSessions);
  router.patch(
    '/users/:id/suspension',
    validateRequest({ params: idParamSchema, body: userSuspensionSchema }),
    controller.setSuspension,
  );
  router.delete(
    '/sessions/:id',
    validateRequest({ params: idParamSchema }),
    controller.revokeSession,
  );

  return router;
}

export default createAdminRouter;
