import { Request, Response } from 'express';
import { PaymentService } from '../services/payment.service.js';
import { PayoutService } from '../services/payout.service.js';
import asyncHandler from '../middlewares/asyncHandler.js';

export class PaymentController {
  constructor(
    private paymentService: PaymentService,
    private payoutService: PayoutService
  ) {}

  createPaymentOrder = asyncHandler(async (req: any, res: Response) => {
    const { rideId, amountPaise, driverId } = req.body;
    const order = await this.paymentService.createOrder(rideId, req.user.userId, amountPaise, driverId);
    res.status(201).json({ success: true, data: order });
  });

  verifyPayment = asyncHandler(async (req: any, res: Response) => {
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

  requestPayout = asyncHandler(async (req: any, res: Response) => {
    const { rideId, amountPaise } = req.body;
    const payout = await this.payoutService.createPayoutRequest(req.user.userId, rideId, amountPaise);
    res.status(201).json({ success: true, data: payout });
  });
}
