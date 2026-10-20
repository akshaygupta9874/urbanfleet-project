import type { Coordinates, LocationPoint } from '@urbanfleet/common';

const PLATFORM_COMMISSION_PERCENT = 10;
const BASE_FARE_PAISE = 2500; // ₹25
const PER_KILOMETER_PAISE = 500; // ₹5/km
const SURGE_CHARGE_PAISE = 400; // ₹4

const VEHICLE_MULTIPLIERS: Record<string, number> = {
  bike: 0.7,
  auto: 0.9,
  car: 1.2,
  sedan: 1.2,
};

export interface IFareBreakdown {
  baseFarePaise: number;
  distanceFarePaise: number;
  timeFarePaise: number;
  surgePaise: number;
  platformCommissionPaise: number;
  driverEarningPaise: number;
  totalPaise: number;
}

export interface FareEstimateResult {
  distanceKm: number;
  durationMinutes: number;
  baseFarePaise: number;
  surgeMultiplier: number;
  totalFarePaise: number;
  platformCommissionPaise: number;
  driverEarningPaise: number;
}

export class FareService {
  computeDistanceAndDuration(
    pickup: Coordinates,
    destination: Coordinates
  ): { distanceKm: number; durationMinutes: number } {
    const R = 6371; // Earth radius in km
    const dLat = ((destination.latitude - pickup.latitude) * Math.PI) / 180;
    const dLng = ((destination.longitude - pickup.longitude) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((pickup.latitude * Math.PI) / 180) *
        Math.cos((destination.latitude * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceKm = Math.max(1.0, Math.round(R * c * 100) / 100);
    const durationMinutes = Math.max(5, Math.round(distanceKm * 2.5));

    return { distanceKm, durationMinutes };
  }

  calculateDynamicSurge(demandFactor = 1.0): number {
    return Math.min(3.0, Math.max(1.0, Math.round(demandFactor * 100) / 100));
  }

  calculateCancellationFee(rideAgeMinutes: number): number {
    return rideAgeMinutes > 2 ? 5000 : 0; // 50 INR in paise if >2 mins
  }

  calculateFareEstimate(
    pickup: LocationPoint,
    destination: LocationPoint,
    vehicleType = 'car',
    demandFactor = 1.0
  ): FareEstimateResult {
    const { distanceKm, durationMinutes } = this.computeDistanceAndDuration(
      pickup.coordinates,
      destination.coordinates
    );
    const multiplier = VEHICLE_MULTIPLIERS[vehicleType.toLowerCase()] ?? 1.2;
    const baseFarePaise = 5000; // 50 INR base
    const perKmPaise = Math.round(1500 * multiplier); // 15 INR/km adjusted for vehicle category
    const surgeMultiplier = this.calculateDynamicSurge(demandFactor);
    const calculatedFare = Math.round((baseFarePaise + distanceKm * perKmPaise) * surgeMultiplier);

    const platformCommissionPaise = Math.round(calculatedFare * (PLATFORM_COMMISSION_PERCENT / 100));
    const driverEarningPaise = calculatedFare - platformCommissionPaise;

    return {
      distanceKm,
      durationMinutes,
      baseFarePaise,
      surgeMultiplier,
      totalFarePaise: calculatedFare,
      platformCommissionPaise,
      driverEarningPaise,
    };
  }

  calculateFinalFare(ride: { distanceKm: number }, vehicleType?: string): IFareBreakdown {
    return this.calculateFareForDistance(Number(ride.distanceKm), vehicleType);
  }

  calculateFareForDistance(distanceKilometers: number, vehicleType = 'car'): IFareBreakdown {
    const distanceKm = Math.max(0, Number.isFinite(distanceKilometers) ? distanceKilometers : 0);
    const multiplier = VEHICLE_MULTIPLIERS[vehicleType.toLowerCase()] ?? 1.2;
    const baseFarePaise = Math.round(BASE_FARE_PAISE * multiplier);
    const distanceFarePaise = Math.round(distanceKm * PER_KILOMETER_PAISE * multiplier);
    const timeFarePaise = 0;
    const surgePaise = Math.round(SURGE_CHARGE_PAISE * multiplier);
    const totalPaise = baseFarePaise + distanceFarePaise + timeFarePaise + surgePaise;

    const platformCommissionPaise = Math.round(totalPaise * (PLATFORM_COMMISSION_PERCENT / 100));
    const driverEarningPaise = totalPaise - platformCommissionPaise;

    return {
      baseFarePaise,
      distanceFarePaise,
      timeFarePaise,
      surgePaise,
      platformCommissionPaise,
      driverEarningPaise,
      totalPaise
    };
  }
}

export const fareService = new FareService();
