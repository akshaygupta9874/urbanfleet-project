import { Router } from 'express';
import { PaymentController } from '../controllers/payment.controller.js';
import { authMiddleware, requireRole } from '../middlewares/auth.middleware.js';

export function createPaymentRouter(controller: PaymentController): Router {
  const router = Router();

  // Public Webhook from Razorpay
  router.post('/webhook', controller.handleRazorpayWebhook);

  // Authenticated Endpoints
  router.use(authMiddleware);

  router.post('/order', controller.createPaymentOrder);
  router.post('/verify', controller.verifyPayment);
  router.get('/ride/:rideId', controller.getPaymentByRideId);

  // Driver Payouts
  router.post('/payout', requireRole('DRIVER'), controller.requestPayout);

  return router;
}
