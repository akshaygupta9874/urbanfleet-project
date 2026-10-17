import { Router } from 'express';
import { RideController } from '../controllers/ride.controller.js';
import { validateRequest } from '@urbanfleet/common';
import {
  estimateFareSchema,
  requestRideSchema,
  cancelRideSchema,
  rateRideSchema,
} from '../validation/ride.validation.js';

export function createRideRouter(controller: RideController): Router {
  const router = Router();

  router.post('/estimate', validateRequest({ body: estimateFareSchema }), controller.estimateFare);
  router.post('/request', validateRequest({ body: requestRideSchema }), controller.requestRide);
  router.get('/active', controller.getActiveRide);
  router.get('/:id', controller.getRideById);
  router.post('/:id/accept', controller.driverAcceptRide);
  router.post('/:id/arrived', controller.driverArrived);
  router.post('/:id/cancel', validateRequest({ body: cancelRideSchema }), controller.cancelRide);
  router.post('/:id/rate', validateRequest({ body: rateRideSchema }), controller.submitRating);
  router.get('/history/rider', controller.getRiderHistory);
  router.get('/history/driver', controller.getDriverHistory);

  return router;
}
