import { Request, Response } from 'express';
import { RideService } from '../services/ride.service.js';
import { FareService } from '../services/fare.service.js';
import asyncHandler from '../middlewares/asyncHandler.js';
import { AuthenticatedRequest, AppError } from '@urbanfleet/common';

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

  requestRide = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
    const ride = await this.rideService.createRide({
      riderId: userId,
      ...req.body
    });
    res.status(201).json({ success: true, data: ride });
  });

  cancelRide = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
    const ride = await this.rideService.cancelRide(req.params.id, userId, req.body.reason);
    res.status(200).json({ success: true, data: ride });
  });

  getRideById = asyncHandler(async (req: Request, res: Response) => {
    const ride = await this.rideService.getRideById(req.params.id);
    res.status(200).json({ success: true, data: ride });
  });

  getRiderHistory = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
    const history = await this.rideService.getRiderHistory(userId);
    res.status(200).json({ success: true, data: history });
  });

  getDriverHistory = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
    const history = await this.rideService.getDriverHistory(userId);
    res.status(200).json({ success: true, data: history });
  });

  getActiveRide = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
    const activeRide = await this.rideService.getActiveRide(userId);
    res.status(200).json({ success: true, data: activeRide });
  });

  submitRating = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
    const { score, feedback } = req.body;
    const rating = await this.rideService.submitRating(req.params.id, userId, score, feedback);
    res.status(201).json({ success: true, data: rating });
  });

  driverAcceptRide = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
    const ride = await this.rideService.acceptRide(req.params.id, userId);
    res.status(200).json({ success: true, data: ride });
  });

  driverArrived = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
    const ride = await this.rideService.driverArrived(req.params.id, userId);
    res.status(200).json({ success: true, data: ride });
  });

  updatePaymentStatus = asyncHandler(async (req: Request, res: Response) => {
    const { paymentStatus } = req.body;
    const ride = await this.rideService.updatePaymentStatus(req.params.id, paymentStatus);
    res.status(200).json({ success: true, data: ride });
  });
}
