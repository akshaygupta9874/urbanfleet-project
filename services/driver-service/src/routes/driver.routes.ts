import { Router } from 'express';
import { DriverController } from '../controllers/driver.controller.js';
import { createAuthMiddleware, requireRole } from '@urbanfleet/common';

export function createDriverRouter(controller: DriverController): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware();

  // All endpoints require DRIVER or ADMIN role
  router.use(authMiddleware as any);

  router.post('/register', controller.registerDriver);
  router.get('/profile', controller.getDriverProfile);
  router.patch('/profile', controller.updateDriverProfile);
  router.patch('/vehicle', controller.updateVehicle);
  router.post('/documents', controller.uploadDocument);
  router.patch('/availability', controller.toggleAvailability);
  router.get('/earnings', controller.getEarnings);

  return router;
}
