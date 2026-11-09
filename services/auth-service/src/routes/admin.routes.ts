import { Router } from 'express';
import { validateRequest } from '@urbanfleet/common';
import { authMiddleware, requireRole } from '../middlewares/auth.middleware.js';
import { AdminController } from '../controllers/admin.controller.js';
import {
  paginationQuerySchema,
  analyticsQuerySchema,
  idParamSchema,
  userSuspensionSchema,
  systemSettingsSchema,
  driverVerificationSchema,
} from '../validation/admin.validation.js';

export function createAdminRouter(controller: AdminController): Router {
  const router = Router();

  // Public Health Endpoint (unprotected for gateway and health checks)
  router.get('/health', (_req, res) => res.status(200).json({ status: 'UP', service: 'admin' }));

  // All endpoints require verified administrator authentication
  router.use(authMiddleware, requireRole('ADMIN'));

  // Overview metrics & real-time analytics
  router.get('/overview', controller.getOverview);
  router.get('/analytics', validateRequest({ query: analyticsQuerySchema }), controller.getAnalytics);

  // Live dispatch fleet radar
  router.get('/fleet/radar', controller.getFleetRadar);

  // System settings & policies
  router.get('/settings', controller.getSettings);
  router.patch('/settings', validateRequest({ body: systemSettingsSchema }), controller.updateSettings);

  // User management & suspension
  router.get('/users', validateRequest({ query: paginationQuerySchema }), controller.getUsers);
  router.patch(
    '/users/:id/suspension',
    validateRequest({ params: idParamSchema, body: userSuspensionSchema }),
    controller.setSuspension,
  );

  // Session inspection & remote revocation
  router.get('/sessions', validateRequest({ query: paginationQuerySchema }), controller.getSessions);
  router.delete('/sessions/:id', validateRequest({ params: idParamSchema }), controller.revokeSession);

  // Driver verification & document review
  router.get('/drivers', validateRequest({ query: paginationQuerySchema }), controller.getDrivers);
  router.patch(
    '/drivers/:id/verification',
    validateRequest({ params: idParamSchema, body: driverVerificationSchema }),
    controller.verifyDriver,
  );

  // Rides & payments inspection
  router.get('/rides', validateRequest({ query: paginationQuerySchema }), controller.getRides);
  router.get('/payments', validateRequest({ query: paginationQuerySchema }), controller.getPayments);

  // System cluster health
  router.get('/system-health', controller.getSystemHealth);

  return router;
}

export default createAdminRouter;
