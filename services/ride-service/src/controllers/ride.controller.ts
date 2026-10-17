import { Request, Response } from 'express';
import { RideService } from '../services/ride.service.js';
import { FareService } from '../services/fare.service.js';
import type { DispatchService } from '../services/dispatch.service.js';
import asyncHandler from '../middlewares/asyncHandler.js';
import { AuthenticatedRequest, AppError } from '@urbanfleet/common';

export class RideController {
  constructor(
    private rideService: RideService,
    private fareService: FareService,
    private dispatchService?: DispatchService
  ) {}

  estimateFare = asyncHandler(async (req: Request, res: Response) => {
    const { pickup, destination, vehicleCategory } = req.body;
    const estimate = this.fareService.calculateFareEstimate(pickup, destination, vehicleCategory);
    res.status(200).json({ success: true, data: estimate });
  });

  requestRide = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
    const ride = await this.rideService.createRide({
      riderId: userId,
      ...req.body
    });

    if (this.dispatchService) {
      try {
        await this.dispatchService.broadcastRideRequest(ride);
      } catch (err) {
        // Non-blocking dispatch attempt log
      }
    }

    res.status(201).json({ success: true, data: ride });
  });

  cancelRide = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
    const ride = await this.rideService.cancelRide(req.params.id, userId, req.body?.reason);
    res.status(200).json({ success: true, data: ride });
  });

  getRideById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId || req.user?.userId || req.user?.id;
    const ride = await this.rideService.getRideById(req.params.id, userId, req.role || req.user?.role);
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

    const roles = Array.isArray(req.role)
      ? req.role
      : req.role
      ? [req.role]
      : Array.isArray(req.user?.role)
      ? req.user.role
      : [req.user?.role || 'RIDER'];

    const isDriver = roles.includes('DRIVER');
    const activeRide = await this.rideService.getActiveRideForUser(userId, isDriver);
    res.status(200).json({ success: true, data: activeRide });
  });

  submitRating = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
    const { score, feedback, review } = req.body;
    const ratingFeedback = feedback || review;
    const rating = await this.rideService.submitRating(req.params.id, userId, score, ratingFeedback);
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

  updatePaymentStatus = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const internalKey = req.headers['x-internal-service-key'];
    const expectedKey = process.env.INTERNAL_SERVICE_KEY;
    const roles = Array.isArray(req.role)
      ? req.role
      : req.role
      ? [req.role]
      : Array.isArray(req.user?.role)
      ? req.user.role
      : [];
    const isAdmin = roles.includes('ADMIN');
    const isInternalService = expectedKey && internalKey === expectedKey;

    if (!isAdmin && !isInternalService) {
      throw new AppError('Unauthorized: Only payment service or admin can update payment status', 403, 'FORBIDDEN');
    }

    const { paymentStatus } = req.body;
    const ride = await this.rideService.updatePaymentStatus(req.params.id, paymentStatus);
    res.status(200).json({ success: true, data: ride });
  });
}
