const PLATFORM_COMMISSION_PERCENT = 10;
const BASE_FARE_PAISE = 2500; // ₹25
const PER_KILOMETER_PAISE = 500; // ₹5/km
const SURGE_CHARGE_PAISE = 400; // ₹4

const VEHICLE_MULTIPLIERS: Record<string, number> = {
  bike: 0.7,
  auto: 0.9,
  car: 1.2
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

export class FareService {
  computeDistanceAndDuration(pickup: { lat: number; lng: number }, destination: { lat: number; lng: number }) {
    const R = 6371; // Earth radius in km
    const dLat = ((destination.lat - pickup.lat) * Math.PI) / 180;
    const dLng = ((destination.lng - pickup.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((pickup.lat * Math.PI) / 180) *
        Math.cos((destination.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceKm = Math.max(1.0, Math.round(R * c * 100) / 100);
    const durationMinutes = Math.max(5, Math.round(distanceKm * 2.5));

    return { distanceKm, durationMinutes };
  }

  calculateDynamicSurge(demandFactor = 1.0): number {
    return Math.min(3.0, Math.max(1.0, demandFactor));
  }

  calculateCancellationFee(rideAgeMinutes: number): number {
    return rideAgeMinutes > 2 ? 5000 : 0; // 50 INR in paise if >2 mins
  }

  calculateFareEstimate(pickup: { lat: number; lng: number }, destination: { lat: number; lng: number }) {
    const { distanceKm, durationMinutes } = this.computeDistanceAndDuration(pickup, destination);
    const baseFarePaise = 5000; // 50 INR base
    const perKmPaise = 1500;   // 15 INR/km
    const surgeMultiplier = this.calculateDynamicSurge();
    const calculatedFare = Math.round((baseFarePaise + distanceKm * perKmPaise) * surgeMultiplier);

    return {
      distanceKm,
      durationMinutes,
      baseFarePaise,
      surgeMultiplier,
      totalFarePaise: calculatedFare
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
