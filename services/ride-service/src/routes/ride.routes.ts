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
import { prisma } from '../db/client.js';

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
    keyGenerator: (req: Request) => `${(req as any).userId || req.ip || 'anon'}`,
    failOpen: true,
  });

  const startRideLimiter = slidingWindowRateLimit({
    redis: rideRedisClient,
    limit: 10,
    windowSeconds: 60,
    keyPrefix: 'rl:ride:start',
    keyGenerator: (req: Request) => `${req.params?.id}:${(req as any).userId || req.ip || 'anon'}`,
    failOpen: true,
  });

  const rateRideLimiter = slidingWindowRateLimit({
    redis: rideRedisClient,
    limit: 10,
    windowSeconds: 60,
    keyPrefix: 'rl:ride:rate',
    keyGenerator: (req: Request) => `${req.params?.id}:${(req as any).userId || req.ip || 'anon'}`,
    failOpen: true,
  });

  router.get('/admin/metrics', authMiddleware, requireRole('ADMIN'), async (req, res, next) => {
    try {
      const period = typeof req.query.period === 'string' ? req.query.period : '7d';
      const days = period === '24h' ? 1 : period === '30d' ? 30 : 7;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const [statusCounts, completedStats, totalCount] = await Promise.all([
        prisma.ride.groupBy({
          by: ['status'],
          _count: true,
          where: { createdAt: { gte: startDate } },
        }),
        prisma.ride.aggregate({
          _sum: { totalFarePaise: true },
          _count: true,
          where: { status: 'COMPLETED', createdAt: { gte: startDate } },
        }),
        prisma.ride.count({ where: { createdAt: { gte: startDate } } }),
      ]);

      const breakdown: Record<string, number> = {
        SEARCHING: 0,
        DRIVER_ASSIGNED: 0,
        DRIVER_ARRIVING: 0,
        RIDE_STARTED: 0,
        ARRIVED_AT_DESTINATION: 0,
        COMPLETED: 0,
        CANCELLED: 0,
      };

      for (const item of statusCounts) {
        breakdown[item.status] = item._count;
      }

      res.json({
        success: true,
        data: {
          period,
          totalRides: totalCount,
          completedRides: completedStats._count,
          totalFarePaise: completedStats._sum.totalFarePaise || 0,
          statusBreakdown: breakdown,
        },
      });
    } catch (error) { next(error); }
  });

  router.get('/admin/list', authMiddleware, requireRole('ADMIN'), async (req, res, next) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const paymentStatus = typeof req.query.paymentStatus === 'string' ? req.query.paymentStatus : undefined;
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;
      const where = {
        ...(status ? { status: status as never } : {}),
        ...(paymentStatus ? { paymentStatus: paymentStatus as never } : {}),
        ...(search ? {
          OR: [
            { pickupAddress: { contains: search, mode: 'insensitive' as const } },
            { destinationAddress: { contains: search, mode: 'insensitive' as const } },
            { id: { contains: search, mode: 'insensitive' as const } },
            { riderId: { contains: search, mode: 'insensitive' as const } },
            { driverId: { contains: search, mode: 'insensitive' as const } },
          ],
        } : {}),
      };
      const [items, total] = await prisma.$transaction([
        prisma.ride.findMany({ where, include: { ratings: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.ride.count({ where }),
      ]);
      res.json({ success: true, data: items, pagination: { page, limit, total } });
    } catch (error) { next(error); }
  });

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

  // Single Ride details & fare preview (must stay after specific string paths like /current, /history)
  // Uses optionalAuth so peer microservices (e.g. payment-service) can resolve ride details without external user tokens
  router.get('/:id/fare-preview', optionalAuth, validateRequest({ params: rideIdParamSchema }), controller.getRideById);
  router.get('/:id', optionalAuth, validateRequest({ params: rideIdParamSchema }), controller.getRideById);

  // Driver Lifecycle Actions (Canonical PATCH HTTP semantics)
  router.patch('/:id/accept', authMiddleware, requireRole('DRIVER'), validateRequest({ params: rideIdParamSchema, body: acceptRideSchema }), controller.driverAcceptRide);
  router.patch('/:id/arrive', authMiddleware, requireRole('DRIVER'), validateRequest({ params: rideIdParamSchema }), controller.driverArrived);
  router.patch('/:id/destination-arrived', authMiddleware, requireRole('DRIVER'), validateRequest({ params: rideIdParamSchema }), controller.driverArrivedAtDestination);
  router.patch('/:id/start', authMiddleware, requireRole('DRIVER'), startRideLimiter, validateRequest({ params: rideIdParamSchema, body: startRideSchema }), controller.startRide);
  router.patch('/:id/complete', authMiddleware, requireRole('DRIVER'), validateRequest({ params: rideIdParamSchema }), controller.completeRide);

  // Cancellation (Canonical PATCH HTTP semantics)
  router.patch('/:id/cancel', authMiddleware, validateRequest({ params: rideIdParamSchema, body: cancelRideSchema }), controller.cancelRide);
  router.patch('/:id/driver/cancel', authMiddleware, requireRole('DRIVER'), validateRequest({ params: rideIdParamSchema, body: cancelRideSchema }), controller.cancelRideByDriver);

  // Ratings & Payment status (payment-status uses optionalAuth for peer microservice updates)
  router.post('/:id/rate', authMiddleware, rateRideLimiter, validateRequest({ params: rideIdParamSchema, body: rateRideSchema }), controller.submitRating);
  router.patch('/:id/payment-status', optionalAuth, validateRequest({ params: rideIdParamSchema, body: paymentStatusSchema }), controller.updatePaymentStatus);

  return router;
}

export default createRideRouter;
