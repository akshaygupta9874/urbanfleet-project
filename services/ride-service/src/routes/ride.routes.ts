import { Router } from 'express';
import { RideController } from '../controllers/ride.controller.js';
import { validateRequest } from '@urbanfleet/common';
import {
  estimateFareSchema,
  requestRideSchema,
  cancelRideSchema,
  rateRideSchema,
} from '../validation/ride.validation.js';
import { authMiddleware, requireRole } from '../middlewares/auth.middleware.js';

export function createRideRouter(controller: RideController): Router {
  const router = Router();

  // Public / unauthenticated estimate calculation
  router.post('/estimate', validateRequest({ body: estimateFareSchema }), controller.estimateFare);

  // Authenticated Ride Endpoints
  router.use(authMiddleware as any);

  router.post('/request', validateRequest({ body: requestRideSchema }), controller.requestRide);
  router.get('/active', controller.getActiveRide);
  router.get('/:id', controller.getRideById);
  router.post('/:id/accept', requireRole('DRIVER') as any, controller.driverAcceptRide);
  router.post('/:id/arrived', requireRole('DRIVER') as any, controller.driverArrived);
  router.post('/:id/cancel', validateRequest({ body: cancelRideSchema }), controller.cancelRide);
  router.post('/:id/rate', validateRequest({ body: rateRideSchema }), controller.submitRating);
  router.get('/history/rider', controller.getRiderHistory);
  router.get('/history/driver', requireRole('DRIVER') as any, controller.getDriverHistory);
  router.patch('/:id/payment-status', controller.updatePaymentStatus);

  return router;
}

export default createRideRouter;

