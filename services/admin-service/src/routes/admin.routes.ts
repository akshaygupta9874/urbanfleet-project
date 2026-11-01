import { Router } from 'express';
import { requireAdmin } from '../middlewares/auth.middleware.js';
import { adminController, AdminController } from '../controllers/admin.controller.js';

export function createAdminRouter(controller: AdminController = adminController): Router {
  const router = Router();

  // All endpoints require verified administrator authentication
  router.use(requireAdmin);

  // Overview metrics & real-time analytics
  router.get('/overview', controller.getOverview);
  router.get('/analytics', controller.getAnalytics);

  // Live dispatch fleet radar
  router.get('/fleet/radar', controller.getFleetRadar);

  // System settings & policies
  router.get('/settings', controller.getSettings);
  router.patch('/settings', controller.updateSettings);

  // User management & suspension
  router.get('/users', controller.getUsers);
  router.patch('/users/:id/suspension', controller.setSuspension);

  // Session inspection & remote revocation
  router.get('/sessions', controller.getSessions);
  router.delete('/sessions/:id', controller.revokeSession);

  // Driver verification & document review
  router.get('/drivers', controller.getDrivers);
  router.patch('/drivers/:id/verification', controller.verifyDriver);

  // Rides & payments inspection
  router.get('/rides', controller.getRides);
  router.get('/payments', controller.getPayments);
  router.post('/payments/:id/refund', controller.refundPayment);

  // Audit logs (read-only query; writes are performed automatically on business mutations)
  router.get('/audit', controller.getAuditLogs);

  // System cluster health
  router.get('/system-health', controller.getSystemHealth);

  return router;
}

export default createAdminRouter;
