import { Request, Response } from 'express';
import { Ride, RidePaymentStatus } from '../db/client.js';
import { RideService, CreateRideInput, RideWithOtp, CancelledRideResult } from '../services/ride.service.js';
import { FareService } from '../services/fare.service.js';
import type { DispatchService } from '../services/dispatch.service.js';
import asyncHandler from '../middlewares/asyncHandler.js';
import { AuthenticatedRequest, AppError, RideDto, FormattedDriver, LocationPoint, IFareBreakdown } from '@urbanfleet/common';
import type { EstimateFareDTO, RequestRideDTO } from '../validation/ride.validation.js';

function extractRecord(val: unknown): Record<string, unknown> | undefined {
  return val && typeof val === 'object' ? (val as Record<string, unknown>) : undefined;
}

export function toRideDto(
  ride: Ride | RideWithOtp | CancelledRideResult | Record<string, unknown> | null | undefined
): RideDto | null {
  if (!ride) return null;

  const r = ride as Record<string, unknown>;
  const pickupLat = Number(r.pickupLat ?? 0);
  const pickupLng = Number(r.pickupLng ?? 0);
  const destLat = Number(r.destinationLat ?? 0);
  const destLng = Number(r.destinationLng ?? 0);

  const totalFarePaise = Number(r.totalFarePaise ?? 0);
  const baseFarePaise = Number(r.baseFarePaise ?? (totalFarePaise > 0 ? Math.round(totalFarePaise * 0.4) : 0));
  const distanceKm = Number(r.distanceKm ?? 0);
  const distanceFarePaise = Math.round(distanceKm * 500);
  const timeFarePaise = Math.max(0, totalFarePaise - baseFarePaise - distanceFarePaise);
  const driverEarningPaise = Math.round(totalFarePaise * 0.8);
  const platformCommissionPaise = totalFarePaise - driverEarningPaise;

  const breakdown: IFareBreakdown = {
    baseFarePaise,
    distanceFarePaise,
    timeFarePaise,
    surgePaise: 0,
    platformCommissionPaise,
    driverEarningPaise,
    totalPaise: totalFarePaise,
  };

  const id = String(r.id || '');
  const riderId = String(r.riderId || '');
  const pickupAddress = String(r.pickupAddress || 'Pickup Location');
  const destinationAddress = String(r.destinationAddress || 'Destination Location');

  const driverObj = extractRecord(r.driver);
  const driverUser = extractRecord(driverObj?.user);
  const driverVehicle = extractRecord(driverObj?.vehicle);
  const driverId = r.driverId ? String(r.driverId) : (driverObj?.id ? String(driverObj.id) : null);

  const formattedDriver: FormattedDriver | null = driverId
    ? {
        id: driverId,
        firstName: String(driverUser?.firstName || ''),
        lastName: String(driverUser?.lastName || ''),
        vehicleNumber: String(driverVehicle?.registrationNumber || ''),
        phone: String(driverUser?.phone || ''),
        user: {
          firstName: String(driverUser?.firstName || ''),
          lastName: String(driverUser?.lastName || ''),
          phone: String(driverUser?.phone || ''),
        },
        vehicle: {
          registrationNumber: String(driverVehicle?.registrationNumber || ''),
          model: String(driverVehicle?.model || ''),
          color: String(driverVehicle?.color || ''),
        },
      }
    : null;

  return {
    id,
    riderId,
    driverId,
    pickupAddress,
    pickupLat,
    pickupLng,
    destinationAddress,
    destinationLat: destLat,
    destinationLng: destLng,
    pickup: {
      address: pickupAddress,
      coordinates: {
        latitude: pickupLat,
        longitude: pickupLng,
      },
    },
    destination: {
      address: destinationAddress,
      coordinates: {
        latitude: destLat,
        longitude: destLng,
      },
    },
    fare: {
      estimated: totalFarePaise,
      final: r.status === 'COMPLETED' ? Number(r.finalFarePaise ?? totalFarePaise) : null,
      breakdown,
    },
    distance: {
      estimated: distanceKm,
      actual: r.actualDistanceKm ? Number(r.actualDistanceKm) : distanceKm,
    },
    duration: {
      estimated: r.durationMinutes ? Number(r.durationMinutes) : 15,
      actual: r.actualDurationMinutes ? Number(r.actualDurationMinutes) : null,
    },
    status: String(r.status || 'SEARCHING'),
    paymentStatus: String(r.paymentStatus || 'PENDING'),
    driver: formattedDriver,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : r.createdAt instanceof Date ? r.createdAt.toISOString() : undefined,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : r.updatedAt instanceof Date ? r.updatedAt.toISOString() : undefined,
  };
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
    const body = req.body as RequestRideDTO;
    const input: CreateRideInput = {
      riderId: userId,
      pickup: body.pickup,
      destination: body.destination,
      vehicleCategory: body.vehicleCategory,
    };
    const ride = await this.rideService.createRide(input);
    if (!ride) {
      throw new AppError('Failed to create ride', 500, 'INTERNAL_SERVER_ERROR');
    }

    if (this.dispatchService) {
      try {
        await this.dispatchService.broadcastRideRequest(ride);
      } catch (err) {
        // Non-blocking dispatch attempt log
      }
    }

    const formatted = toRideDto(ride);
    res.status(201).json({
      success: true,
      message: 'Ride requested successfully',
      data: formatted,
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
    const userId = getUserId(req);
    const roles = req.roles ?? req.role ?? [];
    const userRole = roles[0] || 'RIDER';
    const ride = await this.rideService.getRideById(rideId, userId, userRole);
    if (!ride) {
      throw new AppError('Ride not found', 404, 'NOT_FOUND');
    }
    const formatted = toRideDto(ride);
    res.status(200).json({ success: true, data: formatted });
  });

  getRiderHistory = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const history = await this.rideService.getRiderHistory(userId);
    const formattedList = (history || []).map(toRideDto);
    res.status(200).json({
      success: true,
      data: formattedList,
      totalRides: formattedList.length,
    });
  });

  getDriverHistory = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const history = await this.rideService.getDriverHistory(userId);
    const formattedList = (history || []).map(toRideDto);
    res.status(200).json({
      success: true,
      data: formattedList,
      totalRides: formattedList.length,
    });
  });

  getActiveRide = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const roles = req.roles ?? req.role ?? [];
    const isDriver = roles.includes('DRIVER');
    const activeRide = await this.rideService.getActiveRideForUser(userId, isDriver);
    const formatted = activeRide ? toRideDto(activeRide) : null;
    res.status(200).json({ success: true, data: formatted });
  });

  getCurrentRideOfDriver = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const activeRide = await this.rideService.getActiveRideForUser(userId, true);
    const formatted = activeRide ? toRideDto(activeRide) : null;
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
    const formatted = toRideDto(ride);
    res.status(200).json({ success: true, data: formatted });
  });

  driverArrived = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const rideId = getRideId(req);
    const ride = await this.rideService.driverArrived(rideId, userId);
    if (!ride) {
      throw new AppError('Failed to update driver arrival', 500, 'INTERNAL_SERVER_ERROR');
    }
    const formatted = toRideDto(ride);
    res.status(200).json({ success: true, data: formatted });
  });

  driverArrivedAtDestination = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const rideId = getRideId(req);
    const ride = await this.rideService.arriveAtDestination({ rideId, driverId: userId });
    if (!ride) {
      throw new AppError('Failed to arrive at destination', 500, 'INTERNAL_SERVER_ERROR');
    }
    const formatted = toRideDto(ride);
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
    const formatted = toRideDto(ride);
    res.status(200).json({ success: true, data: formatted });
  });

  completeRide = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const rideId = getRideId(req);
    const ride = await this.rideService.completeRide(rideId, userId);
    if (!ride) {
      throw new AppError('Failed to complete ride', 500, 'INTERNAL_SERVER_ERROR');
    }
    const formatted = toRideDto(ride);
    res.status(200).json({ success: true, data: formatted });
  });

  updatePaymentStatus = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const internalKey = req.headers['x-internal-service-key'];
    const expectedKey = process.env.INTERNAL_SERVICE_KEY;
    const roles = req.roles ?? req.role ?? [];
    const isAdmin = roles.includes('ADMIN');
    const isInternalService = Boolean(expectedKey && internalKey === expectedKey);

    if (!isAdmin && !isInternalService) {
      throw new AppError('Unauthorized: Only payment service or admin can update payment status', 403, 'FORBIDDEN');
    }

    const rideId = getRideId(req);
    const body = extractRecord(req.body) || {};
    const paymentStatus = body.paymentStatus as RidePaymentStatus;
    const ride = await this.rideService.updatePaymentStatus(rideId, paymentStatus);
    if (!ride) {
      throw new AppError('Failed to update payment status', 500, 'INTERNAL_SERVER_ERROR');
    }
    const formatted = toRideDto(ride);
    res.status(200).json({ success: true, data: formatted });
  });
}
