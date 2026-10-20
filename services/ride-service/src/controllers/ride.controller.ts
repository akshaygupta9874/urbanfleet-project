import { Request, Response } from 'express';
import { RideService } from '../services/ride.service.js';
import { FareService } from '../services/fare.service.js';
import type { DispatchService } from '../services/dispatch.service.js';
import asyncHandler from '../middlewares/asyncHandler.js';
import { AuthenticatedRequest, AppError } from '@urbanfleet/common';

export function formatRideForFrontend(ride: any) {
  if (!ride) return null;

  const pickupLat = Number(ride.pickupLat ?? ride.pickup?.coordinates?.latitude ?? ride.pickup?.lat ?? 0);
  const pickupLng = Number(ride.pickupLng ?? ride.pickup?.coordinates?.longitude ?? ride.pickup?.lng ?? 0);
  const destLat = Number(ride.destinationLat ?? ride.destination?.coordinates?.latitude ?? ride.destination?.lat ?? 0);
  const destLng = Number(ride.destinationLng ?? ride.destination?.coordinates?.longitude ?? ride.destination?.lng ?? 0);

  const totalFarePaise = Number(ride.totalFarePaise ?? ride.fare?.estimated ?? 0);
  const baseFarePaise = Number(ride.baseFarePaise ?? (totalFarePaise > 0 ? Math.round(totalFarePaise * 0.4) : 0));
  const distanceKm = Number(ride.distanceKm ?? ride.distance?.estimated ?? 0);
  const distanceFarePaise = Math.round(distanceKm * 500);
  const timeFarePaise = Math.max(0, totalFarePaise - baseFarePaise - distanceFarePaise);
  const driverEarningPaise = Math.round(totalFarePaise * 0.8);
  const platformCommissionPaise = totalFarePaise - driverEarningPaise;

  const fareBreakdown = {
    baseFarePaise,
    distanceFarePaise,
    timeFarePaise,
    surgePaise: 0,
    platformCommissionPaise,
    driverEarningPaise,
    totalPaise: totalFarePaise,
  };

  const id = ride.id;

  return {
    ...ride,
    id,
    pickupAddress: ride.pickupAddress || ride.pickup?.address || 'Pickup Location',
    pickupLat,
    pickupLng,
    destinationAddress: ride.destinationAddress || ride.destination?.address || 'Destination Location',
    destinationLat: destLat,
    destinationLng: destLng,
    pickup: {
      address: ride.pickupAddress || ride.pickup?.address || 'Pickup Location',
      coordinates: {
        latitude: pickupLat,
        longitude: pickupLng,
      },
    },
    destination: {
      address: ride.destinationAddress || ride.destination?.address || 'Destination Location',
      coordinates: {
        latitude: destLat,
        longitude: destLng,
      },
    },
    fare: {
      estimated: totalFarePaise,
      final: ride.status === 'COMPLETED' ? (ride.finalFarePaise ?? totalFarePaise) : null,
      breakdown: fareBreakdown,
      fareBreakdown: fareBreakdown,
    },
    distance: {
      estimated: distanceKm,
      actual: ride.actualDistanceKm ? Number(ride.actualDistanceKm) : distanceKm,
    },
    duration: {
      estimated: ride.durationMinutes ? Number(ride.durationMinutes) : 15,
      actual: ride.actualDurationMinutes ? Number(ride.actualDurationMinutes) : null,
    },
    status: ride.status,
    paymentStatus: ride.paymentStatus || 'PENDING',
    driver: ride.driverId
      ? {
          id: ride.driverId,
          firstName: ride.driver?.user?.firstName || 'Assigned',
          lastName: ride.driver?.user?.lastName || 'Driver',
          vehicleNumber: ride.driver?.vehicle?.registrationNumber || 'KA-01-UF-1001',
          phone: ride.driver?.user?.phone || '+91 98765 43210',
          user: {
            firstName: ride.driver?.user?.firstName || 'Assigned',
            lastName: ride.driver?.user?.lastName || 'Driver',
            phone: ride.driver?.user?.phone || '+91 98765 43210',
          },
          vehicle: {
            registrationNumber: ride.driver?.vehicle?.registrationNumber || 'KA-01-UF-1001',
            model: ride.driver?.vehicle?.model || 'Urban Cruiser',
            color: ride.driver?.vehicle?.color || 'Black',
          },
        }
      : null,
  };
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
    const pickup = req.body?.pickup;
    const destination = req.body?.destination;
    const vehicleCategory = req.body?.vehicleCategory || req.body?.vehicleType || 'CAR';
    const estimate = this.fareService.calculateFareEstimate(pickup, destination, vehicleCategory);
    res.status(200).json({ success: true, data: estimate, fare: estimate });
  });

  requestRide = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId || req.user?.userId || req.user?.id || req.body?.rider || req.body?.riderId;
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

    const formatted = formatRideForFrontend(ride);
    res.status(201).json({
      success: true,
      message: 'Ride requested successfully',
      data: formatted,
      ride: formatted,
    });
  });

  cancelRide = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
    const rideId = req.params.rideId || req.params.id;
    const reason = req.body?.reason || req.body?.cancellationReason || 'Ride cancelled by user';
    const ride = await this.rideService.cancelRide(rideId, userId, reason);
    const formatted = formatRideForFrontend(ride);
    res.status(200).json({ success: true, data: formatted, ride: formatted });
  });

  cancelRideByDriver = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
    const rideId = req.params.rideId || req.params.id;
    const reason = req.body?.reason || req.body?.cancellationReason || 'Ride cancelled by driver';
    const ride = await this.rideService.cancelRideByDriver({ rideId, driverId: userId, reason });
    const formatted = formatRideForFrontend(ride);
    res.status(200).json({ success: true, data: formatted, ride: formatted });
  });

  getRideById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const rideId = req.params.rideId || req.params.id;
    const userId = req.userId || req.user?.userId || req.user?.id;
    const ride = await this.rideService.getRideById(rideId, userId, req.role || req.user?.role);
    const formatted = formatRideForFrontend(ride);
    res.status(200).json({ success: true, data: formatted, ride: formatted });
  });

  getRiderHistory = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
    const history = await this.rideService.getRiderHistory(userId);
    const formattedList = (history || []).map(formatRideForFrontend);
    res.status(200).json({
      success: true,
      data: formattedList,
      rides: formattedList,
      totalRides: formattedList.length,
    });
  });

  getDriverHistory = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
    const history = await this.rideService.getDriverHistory(userId);
    const formattedList = (history || []).map(formatRideForFrontend);
    res.status(200).json({
      success: true,
      data: formattedList,
      rides: formattedList,
      totalRides: formattedList.length,
    });
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
    const formatted = activeRide ? formatRideForFrontend(activeRide) : null;
    res.status(200).json({ success: true, data: formatted, ride: formatted });
  });

  getCurrentRideOfDriver = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
    const activeRide = await this.rideService.getActiveRideForUser(userId, true);
    const formatted = activeRide ? formatRideForFrontend(activeRide) : null;
    res.status(200).json({ success: true, data: formatted, ride: formatted });
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
    const rideId = req.params.rideId || req.params.id;
    const ride = await this.rideService.acceptRide(rideId, userId);
    const formatted = formatRideForFrontend(ride);
    res.status(200).json({ success: true, data: formatted, ride: formatted });
  });

  driverArrived = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
    const rideId = req.params.rideId || req.params.id;
    const ride = await this.rideService.driverArrived(rideId, userId);
    const formatted = formatRideForFrontend(ride);
    res.status(200).json({ success: true, data: formatted, ride: formatted });
  });

  driverArrivedAtDestination = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
    const rideId = req.params.rideId || req.params.id;
    const ride = await this.rideService.arriveAtDestination({ rideId, driverId: userId });
    const formatted = formatRideForFrontend(ride);
    res.status(200).json({ success: true, data: formatted, ride: formatted });
  });

  startRide = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
    const rideId = req.params.rideId || req.params.id;
    const otp = req.body?.otp;
    const ride = await this.rideService.startRide(rideId, userId, otp);
    const formatted = formatRideForFrontend(ride);
    res.status(200).json({ success: true, data: formatted, ride: formatted });
  });

  completeRide = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) throw new AppError('Unauthorized: User ID required', 401, 'UNAUTHORIZED');
    const rideId = req.params.rideId || req.params.id;
    const ride = await this.rideService.completeRide(rideId, userId);
    const formatted = formatRideForFrontend(ride);
    res.status(200).json({ success: true, data: formatted, ride: formatted });
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
    const formatted = formatRideForFrontend(ride);
    res.status(200).json({ success: true, data: formatted, ride: formatted });
  });
}
