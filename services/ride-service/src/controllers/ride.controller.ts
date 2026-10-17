import { Request, Response } from 'express';
import { RideService } from '../services/ride.service.js';
import { FareService } from '../services/fare.service.js';
import asyncHandler from '../middlewares/asyncHandler.js';

export class RideController {
  constructor(
    private rideService: RideService,
    private fareService: FareService
  ) {}

  estimateFare = asyncHandler(async (req: Request, res: Response) => {
    const { pickup, destination } = req.body;
    const estimate = this.fareService.calculateFareEstimate(pickup, destination);
    res.status(200).json({ success: true, data: estimate });
  });

  requestRide = asyncHandler(async (req: any, res: Response) => {
    const ride = await this.rideService.createRide({
      riderId: req.user.userId,
      ...req.body
    });
    res.status(201).json({ success: true, data: ride });
  });

  cancelRide = asyncHandler(async (req: any, res: Response) => {
    const ride = await this.rideService.cancelRide(req.params.id, req.user.userId, req.body.reason);
    res.status(200).json({ success: true, data: ride });
  });

  getRideById = asyncHandler(async (req: Request, res: Response) => {
    const ride = await this.rideService.getRideById(req.params.id);
    res.status(200).json({ success: true, data: ride });
  });

  getRiderHistory = asyncHandler(async (req: any, res: Response) => {
    const history = await this.rideService.getRiderHistory(req.user.userId);
    res.status(200).json({ success: true, data: history });
  });

  getDriverHistory = asyncHandler(async (req: any, res: Response) => {
    const history = await this.rideService.getDriverHistory(req.user.userId);
    res.status(200).json({ success: true, data: history });
  });

  getActiveRide = asyncHandler(async (req: any, res: Response) => {
    const activeRide = await this.rideService.getActiveRide(req.user.userId);
    res.status(200).json({ success: true, data: activeRide });
  });

  submitRating = asyncHandler(async (req: any, res: Response) => {
    const { score, feedback } = req.body;
    const rating = await this.rideService.submitRating(req.params.id, req.user.userId, score, feedback);
    res.status(201).json({ success: true, data: rating });
  });

  driverAcceptRide = asyncHandler(async (req: any, res: Response) => {
    const ride = await this.rideService.acceptRide(req.params.id, req.user.userId);
    res.status(200).json({ success: true, data: ride });
  });

  driverArrived = asyncHandler(async (req: any, res: Response) => {
    const ride = await this.rideService.driverArrived(req.params.id, req.user.userId);
    res.status(200).json({ success: true, data: ride });
  });

  updatePaymentStatus = asyncHandler(async (req: Request, res: Response) => {
    const { paymentStatus } = req.body;
    const ride = await this.rideService.updatePaymentStatus(req.params.id, paymentStatus);
    res.status(200).json({ success: true, data: ride });
  });
}
