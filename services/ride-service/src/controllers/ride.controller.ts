import { Request, Response } from 'express';
import { Ride, RidePaymentStatus } from '../db/client.js';
import { RideService, CreateRideInput, RideWithOtp, CancelledRideResult } from '../services/ride.service.js';
import { FareService, IFareBreakdown, CoordinatePoint } from '../services/fare.service.js';
import type { DispatchService } from '../services/dispatch.service.js';
import asyncHandler from '../middlewares/asyncHandler.js';
import { AuthenticatedRequest, AppError } from '@urbanfleet/common';

export interface FormattedLocation {
  address: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
}

export interface FormattedFare {
  estimated: number;
  final: number | null;
  breakdown: IFareBreakdown;
  fareBreakdown: IFareBreakdown;
}

export interface FormattedDriver {
  id: string;
  firstName: string;
  lastName: string;
  vehicleNumber: string;
  phone: string;
  user: {
    firstName: string;
    lastName: string;
    phone: string;
  };
  vehicle: {
    registrationNumber: string;
    model: string;
    color: string;
  };
}

export interface FormattedRide {
  id: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  pickup: FormattedLocation;
  destination: FormattedLocation;
  fare: FormattedFare;
  distance: {
    estimated: number;
    actual: number;
  };
  duration: {
    estimated: number;
    actual: number | null;
  };
  status: string;
  paymentStatus: string;
  driver: FormattedDriver | null;
  [key: string]: unknown;
}

function extractRecord(val: unknown): Record<string, unknown> | undefined {
  return val && typeof val === 'object' ? (val as Record<string, unknown>) : undefined;
}

export function toRideResponse(
  ride: Ride | RideWithOtp | CancelledRideResult | Record<string, unknown> | null | undefined
): FormattedRide | null {
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

  const fareBreakdown: IFareBreakdown = {
    baseFarePaise,
    distanceFarePaise,
    timeFarePaise,
    surgePaise: 0,
    platformCommissionPaise,
    driverEarningPaise,
    totalPaise: totalFarePaise,
  };

  const id = String(r.id || '');
  const pickupAddress = String(r.pickupAddress || 'Pickup Location');
  const destinationAddress = String(r.destinationAddress || 'Destination Location');

  const driverObj = extractRecord(r.driver);
  const driverUser = extractRecord(driverObj?.user);
  const driverVehicle = extractRecord(driverObj?.vehicle);
  const driverId = r.driverId ? String(r.driverId) : (driverObj?.id ? String(driverObj.id) : undefined);

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
    ...r,
    id,
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
      breakdown: fareBreakdown,
      fareBreakdown: fareBreakdown,
    },
    fareBreakdown,
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
  };
}

export const formatRideForFrontend = toRideResponse;

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
    const body = extractRecord(req.body) || {};
    const pickup = body.pickup as CoordinatePoint;
    const destination = body.destination as CoordinatePoint;
    const vehicleCategory = String(body.vehicleCategory || 'CAR');
    const estimate = this.fareService.calculateFareEstimate(pickup, destination, vehicleCategory);
    res.status(200).json({ success: true, data: estimate, fare: estimate });
  });

  requestRide = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const body = extractRecord(req.body) || {};
    const input: CreateRideInput = {
      riderId: userId,
      pickup: body.pickup as CoordinatePoint,
      destination: body.destination as CoordinatePoint,
      vehicleCategory: typeof body.vehicleCategory === 'string' ? body.vehicleCategory : undefined,
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

    const formatted = toRideResponse(ride);
    res.status(201).json({
      success: true,
      message: 'Ride requested successfully',
      data: formatted,
      ride: formatted,
    });
  });

  cancelRide = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const rideId = getRideId(req);
    const body = extractRecord(req.body);
    const rawReason = body?.reason ?? body?.cancellationReason;
    const reason = typeof rawReason === 'string' && rawReason.trim() ? rawReason : 'Ride cancelled by user';

    const ride = await this.rideService.cancelRide(rideId, userId, reason);
    if (!ride) {
      throw new AppError('Failed to cancel ride', 500, 'INTERNAL_SERVER_ERROR');
    }
    const formatted = toRideResponse(ride);
    res.status(200).json({ success: true, data: formatted, ride: formatted });
  });

  cancelRideByDriver = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const rideId = getRideId(req);
    const body = extractRecord(req.body);
    const rawReason = body?.reason ?? body?.cancellationReason;
    const reason = typeof rawReason === 'string' && rawReason.trim() ? rawReason : 'Ride cancelled by driver';

    const ride = await this.rideService.cancelRideByDriver({ rideId, driverId: userId, reason });
    if (!ride) {
      throw new AppError('Failed to cancel ride', 500, 'INTERNAL_SERVER_ERROR');
    }
    const formatted = toRideResponse(ride);
    res.status(200).json({ success: true, data: formatted, ride: formatted });
  });

  getRideById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const rideId = getRideId(req);
    const userId = getUserId(req);
    const roles = req.role || [];
    const userRole = roles[0] || 'RIDER';
    const ride = await this.rideService.getRideById(rideId, userId, userRole);
    if (!ride) {
      throw new AppError('Ride not found', 404, 'NOT_FOUND');
    }
    const formatted = toRideResponse(ride);
    res.status(200).json({ success: true, data: formatted, ride: formatted });
  });

  getRiderHistory = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const history = await this.rideService.getRiderHistory(userId);
    const formattedList = (history || []).map(toRideResponse);
    res.status(200).json({
      success: true,
      data: formattedList,
      rides: formattedList,
      totalRides: formattedList.length,
    });
  });

  getDriverHistory = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const history = await this.rideService.getDriverHistory(userId);
    const formattedList = (history || []).map(toRideResponse);
    res.status(200).json({
      success: true,
      data: formattedList,
      rides: formattedList,
      totalRides: formattedList.length,
    });
  });

  getActiveRide = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const roles = req.role || [];
    const isDriver = roles.includes('DRIVER');
    const activeRide = await this.rideService.getActiveRideForUser(userId, isDriver);
    const formatted = activeRide ? toRideResponse(activeRide) : null;
    res.status(200).json({ success: true, data: formatted, ride: formatted });
  });

  getCurrentRideOfDriver = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const activeRide = await this.rideService.getActiveRideForUser(userId, true);
    const formatted = activeRide ? toRideResponse(activeRide) : null;
    res.status(200).json({ success: true, data: formatted, ride: formatted });
  });

  submitRating = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const rideId = getRideId(req);
    const body = extractRecord(req.body) || {};
    const score = Number(body.score);
    const feedback = typeof body.feedback === 'string' ? body.feedback : typeof body.review === 'string' ? body.review : undefined;
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
    const formatted = toRideResponse(ride);
    res.status(200).json({ success: true, data: formatted, ride: formatted });
  });

  driverArrived = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const rideId = getRideId(req);
    const ride = await this.rideService.driverArrived(rideId, userId);
    if (!ride) {
      throw new AppError('Failed to update driver arrival', 500, 'INTERNAL_SERVER_ERROR');
    }
    const formatted = toRideResponse(ride);
    res.status(200).json({ success: true, data: formatted, ride: formatted });
  });

  driverArrivedAtDestination = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const rideId = getRideId(req);
    const ride = await this.rideService.arriveAtDestination({ rideId, driverId: userId });
    if (!ride) {
      throw new AppError('Failed to arrive at destination', 500, 'INTERNAL_SERVER_ERROR');
    }
    const formatted = toRideResponse(ride);
    res.status(200).json({ success: true, data: formatted, ride: formatted });
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
    const formatted = toRideResponse(ride);
    res.status(200).json({ success: true, data: formatted, ride: formatted });
  });

  completeRide = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req);
    const rideId = getRideId(req);
    const ride = await this.rideService.completeRide(rideId, userId);
    if (!ride) {
      throw new AppError('Failed to complete ride', 500, 'INTERNAL_SERVER_ERROR');
    }
    const formatted = toRideResponse(ride);
    res.status(200).json({ success: true, data: formatted, ride: formatted });
  });

  updatePaymentStatus = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const internalKey = req.headers['x-internal-service-key'];
    const expectedKey = process.env.INTERNAL_SERVICE_KEY;
    const roles = req.role || [];
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
    const formatted = toRideResponse(ride);
    res.status(200).json({ success: true, data: formatted, ride: formatted });
  });
}
