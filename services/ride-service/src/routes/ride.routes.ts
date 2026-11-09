import { Router, Request } from 'express';
import { RideController } from '../controllers/ride.controller.js';
import { validateRequest, slidingWindowRateLimit } from '@urbanfleet/common';
import { rideRedisClient } from '../redis/client.js';
import {
  estimateFareSchema,
  requestRideSchema,
  cancelRideSchema,
  rateRideSchema,
  rideIdParamSchema,
  acceptRideSchema,
  startRideSchema,
  paymentStatusSchema,
} from '../validation/ride.validation.js';
import { authMiddleware, optionalAuth, requireRole } from '../middlewares/auth.middleware.js';

export function createRideRouter(controller: RideController): Router {
  const router = Router();

  // Sliding Window Rate Limiters
  const estimateLimiter = slidingWindowRateLimit({
    redis: rideRedisClient,
    limit: 30,
    windowSeconds: 60,
    keyPrefix: 'rl:ride:estimate',
    failOpen: true,
  });

  const requestRideLimiter = slidingWindowRateLimit({
    redis: rideRedisClient,
    limit: 10,
    windowSeconds: 60,
    keyPrefix: 'rl:ride:request',
    keyGenerator: (req: Request) => `${(req as Request & { userId?: string }).userId || req.ip || 'anon'}`,
    failOpen: true,
  });

  const ratingLimiter = slidingWindowRateLimit({
    redis: rideRedisClient,
    limit: 10,
    windowSeconds: 60,
    keyPrefix: 'rl:ride:rate',
    keyGenerator: (req: Request) => `${req.params?.id}:${(req as Request & { userId?: string }).userId || req.ip || 'anon'}`,
    failOpen: true,
  });

  // Admin analytics & list endpoints
  router.get('/admin/metrics', authMiddleware, requireRole('ADMIN'), controller.getRideAnalyticsAdmin);
  router.get('/admin/analytics', authMiddleware, requireRole('ADMIN'), controller.getRideAnalyticsAdmin);
  router.get('/admin/list', authMiddleware, requireRole('ADMIN'), controller.listRidesAdmin);

  // Public / unauthenticated estimate calculation (Single Canonical Endpoint)
  router.post('/estimate', estimateLimiter, validateRequest({ body: estimateFareSchema }), controller.estimateFare);

  // Ride Request (Single Canonical Endpoint)
  router.post('/', authMiddleware, requestRideLimiter, validateRequest({ body: requestRideSchema }), controller.requestRide);

  // Active / Current Ride (Single Canonical Endpoint)
  router.get('/current', authMiddleware, controller.getActiveRide);
  router.get('/driver/current', authMiddleware, controller.getCurrentRideOfDriver);

  // Ride History (Single Canonical Endpoints)
  router.get('/history', authMiddleware, controller.getRiderHistory);
  router.get('/history/driver', authMiddleware, requireRole('DRIVER'), controller.getDriverHistory);
  router.get('/metrics/driver', authMiddleware, requireRole('DRIVER'), controller.getDriverMetrics);
  router.get('/ratings/driver', authMiddleware, requireRole('DRIVER'), controller.getDriverRatings);

  // Single Ride details & fare preview (must stay after specific string paths like /current, /history)
  // Uses optionalAuth so peer microservices (e.g. payment-service) can resolve ride details without external user tokens
  router.get('/:id/fare-preview', optionalAuth, validateRequest({ params: rideIdParamSchema }), controller.getRideFarePreview);
  router.get('/:id', optionalAuth, validateRequest({ params: rideIdParamSchema }), controller.getRideById);

  // Cancel ride (supports both POST and PATCH for client compatibility)
  router.post('/:id/cancel', authMiddleware, validateRequest({ params: rideIdParamSchema, body: cancelRideSchema }), controller.cancelRide);
  router.patch('/:id/cancel', authMiddleware, validateRequest({ params: rideIdParamSchema, body: cancelRideSchema }), controller.cancelRide);

  // Driver action endpoints
  router.post('/:id/accept', authMiddleware, requireRole('DRIVER'), validateRequest({ params: rideIdParamSchema, body: acceptRideSchema }), controller.driverAcceptRide);
  router.post('/:id/arrived', authMiddleware, requireRole('DRIVER'), validateRequest({ params: rideIdParamSchema }), controller.driverArrived);
  router.post('/:id/start', authMiddleware, requireRole('DRIVER'), validateRequest({ params: rideIdParamSchema, body: startRideSchema }), controller.startRide);
  router.post('/:id/arrive-destination', authMiddleware, requireRole('DRIVER'), validateRequest({ params: rideIdParamSchema }), controller.driverArrivedAtDestination);
  router.post('/:id/complete', authMiddleware, requireRole('DRIVER'), validateRequest({ params: rideIdParamSchema }), controller.completeRide);

  // Payment status synchronization
  router.patch('/:id/payment-status', optionalAuth, validateRequest({ params: rideIdParamSchema, body: paymentStatusSchema }), controller.updatePaymentStatus);

  // Submit Rating
  router.post('/:id/rate', authMiddleware, ratingLimiter, validateRequest({ params: rideIdParamSchema, body: rateRideSchema }), controller.submitRating);

  return router;
}

export default createRideRouter;
