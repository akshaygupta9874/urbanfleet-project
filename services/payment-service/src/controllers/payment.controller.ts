import { Request, Response, NextFunction } from 'express';
import { PaymentService } from '../services/payment.service.js';
import { PayoutService } from '../services/payout.service.js';

export class PaymentController {
  constructor(
    private paymentService: PaymentService,
    private payoutService: PayoutService
  ) {}

  createPaymentOrder = async (req: any, res: Response, next: NextFunction) => {
    try {
      const { rideId, amountPaise, driverId } = req.body;
      const order = await this.paymentService.createOrder(rideId, req.user.userId, amountPaise, driverId);
      res.status(201).json({ success: true, data: order });
    } catch (err) { next(err); }
  };

  verifyPayment = async (req: any, res: Response, next: NextFunction) => {
    try {
      const { paymentId, gatewayPaymentId, method } = req.body;
      const captured = await this.paymentService.capturePaymentWithOutbox(paymentId, gatewayPaymentId, method);
      res.status(200).json({ success: true, data: captured });
    } catch (err) { next(err); }
  };

  handleRazorpayWebhook = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await this.paymentService.processWebhook(req.body);
      res.status(200).json({ success: true, data: result });
    } catch (err) { next(err); }
  };

  getPaymentByRideId = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payment = await this.paymentService.getPaymentDetails(req.params.rideId);
      res.status(200).json({ success: true, data: payment });
    } catch (err) { next(err); }
  };

  requestPayout = async (req: any, res: Response, next: NextFunction) => {
    try {
      const { rideId, amountPaise } = req.body;
      const payout = await this.payoutService.createPayoutRequest(req.user.userId, rideId, amountPaise);
      res.status(201).json({ success: true, data: payout });
    } catch (err) { next(err); }
  };
}
