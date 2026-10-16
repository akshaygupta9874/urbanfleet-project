import { Router } from 'express';
import { PaymentController } from '../controllers/payment.controller.js';
import { createAuthMiddleware, requireRole } from '@urbanfleet/common';

export function createPaymentRouter(controller: PaymentController): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware();

  // Public Webhook from Razorpay
  router.post('/webhook', controller.handleRazorpayWebhook);

  // Authenticated Endpoints
  router.use(authMiddleware as any);

  router.post('/order', controller.createPaymentOrder);
  router.post('/verify', controller.verifyPayment);
  router.get('/ride/:rideId', controller.getPaymentByRideId);

  // Driver Payouts
  router.post('/payout', requireRole('DRIVER') as any, controller.requestPayout);

  return router;
}
