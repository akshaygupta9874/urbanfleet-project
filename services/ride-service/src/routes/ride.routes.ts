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
  router.post('/fare', validateRequest({ body: estimateFareSchema }), controller.estimateFare);

  // Authenticated Ride Endpoints
  router.use(authMiddleware);

  // Ride Request
  router.post('/', validateRequest({ body: requestRideSchema }), controller.requestRide);
  router.post('/request', validateRequest({ body: requestRideSchema }), controller.requestRide);

  // Active / Current Ride
  router.get('/current', controller.getActiveRide);
  router.get('/active', controller.getActiveRide);
  router.get('/driver/current', controller.getCurrentRideOfDriver);

  // Ride History
  router.get('/history', controller.getRiderHistory);
  router.get('/history/rider', controller.getRiderHistory);
  router.get('/history/driver', requireRole('DRIVER'), controller.getDriverHistory);

  // Single Ride details & fare preview (must stay after specific string paths like /current, /history)
  router.get('/:id/fare-preview', validateRequest({ params: rideIdParamSchema }), controller.getRideById);
  router.get('/:id', validateRequest({ params: rideIdParamSchema }), controller.getRideById);

  // Driver Lifecycle Actions (supporting both PATCH and POST for frontend / test compatibility)
  router.patch('/:id/accept', requireRole('DRIVER'), validateRequest({ params: rideIdParamSchema }), controller.driverAcceptRide);
  router.post('/:id/accept', requireRole('DRIVER'), validateRequest({ params: rideIdParamSchema }), controller.driverAcceptRide);

  router.patch('/:id/arrive', requireRole('DRIVER'), validateRequest({ params: rideIdParamSchema }), controller.driverArrived);
  router.patch('/:id/arrived', requireRole('DRIVER'), validateRequest({ params: rideIdParamSchema }), controller.driverArrived);
  router.post('/:id/arrived', requireRole('DRIVER'), validateRequest({ params: rideIdParamSchema }), controller.driverArrived);

  router.patch('/:id/destination-arrived', requireRole('DRIVER'), validateRequest({ params: rideIdParamSchema }), controller.driverArrivedAtDestination);
  router.post('/:id/destination-arrived', requireRole('DRIVER'), validateRequest({ params: rideIdParamSchema }), controller.driverArrivedAtDestination);

  router.patch('/:id/start', requireRole('DRIVER'), validateRequest({ params: rideIdParamSchema }), controller.startRide);
  router.post('/:id/start', requireRole('DRIVER'), validateRequest({ params: rideIdParamSchema }), controller.startRide);

  router.patch('/:id/complete', requireRole('DRIVER'), validateRequest({ params: rideIdParamSchema }), controller.completeRide);
  router.post('/:id/complete', requireRole('DRIVER'), validateRequest({ params: rideIdParamSchema }), controller.completeRide);

  // Cancellation (supporting both PATCH and POST)
  router.patch('/:id/cancel', validateRequest({ params: rideIdParamSchema, body: cancelRideSchema }), controller.cancelRide);
  router.post('/:id/cancel', validateRequest({ params: rideIdParamSchema, body: cancelRideSchema }), controller.cancelRide);

  router.patch('/:id/driver/cancel', requireRole('DRIVER'), validateRequest({ params: rideIdParamSchema, body: cancelRideSchema }), controller.cancelRideByDriver);
  router.post('/:id/driver/cancel', requireRole('DRIVER'), validateRequest({ params: rideIdParamSchema, body: cancelRideSchema }), controller.cancelRideByDriver);

  // Ratings & Payment status
  router.post('/:id/rate', validateRequest({ params: rideIdParamSchema, body: rateRideSchema }), controller.submitRating);
  router.patch('/:id/payment-status', validateRequest({ params: rideIdParamSchema, body: paymentStatusSchema }), controller.updatePaymentStatus);

  return router;
}

export default createRideRouter;


