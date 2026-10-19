import { Ride, RideStatus, RidePaymentStatus } from '../db/client.js';
import { RideRepository } from '../repositories/ride.repository.js';
import { RatingRepository } from '../repositories/rating.repository.js';
import { OutboxRepository } from '../repositories/outbox.repository.js';
import { FareService } from './fare.service.js';
import { OtpService } from './otp.service.js';
import { NotFoundError, ConflictError, AppError } from '@urbanfleet/common';
import { EventTopics } from '@urbanfleet/contracts';

export class RideService {
  constructor(
    private rideRepo: RideRepository,
    private ratingRepo: RatingRepository,
    private outboxRepo: OutboxRepository,
    private fareService: FareService,
    private otpService: OtpService
  ) {}

  async createRide(input: {
    riderId: string;
    pickup: any;
    destination: any;
    vehicleCategory?: string;
  }) {
    const pickup = this.fareService.normalizeCoords(input.pickup);
    const destination = this.fareService.normalizeCoords(input.destination);
    const pickupAddress = input.pickup?.address || 'Pickup Location';
    const destinationAddress = input.destination?.address || 'Destination Location';

    const fare = this.fareService.calculateFareEstimate(pickup, destination, input.vehicleCategory);
    const otp = this.otpService.generateRideOtp();

    return this.rideRepo.executeTransaction(async (tx) => {
      const created = await this.rideRepo.create({
        riderId: input.riderId,
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        pickupAddress,
        destinationLat: destination.lat,
        destinationLng: destination.lng,
        destinationAddress,
        distanceKm: fare.distanceKm,
        durationMinutes: fare.durationMinutes,
        baseFarePaise: fare.baseFarePaise,
        surgeMultiplier: fare.surgeMultiplier,
        totalFarePaise: fare.totalFarePaise,
        vehicleCategory: input.vehicleCategory || 'SEDAN',
        otp,
        status: 'SEARCHING',
        rideSequence: 1
      }, tx);

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

  async getRideById(id: string, requestingUserId?: string, userRole?: string | string[]): Promise<any> {
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

      // Redact OTP if driver is viewing active ride
      if (isDriver && !isRider && !isAdmin && !['COMPLETED', 'CANCELLED'].includes(ride.status)) {
        return {
          ...ride,
          otp: null
        };
      }
    }

    return ride;
  }

  async getActiveRide(riderId: string) {
    return this.rideRepo.findActiveRide(riderId);
  }

  async getDriverCurrentRide(driverId: string) {
    return this.rideRepo.findActiveRideByDriverId(driverId);
  }

  async getRiderHistory(riderId: string): Promise<Ride[]> {
    return this.rideRepo.findHistoryByRiderId(riderId);
  }

  async getDriverHistory(driverId: string): Promise<Ride[]> {
    return this.rideRepo.findHistoryByDriverId(driverId);
  }

  async getActiveRideForUser(userId: string, isDriver: boolean): Promise<Ride | null> {
    return isDriver
      ? this.rideRepo.findActiveRideByDriverId(userId)
      : this.rideRepo.findActiveRideByRiderId(userId);
  }

  async acceptRide(rideId: string, driverId: string) {
    return this.rideRepo.executeTransaction(async (tx) => {
      // 1. Enforce single active ride per driver
      const existingActive = await tx.ride.findFirst({
        where: {
          driverId,
          status: { in: ['ACCEPTED', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_PROGRESS', 'STARTED', 'ARRIVED_AT_DESTINATION'] }
        }
      });
      if (existingActive && existingActive.id !== rideId) {
        throw new ConflictError('Driver already has an active ride in progress');
      }

      // 2. Concurrency-safe ride state check
      const ride = await tx.ride.findUnique({ where: { id: rideId } });
      if (!ride) throw new NotFoundError('Ride not found');
      if (ride.status !== 'REQUESTED' && ride.status !== 'SEARCHING') {
        throw new ConflictError('Ride is no longer available for acceptance');
      }
      if (ride.driverId && ride.driverId !== driverId) {
        throw new ConflictError('Ride has already been accepted by another driver');
      }

      const nextSequence = ride.rideSequence + 1;
      const updated = await this.rideRepo.update(rideId, {
        driverId,
        status: 'ACCEPTED',
        acceptedAt: new Date(),
        rideSequence: nextSequence
      }, tx);

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

  async driverArrived(rideId: string, driverId: string) {
    return this.rideRepo.executeTransaction(async (tx) => {
      const ride = await tx.ride.findUnique({ where: { id: rideId } });
      if (!ride) throw new NotFoundError('Ride not found');

      if (ride.driverId && ride.driverId !== driverId) {
        throw new AppError('Unauthorized: Only assigned driver can update arrival status', 403, 'FORBIDDEN');
      }

      const validPreviousStatuses = ['ACCEPTED', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING'];
      if (!validPreviousStatuses.includes(ride.status)) {
        throw new ConflictError(`Cannot mark arrived from status ${ride.status}`);
      }

      const nextSequence = ride.rideSequence + 1;
      const updated = await this.rideRepo.update(rideId, {
        status: 'ARRIVED',
        arrivedAt: new Date(),
        rideSequence: nextSequence
      }, tx);

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

  async arriveAtPickup(input: { rideId: string; driverId: string }) {
    return this.driverArrived(input.rideId, input.driverId);
  }

  async arriveAtDestination(input: { rideId: string; driverId: string }) {
    return this.rideRepo.executeTransaction(async (tx) => {
      const ride = await tx.ride.findUnique({ where: { id: input.rideId } });
      if (!ride) throw new NotFoundError('Ride not found');

      if (ride.driverId && ride.driverId !== input.driverId) {
        throw new AppError('Unauthorized: Only assigned driver can arrive at destination', 403, 'FORBIDDEN');
      }

      if (ride.status !== 'IN_PROGRESS' && ride.status !== 'STARTED') {
        throw new ConflictError(`Cannot arrive at destination from status ${ride.status}`);
      }

      const nextSequence = ride.rideSequence + 1;
      const updated = await this.rideRepo.update(input.rideId, {
        status: 'ARRIVED_AT_DESTINATION',
        rideSequence: nextSequence
      }, tx);

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

  async cancelRideByDriver(input: { rideId: string; driverId: string; reason?: string }) {
    return this.cancelRide(input.rideId, input.driverId, input.reason);
  }

  async startRide(rideId: string, driverId: string, otp: string) {
    return this.rideRepo.executeTransaction(async (tx) => {
      const ride = await tx.ride.findUnique({ where: { id: rideId } });
      if (!ride) throw new NotFoundError('Ride not found');

      if (ride.driverId && ride.driverId !== driverId) {
        throw new AppError('Unauthorized: Only assigned driver can start this ride', 403, 'FORBIDDEN');
      }

      if (ride.status !== 'ARRIVED') {
        throw new ConflictError(`Cannot start ride from status ${ride.status}. Driver must mark arrived first.`);
      }

      if (!this.otpService.verifyRideOtp(ride.otp, otp)) {
        throw new AppError('Invalid ride verification OTP', 400);
      }

      const nextSequence = ride.rideSequence + 1;
      const updated = await this.rideRepo.update(rideId, {
        status: 'IN_PROGRESS',
        startedAt: new Date(),
        otp: this.otpService.invalidateRideOtp(),
        rideSequence: nextSequence
      }, tx);

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

  async completeRide(rideId: string, driverId: string) {
    return this.rideRepo.executeTransaction(async (tx) => {
      const ride = await tx.ride.findUnique({ where: { id: rideId } });
      if (!ride) throw new NotFoundError('Ride not found');

      if (ride.driverId && ride.driverId !== driverId) {
        throw new AppError('Unauthorized: Only assigned driver can complete this ride', 403, 'FORBIDDEN');
      }

      const validCompleteStatuses = ['IN_PROGRESS', 'STARTED', 'ARRIVED_AT_DESTINATION'];
      if (!validCompleteStatuses.includes(ride.status)) {
        throw new ConflictError(`Cannot complete a ride in status ${ride.status}`);
      }

      const nextSequence = ride.rideSequence + 1;
      const completed = await this.rideRepo.update(rideId, {
        status: 'COMPLETED',
        completedAt: new Date(),
        rideSequence: nextSequence
      }, tx);

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

  async cancelRide(rideId: string, userId: string, reason?: string): Promise<any> {
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

  async updateRideStatus(rideId: string, status: RideStatus) {
    return this.rideRepo.update(rideId, { status });
  }

  async updatePaymentStatus(rideId: string, paymentStatus: RidePaymentStatus) {
    return this.rideRepo.update(rideId, { paymentStatus });
  }

  async submitRating(rideId: string, fromId: string, score: number, feedback?: string) {
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
    return this.ratingRepo.create({ rideId, fromId, toId, score, feedback });
  }
}

export function canCompleteRide(ride: { status: string; paymentStatus?: string }): boolean {
  return (
    ride.status === 'ARRIVED_AT_DESTINATION' &&
    (ride.paymentStatus === 'CAPTURED' || ride.paymentStatus === 'PAID')
  );
}
