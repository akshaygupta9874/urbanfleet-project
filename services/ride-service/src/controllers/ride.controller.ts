import { Request, Response } from 'express';
import { RidePaymentStatus } from '../db/client.js';
import { RideService, CreateRideInput } from '../services/ride.service.js';
import { FareService } from '../services/fare.service.js';
import type { DispatchService } from '../services/dispatch.service.js';
import asyncHandler from '../middlewares/asyncHandler.js';
import { AuthenticatedRequest, AppError, ForbiddenError, createLogger } from '@urbanfleet/common';

const logger = createLogger('ride-controller');
import type { EstimateFareDTO, RequestRideDTO } from '../validation/ride.validation.js';
import { toRideDto, toRideDtoWithDriver } from '../utils/ride-dto.js';
import { emitPaymentCaptured as emitPaymentCapturedToDriver } from '../websocket/emitters/driver.emitter.js';
import { emitPaymentCaptured as emitPaymentCapturedToRider } from '../websocket/emitters/rider.emitter.js';

function extractRecord(val: unknown): Record<string, unknown> | undefined {
  return val && typeof val === 'object' ? (val as Record<string, unknown>) : undefined;
}

function getUserId(req: AuthenticatedRequest): string {
  const userId = req.userId;
  if (!userId) {
    throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
  }
  return userId;
}

function getRideId(req: Request): string {
  const rideId = req.params.id;
  if (!rideId) {
    throw new AppError('Ride ID is required in route params', 400, 'BAD_REQUEST');
  }
  return rideId;
}

export class RideController {
  private rideService: RideService;
  private fareService: FareService;
  private dispatchService?: DispatchService;

  constructor(
    rideService: RideService,
    fareService: FareService,
    dispatchService?: DispatchService
  ) {
    this.rideService = rideService;
    this.fareService = fareService;
    this.dispatchService = dispatchService;
  }

  estimateFare = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as EstimateFareDTO;
    const estimate = this.fareService.calculateFareEstimate(
      body.pickup,
      body.destination,
      body.vehicleCategory
    );
    res.status(200).json({ success: true, data: estimate });
  });

  requestRide = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const roles: string[] = req.roles ?? req.role ?? [];
    if (!roles.includes('RIDER')) {
      throw new ForbiddenError('Only accounts with the RIDER role can request rides');
    }
    const body = req.body as RequestRideDTO;
    const input: CreateRideInput = {
      riderId: userId,
      pickup: body.pickup,
      destination: body.destination,
      vehicleCategory: body.vehicleCategory,
      estimatedFare: body.estimatedFare,
      estimatedDistance: body.estimatedDistance,
      estimatedDuration: body.estimatedDuration,
    };
    const ride = await this.rideService.createRide(input);
    if (!ride) {
      throw new AppError('Failed to create ride', 500, 'INTERNAL_SERVER_ERROR');
    }

    if (this.dispatchService) {
      try {
        await this.dispatchService.broadcastRideRequest(ride);
      } catch (err: unknown) {
        logger.warn('Failed to broadcast ride request to nearby drivers', {
          rideId: ride.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const formatted = await toRideDtoWithDriver(ride);
    const otp = await this.rideService.getRiderOtpForRide(ride.id, userId);
    res.status(201).json({
      success: true,
      message: 'Ride requested successfully',
      data: { ...formatted, otp },
    });
  });

  cancelRide = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const rideId = getRideId(req);
    const body = extractRecord(req.body);
    const reason = typeof body?.cancellationReason === 'string' && body.cancellationReason.trim()
      ? body.cancellationReason
      : 'Ride cancelled by user';

    const ride = await this.rideService.cancelRide(rideId, userId, reason);
    if (!ride) {
      throw new AppError('Failed to cancel ride', 500, 'INTERNAL_SERVER_ERROR');
    }
    const formatted = toRideDto(ride);
    res.status(200).json({ success: true, data: formatted });
  });

  cancelRideByDriver = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const rideId = getRideId(req);
    const body = extractRecord(req.body);
    const reason = typeof body?.cancellationReason === 'string' && body.cancellationReason.trim()
      ? body.cancellationReason
      : 'Ride cancelled by driver';

    const ride = await this.rideService.cancelRideByDriver({ rideId, driverId: userId, reason });
    if (!ride) {
      throw new AppError('Failed to cancel ride', 500, 'INTERNAL_SERVER_ERROR');
    }
    const formatted = toRideDto(ride);
    res.status(200).json({ success: true, data: formatted });
  });

  getRideById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const rideId = getRideId(req);
    const userId = req.userId;
    const roles = req.roles ?? req.role ?? [];
    const userRole = roles[0] || 'RIDER';
    const ride = await this.rideService.getRideById(rideId, userId, userRole);
    if (!ride) {
      throw new AppError('Ride not found', 404, 'NOT_FOUND');
    }
    const formatted = await toRideDtoWithDriver(ride);
    const isRider = Boolean(userId && ride.riderId === userId);
    res.status(200).json({
      success: true,
      data: isRider ? { ...formatted, otp: ride.otp } : { ...formatted, otp: null },
    });
  });

  getRiderHistory = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const history = await this.rideService.getRiderHistory(userId);
    const formattedList = (history || []).map((r) => toRideDto(r));
    res.status(200).json({
      success: true,
      data: formattedList,
      totalRides: formattedList.length,
    });
  });

  getDriverHistory = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const history = await this.rideService.getDriverHistory(userId);
    const formattedList = (history || []).map((r) => toRideDto(r));
    res.status(200).json({
      success: true,
      data: formattedList,
      totalRides: formattedList.length,
    });
  });

  getActiveRide = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const roles = req.roles ?? req.role ?? [];
    let activeRide = await this.rideService.getActiveRideForUser(userId, false);
    let isDriverView = false;
    if (!activeRide) {
      // Only fallback to driver ride if user is exclusively a driver (no RIDER role).
      // For dual-role users, /ride/current must strictly reflect their passenger status.
      const isPureDriver = !roles.includes('RIDER') && roles.includes('DRIVER');
      if (isPureDriver) {
        activeRide = await this.rideService.getActiveRideForUser(userId, true);
        isDriverView = true;
      }
    }
    const formatted = activeRide ? await toRideDtoWithDriver(activeRide) : null;
    res.status(200).json({
      success: true,
      data: formatted && !isDriverView ? { ...formatted, otp: activeRide?.otp ?? null } : formatted,
    });
  });

  getCurrentRideOfDriver = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const activeRide = await this.rideService.getActiveRideForUser(userId, true);
    const formatted = activeRide ? await toRideDtoWithDriver(activeRide) : null;
    res.status(200).json({ success: true, data: formatted });
  });

  submitRating = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const rideId = getRideId(req);
    const body = extractRecord(req.body) || {};
    const score = Number(body.score);
    const feedback = typeof body.feedback === 'string' ? body.feedback : undefined;
    const rating = await this.rideService.submitRating(rideId, userId, score, feedback);
    if (!rating) {
      throw new AppError('Failed to submit rating', 500, 'INTERNAL_SERVER_ERROR');
    }
    res.status(201).json({ success: true, data: rating });
  });

  driverAcceptRide = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const rideId = getRideId(req);
    const ride = await this.rideService.acceptRide(rideId, userId);
    if (!ride) {
      throw new AppError('Failed to accept ride', 500, 'INTERNAL_SERVER_ERROR');
    }
    const formatted = await toRideDtoWithDriver(ride);
    res.status(200).json({ success: true, data: formatted });
  });

  driverArrived = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const rideId = getRideId(req);
    const ride = await this.rideService.driverArrived(rideId, userId);
    if (!ride) {
      throw new AppError('Failed to update driver arrival', 500, 'INTERNAL_SERVER_ERROR');
    }
    const formatted = await toRideDtoWithDriver(ride);
    res.status(200).json({ success: true, data: formatted });
  });

  driverArrivedAtDestination = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const rideId = getRideId(req);
    const ride = await this.rideService.arriveAtDestination({ rideId, driverId: userId });
    if (!ride) {
      throw new AppError('Failed to arrive at destination', 500, 'INTERNAL_SERVER_ERROR');
    }
    const formatted = await toRideDtoWithDriver(ride);
    res.status(200).json({ success: true, data: formatted });
  });

  startRide = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const rideId = getRideId(req);
    const body = extractRecord(req.body) || {};
    const otp = typeof body.otp === 'string' ? body.otp : '';
    const ride = await this.rideService.startRide(rideId, userId, otp);
    if (!ride) {
      throw new AppError('Failed to start ride', 500, 'INTERNAL_SERVER_ERROR');
    }
    const formatted = await toRideDtoWithDriver(ride);
    res.status(200).json({ success: true, data: formatted });
  });

  completeRide = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const rideId = getRideId(req);
    const ride = await this.rideService.completeRide(rideId, userId);
    if (!ride) {
      throw new AppError('Failed to complete ride', 500, 'INTERNAL_SERVER_ERROR');
    }
    const formatted = await toRideDtoWithDriver(ride);
    res.status(200).json({ success: true, data: formatted });
  });

  updatePaymentStatus = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

    const rideId = getRideId(req);
    const body = extractRecord(req.body) || {};
    const paymentStatus = body.paymentStatus as RidePaymentStatus;
    const ride = await this.rideService.updatePaymentStatus(rideId, paymentStatus);
    if (!ride) {
      throw new AppError('Failed to update payment status', 500, 'INTERNAL_SERVER_ERROR');
    }
    const formatted = toRideDto(ride);
    if (paymentStatus === RidePaymentStatus.CAPTURED) {
      const payload = {
        ride: {
          id: formatted.id,
          paymentStatus: formatted.paymentStatus,
        },
      };
      emitPaymentCapturedToRider(ride.riderId, payload);
      if (ride.driverId) {
        emitPaymentCapturedToDriver(ride.driverId, payload);
      }
    }
    res.status(200).json({ success: true, data: formatted });
  });
}
