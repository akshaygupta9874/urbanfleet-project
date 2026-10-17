import { Request, Response, NextFunction } from 'express';
import { RideService } from '../services/ride.service.js';
import { FareService } from '../services/fare.service.js';
export class RideController {
  constructor(
    private rideService: RideService,
    private fareService: FareService
  ) {}

  estimateFare = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { pickup, destination } = req.body;
      const estimate = this.fareService.calculateFareEstimate(pickup, destination);
      res.status(200).json({ success: true, data: estimate });
    } catch (err) { next(err); }
  };

  requestRide = async (req: any, res: Response, next: NextFunction) => {
    try {
      const ride = await this.rideService.createRide({
        riderId: req.user.userId,
        ...req.body
      });
      res.status(201).json({ success: true, data: ride });
    } catch (err) { next(err); }
  };

  cancelRide = async (req: any, res: Response, next: NextFunction) => {
    try {
      const ride = await this.rideService.cancelRide(req.params.id, req.user.userId, req.body.reason);
      res.status(200).json({ success: true, data: ride });
    } catch (err) { next(err); }
  };

  getRideById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ride = await this.rideService.getRideById(req.params.id);
      res.status(200).json({ success: true, data: ride });
    } catch (err) { next(err); }
  };

  getRiderHistory = async (req: any, res: Response, next: NextFunction) => {
    try {
      const history = await this.rideService.getRiderHistory(req.user.userId);
      res.status(200).json({ success: true, data: history });
    } catch (err) { next(err); }
  };

  getDriverHistory = async (req: any, res: Response, next: NextFunction) => {
    try {
      const history = await this.rideService.getDriverHistory(req.user.userId);
      res.status(200).json({ success: true, data: history });
    } catch (err) { next(err); }
  };

  getActiveRide = async (req: any, res: Response, next: NextFunction) => {
    try {
      const activeRide = await this.rideService.getActiveRide(req.user.userId);
      res.status(200).json({ success: true, data: activeRide });
    } catch (err) { next(err); }
  };

  submitRating = async (req: any, res: Response, next: NextFunction) => {
    try {
      const { score, feedback } = req.body;
      const rating = await this.rideService.submitRating(req.params.id, req.user.userId, score, feedback);
      res.status(201).json({ success: true, data: rating });
    } catch (err) { next(err); }
  };

  driverAcceptRide = async (req: any, res: Response, next: NextFunction) => {
    try {
      const ride = await this.rideService.acceptRide(req.params.id, req.user.userId);
      res.status(200).json({ success: true, data: ride });
    } catch (err) { next(err); }
  };

  driverArrived = async (req: any, res: Response, next: NextFunction) => {
    try {
      const ride = await this.rideService.driverArrived(req.params.id, req.user.userId);
      res.status(200).json({ success: true, data: ride });
    } catch (err) { next(err); }
  };

  updatePaymentStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { paymentStatus } = req.body;
      const ride = await this.rideService.updatePaymentStatus(req.params.id, paymentStatus);
      res.status(200).json({ success: true, data: ride });
    } catch (err) { next(err); }
  };
}
