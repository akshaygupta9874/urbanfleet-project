import { Ride, RideStatus, RidePaymentStatus, Rating } from '../db/client.js';
import { RideRepository } from '../repositories/ride.repository.js';
import { RatingRepository } from '../repositories/rating.repository.js';
import { OutboxRepository } from '../repositories/outbox.repository.js';
import { FareService } from './fare.service.js';
import { OtpService } from './otp.service.js';
import { NotFoundError, ConflictError, AppError } from '@urbanfleet/common';
import type { LocationPoint } from '@urbanfleet/common';
import { EventTopics } from '@urbanfleet/contracts';

export interface CreateRideInput {
  riderId: string;
  pickup: LocationPoint;
  destination: LocationPoint;
  vehicleCategory?: string;
}

export interface RideWithOtp extends Ride {
  otp: string | null;
}

export interface CancelledRideResult extends Ride {
  cancellationFeePaise: number;
}

export class RideService {
  private rideRepo: RideRepository;
  private ratingRepo: RatingRepository;
  private outboxRepo: OutboxRepository;
  private fareService: FareService;
  private otpService: OtpService;

  constructor(
    rideRepo: RideRepository,
    ratingRepo: RatingRepository,
    outboxRepo: OutboxRepository,
    fareService: FareService,
    otpService: OtpService
  ) {
    this.rideRepo = rideRepo;
    this.ratingRepo = ratingRepo;
    this.outboxRepo = outboxRepo;
    this.fareService = fareService;
    this.otpService = otpService;
  }

  async createRide(input: CreateRideInput): Promise<Ride> {
    const fare = this.fareService.calculateFareEstimate(input.pickup, input.destination, input.vehicleCategory);
    const otp = this.otpService.generateRideOtp();

    return this.rideRepo.executeTransaction(async (tx) => {
      const created = await this.rideRepo.create({
        riderId: input.riderId,
        pickupLat: input.pickup.coordinates.latitude,
        pickupLng: input.pickup.coordinates.longitude,
        pickupAddress: input.pickup.address,
        destinationLat: input.destination.coordinates.latitude,
        destinationLng: input.destination.coordinates.longitude,
        destinationAddress: input.destination.address,
        distanceKm: fare.distanceKm,
        durationMinutes: fare.durationMinutes,
        baseFarePaise: fare.baseFarePaise,
        surgeMultiplier: fare.surgeMultiplier,
        totalFarePaise: fare.totalFarePaise,
        vehicleCategory: input.vehicleCategory || 'SEDAN',
        status: 'SEARCHING',
        rideSequence: 1
      }, tx);

      if (!created || !created.id) {
        throw new AppError('Failed to create ride', 500, 'INTERNAL_SERVER_ERROR');
      }

      // Store OTP in Redis (not in PostgreSQL database)
      await this.otpService.storeRideOtp(created.id, otp);

      await this.outboxRepo.stageEvent(tx, {
        topic: EventTopics.RIDE_EVENTS,
        partitionKey: created.id,
        eventType: 'RIDE_REQUESTED',
        aggregateType: 'RIDE',
        aggregateId: created.id,
        aggregateSequence: 1,
        payload: {
          rideId: created.id,
          riderId: created.riderId,
          pickupLat: Number(created.pickupLat),
          pickupLng: Number(created.pickupLng),
          destinationLat: Number(created.destinationLat),
          destinationLng: Number(created.destinationLng),
          totalFarePaise: created.totalFarePaise,
          vehicleCategory: created.vehicleCategory,
          createdAt: created.createdAt
        }
      });

      return created;
    });
  }

  async getRiderOtpForRide(rideId: string, riderId: string): Promise<string | null> {
    const ride = await this.rideRepo.findById(rideId);
    if (!ride) throw new NotFoundError('Ride not found');
    if (ride.riderId !== riderId) {
      throw new AppError('Forbidden: Only the rider can view the verification code', 403, 'FORBIDDEN');
    }
    return this.otpService.getRideOtp(rideId);
  }

  async getRideById(id: string, requestingUserId?: string, userRole?: string | string[]): Promise<RideWithOtp> {
    const ride = await this.rideRepo.findById(id);
    if (!ride) throw new NotFoundError('Ride not found');

    if (requestingUserId) {
      const roles = Array.isArray(userRole) ? userRole : [userRole || 'RIDER'];
      const isAdmin = roles.includes('ADMIN');
      const isRider = ride.riderId === requestingUserId;
      const isDriver = ride.driverId === requestingUserId;

      if (!isAdmin && !isRider && !isDriver) {
        throw new AppError('Forbidden: You are not authorized to view this ride', 403, 'FORBIDDEN');
      }

      return {
        ...ride,
        otp: isRider ? await this.otpService.getRideOtp(ride.id) : null
      };
    }

    return {
      ...ride,
      otp: null
    };
  }

  async getActiveRide(riderId: string): Promise<Ride | null> {
    return this.rideRepo.findActiveRide(riderId);
  }

  async getDriverCurrentRide(driverId: string): Promise<Ride | null> {
    return this.rideRepo.findActiveRideByDriverId(driverId);
  }

  async getRiderHistory(riderId: string): Promise<Ride[]> {
    return this.rideRepo.findHistoryByRiderId(riderId);
  }

  async getDriverHistory(driverId: string): Promise<Ride[]> {
    return this.rideRepo.findHistoryByDriverId(driverId);
  }

  async getActiveRideForUser(userId: string, isDriver: boolean): Promise<RideWithOtp | null> {
    const activeRide = await (isDriver
      ? this.rideRepo.findActiveRideByDriverId(userId)
      : this.rideRepo.findActiveRideByRiderId(userId));
    if (!activeRide) return null;
    return {
      ...activeRide,
      otp: isDriver ? null : await this.otpService.getRideOtp(activeRide.id)
    };
  }

  async acceptRide(rideId: string, driverId: string, otp?: string): Promise<Ride> {
    return this.rideRepo.executeTransaction(async (tx) => {
      // 1. Enforce single active ride per driver
      const existingActive = await tx.ride.findFirst({
        where: {
          driverId,
          status: { in: ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'RIDE_STARTED', 'ARRIVED_AT_DESTINATION'] }
        }
      });
      if (existingActive && existingActive.id !== rideId) {
        throw new ConflictError('Driver already has an active ride in progress');
      }

      // 2. Concurrency-safe ride state check
      const ride = await tx.ride.findUnique({ where: { id: rideId } });
      if (!ride) throw new NotFoundError('Ride not found');
      if (ride.status !== 'SEARCHING') {
        throw new ConflictError('Ride is no longer available for acceptance');
      }
      if (ride.driverId && ride.driverId !== driverId) {
        throw new ConflictError('Ride has already been accepted by another driver');
      }

      const nextSequence = ride.rideSequence + 1;
      const updated = await this.rideRepo.update(rideId, {
        driverId,
        status: 'DRIVER_ASSIGNED',
        acceptedAt: new Date(),
        rideSequence: nextSequence
      }, tx);

      if (!updated) {
        throw new AppError('Failed to assign driver to ride', 500, 'INTERNAL_SERVER_ERROR');
      }

      await this.outboxRepo.stageEvent(tx, {
        topic: EventTopics.RIDE_EVENTS,
        partitionKey: ride.id,
        eventType: 'RIDE_ACCEPTED',
        aggregateType: 'RIDE',
        aggregateId: ride.id,
        aggregateSequence: nextSequence,
        payload: { rideId: ride.id, driverId, acceptedAt: updated.acceptedAt }
      });

      return updated;
    });
  }

  async driverArrived(rideId: string, driverId: string): Promise<Ride> {
    return this.rideRepo.executeTransaction(async (tx) => {
      const ride = await tx.ride.findUnique({ where: { id: rideId } });
      if (!ride) throw new NotFoundError('Ride not found');

      if (ride.driverId && ride.driverId !== driverId) {
        throw new AppError('Unauthorized: Only assigned driver can update arrival status', 403, 'FORBIDDEN');
      }

      const validPreviousStatuses = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'];
      if (!validPreviousStatuses.includes(ride.status)) {
        throw new ConflictError(`Cannot mark arrived from status ${ride.status}`);
      }

      const nextSequence = ride.rideSequence + 1;
      const updated = await this.rideRepo.update(rideId, {
        status: 'DRIVER_ARRIVING',
        arrivedAt: new Date(),
        rideSequence: nextSequence
      }, tx);

      if (!updated) {
        throw new AppError('Failed to update driver arrival', 500, 'INTERNAL_SERVER_ERROR');
      }

      await this.outboxRepo.stageEvent(tx, {
        topic: EventTopics.RIDE_EVENTS,
        partitionKey: ride.id,
        eventType: 'RIDE_DRIVER_ARRIVED',
        aggregateType: 'RIDE',
        aggregateId: ride.id,
        aggregateSequence: nextSequence,
        payload: { rideId: ride.id, driverId, arrivedAt: updated.arrivedAt }
      });

      return updated;
    });
  }

  async arriveAtPickup(input: { rideId: string; driverId: string }): Promise<Ride> {
    return this.driverArrived(input.rideId, input.driverId);
  }

  async arriveAtDestination(input: { rideId: string; driverId: string }): Promise<Ride> {
    return this.rideRepo.executeTransaction(async (tx) => {
      const ride = await tx.ride.findUnique({ where: { id: input.rideId } });
      if (!ride) throw new NotFoundError('Ride not found');

      if (ride.driverId && ride.driverId !== input.driverId) {
        throw new AppError('Unauthorized: Only assigned driver can arrive at destination', 403, 'FORBIDDEN');
      }

      if (ride.status !== 'RIDE_STARTED') {
        throw new ConflictError(`Cannot arrive at destination from status ${ride.status}`);
      }

      const nextSequence = ride.rideSequence + 1;
      const updated = await this.rideRepo.update(input.rideId, {
        status: 'ARRIVED_AT_DESTINATION',
        rideSequence: nextSequence
      }, tx);

      if (!updated) {
        throw new AppError('Failed to update arrival at destination', 500, 'INTERNAL_SERVER_ERROR');
      }

      await this.outboxRepo.stageEvent(tx, {
        topic: EventTopics.RIDE_EVENTS,
        partitionKey: ride.id,
        eventType: 'RIDE_ARRIVED_AT_DESTINATION',
        aggregateType: 'RIDE',
        aggregateId: ride.id,
        aggregateSequence: nextSequence,
        payload: { rideId: ride.id, driverId: input.driverId, arrivedAtDestination: new Date() }
      });

      return updated;
    });
  }

  async cancelRideByDriver(input: { rideId: string; driverId: string; reason?: string }): Promise<CancelledRideResult> {
    return this.cancelRide(input.rideId, input.driverId, input.reason);
  }

  async startRide(rideId: string, driverId: string, otp?: string): Promise<Ride> {
    return this.rideRepo.executeTransaction(async (tx) => {
      const ride = await tx.ride.findUnique({ where: { id: rideId } });
      if (!ride) throw new NotFoundError('Ride not found');

      if (ride.driverId && ride.driverId !== driverId) {
        throw new AppError('Unauthorized: Only assigned driver can start this ride', 403, 'FORBIDDEN');
      }

      if (ride.status !== 'DRIVER_ARRIVING' && ride.status !== 'DRIVER_ASSIGNED') {
        throw new ConflictError(`Cannot start ride from status ${ride.status}. Driver must be arriving/assigned first.`);
      }

      if (!otp) {
        throw new AppError('OTP is required to start ride', 400);
      }

      const isValidOtp = await this.otpService.verifyRideOtp(rideId, otp);
      if (!isValidOtp) {
        throw new AppError('Invalid ride verification OTP', 400);
      }

      const nextSequence = ride.rideSequence + 1;
      const updated = await this.rideRepo.update(rideId, {
        status: 'RIDE_STARTED',
        startedAt: new Date(),
        rideSequence: nextSequence
      }, tx);

      if (!updated) {
        throw new AppError('Failed to start ride', 500, 'INTERNAL_SERVER_ERROR');
      }

      // Invalidate OTP in Redis upon successful start
      await this.otpService.invalidateRideOtp(rideId);

      await this.outboxRepo.stageEvent(tx, {
        topic: EventTopics.RIDE_EVENTS,
        partitionKey: ride.id,
        eventType: 'RIDE_STARTED',
        aggregateType: 'RIDE',
        aggregateId: ride.id,
        aggregateSequence: nextSequence,
        payload: { rideId: ride.id, driverId, startedAt: updated.startedAt }
      });

      return updated;
    });
  }

  async completeRide(rideId: string, driverId: string): Promise<Ride> {
    return this.rideRepo.executeTransaction(async (tx) => {
      const ride = await tx.ride.findUnique({ where: { id: rideId } });
      if (!ride) throw new NotFoundError('Ride not found');

      if (ride.driverId && ride.driverId !== driverId) {
        throw new AppError('Unauthorized: Only assigned driver can complete this ride', 403, 'FORBIDDEN');
      }

      const validCompleteStatuses = ['RIDE_STARTED', 'ARRIVED_AT_DESTINATION'];
      if (!validCompleteStatuses.includes(ride.status)) {
        throw new ConflictError(`Cannot complete a ride in status ${ride.status}`);
      }

      const nextSequence = ride.rideSequence + 1;
      const completed = await this.rideRepo.update(rideId, {
        status: 'COMPLETED',
        completedAt: new Date(),
        rideSequence: nextSequence
      }, tx);

      if (!completed) {
        throw new AppError('Failed to complete ride', 500, 'INTERNAL_SERVER_ERROR');
      }

      const platformCommissionPaise = Math.round(ride.totalFarePaise * 0.10);
      const driverEarningPaise = ride.totalFarePaise - platformCommissionPaise;

      // Atomically stage Outbox event for Kafka in SAME transaction
      await this.outboxRepo.stageEvent(tx, {
        topic: EventTopics.RIDE_EVENTS,
        partitionKey: ride.id,
        eventType: 'RIDE_COMPLETED',
        aggregateType: 'RIDE',
        aggregateId: ride.id,
        aggregateSequence: nextSequence,
        payload: {
          rideId: ride.id,
          riderId: ride.riderId,
          driverId: ride.driverId,
          totalFarePaise: ride.totalFarePaise,
          baseFarePaise: ride.baseFarePaise,
          surgeMultiplier: Number(ride.surgeMultiplier),
          distanceKm: Number(ride.distanceKm),
          durationMinutes: ride.durationMinutes,
          driverEarningPaise,
          platformCommissionPaise,
          completedAt: completed.completedAt
        }
      });

      return completed;
    });
  }

  async cancelRide(rideId: string, userId: string, reason?: string): Promise<CancelledRideResult> {
    return this.rideRepo.executeTransaction(async (tx) => {
      const ride = await tx.ride.findUnique({ where: { id: rideId } });
      if (!ride) throw new NotFoundError('Ride not found');

      const isRider = userId === ride.riderId;
      const isDriver = userId === ride.driverId;

      if (!isRider && !isDriver) {
        throw new AppError('Unauthorized: Only rider or assigned driver can cancel this ride', 403, 'FORBIDDEN');
      }

      if (['COMPLETED', 'CANCELLED'].includes(ride.status)) {
        throw new ConflictError('Ride cannot be cancelled');
      }

      const cancelledBy = isRider ? 'RIDER' : 'DRIVER';

      // Cancellation fee calculation (applied to rider cancellations after 2 minutes)
      let cancellationFeePaise = 0;
      if (isRider && (ride.acceptedAt || ride.status !== 'SEARCHING')) {
        const referenceTime = ride.acceptedAt || ride.createdAt;
        const rideAgeMinutes = (Date.now() - new Date(referenceTime).getTime()) / 60000;
        cancellationFeePaise = this.fareService.calculateCancellationFee(rideAgeMinutes);
      }

      const nextSequence = ride.rideSequence + 1;
      const cancelled = await this.rideRepo.update(rideId, {
        status: 'CANCELLED',
        cancelledBy,
        cancellationReason: reason,
        cancelledAt: new Date(),
        rideSequence: nextSequence,
        ...(cancellationFeePaise > 0 ? { totalFarePaise: cancellationFeePaise } : {})
      }, tx);

      if (!cancelled) {
        throw new AppError('Failed to cancel ride', 500, 'INTERNAL_SERVER_ERROR');
      }

      // Invalidate OTP in Redis upon cancellation
      await this.otpService.invalidateRideOtp(rideId);

      await this.outboxRepo.stageEvent(tx, {
        topic: EventTopics.RIDE_EVENTS,
        partitionKey: ride.id,
        eventType: 'RIDE_CANCELLED',
        aggregateType: 'RIDE',
        aggregateId: ride.id,
        aggregateSequence: nextSequence,
        payload: {
          rideId: ride.id,
          riderId: ride.riderId,
          driverId: ride.driverId || undefined,
          cancelledBy: cancelled.cancelledBy,
          cancellationReason: reason,
          cancellationFeePaise,
          cancelledAt: cancelled.cancelledAt
        }
      });

      return {
        ...cancelled,
        cancellationFeePaise
      };
    });
  }

  async updateRideStatus(rideId: string, status: RideStatus): Promise<Ride> {
    const updated = await this.rideRepo.update(rideId, { status });
    if (!updated) {
      throw new NotFoundError('Ride not found');
    }
    return updated;
  }

  async updatePaymentStatus(rideId: string, paymentStatus: RidePaymentStatus): Promise<Ride> {
    const updated = await this.rideRepo.update(rideId, { paymentStatus });
    if (!updated) {
      throw new NotFoundError('Ride not found');
    }
    return updated;
  }

  async submitRating(rideId: string, fromId: string, score: number, feedback?: string): Promise<Rating> {
    const ride = await this.rideRepo.findById(rideId);
    if (!ride) throw new NotFoundError('Ride not found');

    if (ride.status !== 'COMPLETED') {
      throw new ConflictError('Only completed rides can be rated');
    }

    const isRider = fromId === ride.riderId;
    const isDriver = fromId === ride.driverId;

    if (!isRider && !isDriver) {
      throw new AppError('Forbidden: You can only rate rides you participated in', 403, 'FORBIDDEN');
    }

    const existingRating = await this.ratingRepo.findByRideAndFrom(rideId, fromId);
    if (existingRating) {
      throw new ConflictError('You have already submitted a rating for this ride');
    }

    const toId = isRider ? ride.driverId! : ride.riderId;
    const rating = await this.ratingRepo.create({ rideId, fromId, toId, score, feedback });
    if (!rating) {
      throw new AppError('Failed to save rating', 500, 'INTERNAL_SERVER_ERROR');
    }
    return rating;
  }
}

export function canCompleteRide(ride: { status: string; paymentStatus?: string }): boolean {
  return (
    ride.status === 'ARRIVED_AT_DESTINATION' &&
    (ride.paymentStatus === 'CAPTURED' || ride.paymentStatus === 'PAID')
  );
}
