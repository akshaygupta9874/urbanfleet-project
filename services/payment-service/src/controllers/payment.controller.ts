import { Request, Response } from 'express';
import { PaymentService } from '../services/payment.service.js';
import { PayoutService } from '../services/payout.service.js';
import asyncHandler from '../middlewares/asyncHandler.js';
import { AuthenticatedRequest, AppError } from '@urbanfleet/common';

export class PaymentController {
  constructor(
    private paymentService: PaymentService,
    private payoutService: PayoutService
  ) {}

  createPaymentOrder = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
    const { rideId, amountPaise, driverId } = req.body;
    const order = await this.paymentService.createOrder(rideId, userId, amountPaise, driverId);
    res.status(201).json({ success: true, data: order });
  });

  verifyPayment = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { paymentId, gatewayPaymentId, method } = req.body;
    const captured = await this.paymentService.capturePaymentWithOutbox(paymentId, gatewayPaymentId, method);
    res.status(200).json({ success: true, data: captured });
  });

  handleRazorpayWebhook = asyncHandler(async (req: Request, res: Response) => {
    const signature = (req.headers['x-razorpay-signature'] || '') as string;
    const result = await this.paymentService.processWebhook(req.body, signature);
    res.status(200).json({ success: true, data: result });
  });

  getPaymentByRideId = asyncHandler(async (req: Request, res: Response) => {
    const payment = await this.paymentService.getPaymentDetails(req.params.rideId);
    res.status(200).json({ success: true, data: payment });
  });

  requestPayout = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
    const { rideId, amountPaise } = req.body;
    const payout = await this.payoutService.createPayoutRequest(userId, rideId, amountPaise);
    res.status(201).json({ success: true, data: payout });
  });
}
