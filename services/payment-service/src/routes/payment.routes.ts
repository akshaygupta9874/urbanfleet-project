import { Router } from 'express';
import { PaymentController } from '../controllers/payment.controller.js';
import { slidingWindowRateLimit } from '@urbanfleet/common';
import { redisClient } from '../redis/client.js';
import { authMiddleware, requireRole } from '../middlewares/auth.middleware.js';

export function createPaymentRouter(controller: PaymentController): Router {
  const router = Router();

  // Sliding Window Rate Limiters
  const orderLimiter = slidingWindowRateLimit({
    redis: redisClient as any,
    limit: 20,
    windowSeconds: 60,
    keyPrefix: 'rl:pay:order',
    keyGenerator: (req) => `${(req as any).userId || req.ip || 'anon'}`,
    failOpen: true,
  });

  const verifyLimiter = slidingWindowRateLimit({
    redis: redisClient as any,
    limit: 20,
    windowSeconds: 60,
    keyPrefix: 'rl:pay:verify',
    keyGenerator: (req) => `${(req as any).userId || req.ip || 'anon'}`,
    failOpen: true,
  });

  const payoutLimiter = slidingWindowRateLimit({
    redis: redisClient as any,
    limit: 10,
    windowSeconds: 60,
    keyPrefix: 'rl:pay:payout',
    keyGenerator: (req) => `${(req as any).userId || req.ip || 'anon'}`,
    failOpen: true,
  });

  // Public Webhook from Razorpay
  router.post('/webhook', controller.handleRazorpayWebhook);

  // Authenticated Endpoints
  router.use(authMiddleware);

  router.post('/order', orderLimiter, controller.createPaymentOrder);
  router.post('/verify', verifyLimiter, controller.verifyPayment);
  router.get('/ride/:rideId', controller.getPaymentByRideId);

  // Driver Payouts
  router.post('/payout', requireRole('DRIVER'), payoutLimiter, controller.requestPayout);

  return router;
}
