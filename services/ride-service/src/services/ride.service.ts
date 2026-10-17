import { PrismaClient, Ride, RideStatus, RidePaymentStatus } from '@prisma/client';
import { RideRepository } from '../repositories/ride.repository.js';
import { RatingRepository } from '../repositories/rating.repository.js';
import { OutboxRepository } from '../repositories/outbox.repository.js';
import { FareService } from './fare.service.js';
import { OtpService } from './otp.service.js';
import { NotFoundError, ConflictError, AppError } from '@urbanfleet/common';
import { EventTopics } from '@urbanfleet/contracts';

export class RideService {
  constructor(
    private prisma: PrismaClient,
    private rideRepo: RideRepository,
    private ratingRepo: RatingRepository,
    private outboxRepo: OutboxRepository,
    private fareService: FareService,
    private otpService: OtpService
  ) {}

  async createRide(input: {
    riderId: string;
    pickup: { lat: number; lng: number; address: string };
    destination: { lat: number; lng: number; address: string };
    vehicleCategory?: string;
  }) {
    const fare = this.fareService.calculateFareEstimate(input.pickup, input.destination);
    const otp = this.otpService.generateRideOtp();

    return this.prisma.ride.create({
      data: {
        riderId: input.riderId,
        pickupLat: input.pickup.lat,
        pickupLng: input.pickup.lng,
        pickupAddress: input.pickup.address,
        destinationLat: input.destination.lat,
        destinationLng: input.destination.lng,
        destinationAddress: input.destination.address,
        distanceKm: fare.distanceKm,
        durationMinutes: fare.durationMinutes,
        baseFarePaise: fare.baseFarePaise,
        surgeMultiplier: fare.surgeMultiplier,
        totalFarePaise: fare.totalFarePaise,
        vehicleCategory: input.vehicleCategory || 'SEDAN',
        otp,
        status: 'SEARCHING',
        rideSequence: 1
      }
    });
  }

  async getRideById(id: string) {
    const ride = await this.rideRepo.findById(id);
    if (!ride) throw new NotFoundError('Ride not found');
    return ride;
  }

  async getActiveRide(riderId: string) {
    return this.rideRepo.findActiveRide(riderId);
  }

  async getDriverCurrentRide(driverId: string) {
    return this.rideRepo.findActiveRideByDriverId(driverId);
  }

  async acceptRide(rideId: string, driverId: string) {
    return this.prisma.$transaction(async (tx) => {
      const ride = await tx.ride.findUnique({ where: { id: rideId } });
      if (!ride) throw new NotFoundError('Ride not found');
      if (ride.status !== 'REQUESTED' && ride.status !== 'SEARCHING') {
        throw new ConflictError('Ride is no longer available for acceptance');
      }

      const nextSequence = ride.rideSequence + 1;
      const updated = await tx.ride.update({
        where: { id: rideId },
        data: {
          driverId,
          status: 'ACCEPTED',
          acceptedAt: new Date(),
          rideSequence: nextSequence
        }
      });

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
    return this.prisma.ride.update({
      where: { id: rideId },
      data: { status: 'ARRIVED', arrivedAt: new Date() }
    });
  }

  async arriveAtPickup(input: { rideId: string; driverId: string }) {
    return this.driverArrived(input.rideId, input.driverId);
  }

  async arriveAtDestination(input: { rideId: string; driverId: string }) {
    return this.prisma.ride.update({
      where: { id: input.rideId },
      data: { status: 'ARRIVED_AT_DESTINATION' }
    });
  }

  async cancelRideByDriver(input: { rideId: string; driverId: string; reason?: string }) {
    return this.cancelRide(input.rideId, input.driverId, input.reason);
  }

  async startRide(rideId: string, driverId: string, otp: string) {
    const ride = await this.getRideById(rideId);
    if (!this.otpService.verifyRideOtp(ride.otp, otp)) {
      throw new AppError('Invalid ride verification OTP', 400);
    }

    return this.prisma.ride.update({
      where: { id: rideId },
      data: {
        status: 'IN_PROGRESS',
        startedAt: new Date(),
        otp: this.otpService.invalidateRideOtp()
      }
    });
  }

  async completeRide(rideId: string, driverId: string) {
    return this.prisma.$transaction(async (tx) => {
      const ride = await tx.ride.findUnique({ where: { id: rideId } });
      if (!ride) throw new NotFoundError('Ride not found');
      if (ride.status !== 'IN_PROGRESS') {
        throw new ConflictError('Cannot complete a ride that is not in progress');
      }

      const nextSequence = ride.rideSequence + 1;
      const completed = await tx.ride.update({
        where: { id: rideId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          rideSequence: nextSequence
        }
      });

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
          completedAt: completed.completedAt
        }
      });

      return completed;
    });
  }

  async cancelRide(rideId: string, userId: string, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      const ride = await tx.ride.findUnique({ where: { id: rideId } });
      if (!ride) throw new NotFoundError('Ride not found');
      if (['COMPLETED', 'CANCELLED'].includes(ride.status)) {
        throw new ConflictError('Ride cannot be cancelled');
      }

      const nextSequence = ride.rideSequence + 1;
      const cancelled = await tx.ride.update({
        where: { id: rideId },
        data: {
          status: 'CANCELLED',
          cancelledBy: userId === ride.riderId ? 'RIDER' : 'DRIVER',
          cancellationReason: reason,
          cancelledAt: new Date(),
          rideSequence: nextSequence
        }
      });

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
          cancelledAt: cancelled.cancelledAt
        }
      });

      return cancelled;
    });
  }

  async updateRideStatus(rideId: string, status: RideStatus) {
    return this.prisma.ride.update({ where: { id: rideId }, data: { status } });
  }

  async updatePaymentStatus(rideId: string, paymentStatus: RidePaymentStatus) {
    return this.prisma.ride.update({
      where: { id: rideId },
      data: { paymentStatus }
    });
  }

  async submitRating(rideId: string, fromId: string, score: number, feedback?: string) {
    const ride = await this.getRideById(rideId);
    const toId = fromId === ride.riderId ? ride.driverId! : ride.riderId;
    return this.ratingRepo.create({ rideId, fromId, toId, score, feedback });
  }
}

export function canCompleteRide(ride: { status: string; paymentStatus?: string }): boolean {
  return (
    (ride.status === 'ARRIVED_AT_DESTINATION' || ride.status === 'IN_PROGRESS') &&
    (ride.paymentStatus === 'CAPTURED' || ride.paymentStatus === 'PAID')
  );
}
