import { Router } from 'express';
import { RideController } from '../controllers/ride.controller.js';
import { validateRequest } from '@urbanfleet/common';
import {
  estimateFareSchema,
  requestRideSchema,
  cancelRideSchema,
  rateRideSchema,
  rideIdParamSchema,
  paymentStatusSchema,
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
  router.get('/:id', validateRequest({ params: rideIdParamSchema }), controller.getRideById);
  router.post('/:id/accept', requireRole('DRIVER') as any, validateRequest({ params: rideIdParamSchema }), controller.driverAcceptRide);
  router.post('/:id/arrived', requireRole('DRIVER') as any, validateRequest({ params: rideIdParamSchema }), controller.driverArrived);
  router.post('/:id/cancel', validateRequest({ params: rideIdParamSchema, body: cancelRideSchema }), controller.cancelRide);
  router.post('/:id/rate', validateRequest({ params: rideIdParamSchema, body: rateRideSchema }), controller.submitRating);
  router.get('/history/rider', controller.getRiderHistory);
  router.get('/history/driver', requireRole('DRIVER') as any, controller.getDriverHistory);
  router.patch('/:id/payment-status', validateRequest({ params: rideIdParamSchema, body: paymentStatusSchema }), controller.updatePaymentStatus);

  return router;
}

export default createRideRouter;

