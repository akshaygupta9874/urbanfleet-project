import { Router } from 'express';
import { RideController } from '../controllers/ride.controller.js';
import { createAuthMiddleware, requireRole } from '@urbanfleet/common';

export function createRideRouter(controller: RideController): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware();

  // Public fare estimate
  router.post('/estimate', controller.estimateFare);

  // Authenticated Rider/Driver Endpoints
  router.use(authMiddleware as any);

  router.post('/request', controller.requestRide);
  router.get('/current', controller.getActiveRide);
  router.get('/history/rider', controller.getRiderHistory);
  router.get('/history/driver', controller.getDriverHistory);
  router.get('/:id', controller.getRideById);
  router.post('/:id/cancel', controller.cancelRide);
  router.post('/:id/rating', controller.submitRating);

  // Driver Operations
  router.post('/:id/accept', requireRole('DRIVER') as any, controller.driverAcceptRide);
  router.post('/:id/arrived', requireRole('DRIVER') as any, controller.driverArrived);

  return router;
}
