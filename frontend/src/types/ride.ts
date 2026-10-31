import type { PaymentStatus } from "../lib/payment";
import type { Coordinates, LocationPoint } from "./location";

export interface RideDriver {
  id: string;
  firstName: string;
  lastName: string;
  vehicleNumber: string;
  email: string;
  phone?: string;
  profilePhoto?: string | null;
  profilePhotoUrl?: string | null;
  rating?: number;
  totalTrips?: number;
  user: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
  };
  vehicle: {
    registrationNumber: string;
    plateNumber?: string;
    brand?: string;
    make?: string;
    model: string;
    color: string;
    type?: string;
  };
}

export type RideStatus =
  | "SEARCHING"
  | "DRIVER_ASSIGNED"
  | "DRIVER_ARRIVING"
  | "RIDE_STARTED"
  | "ARRIVED_AT_DESTINATION"
  | "COMPLETED"
  | "CANCELLED";

export interface RideFareBreakdown {
  baseFarePaise: number;
  distanceFarePaise: number;
  timeFarePaise: number;
  surgePaise: number;
  platformCommissionPaise: number;
  driverEarningPaise: number;
  totalPaise: number;
}

export interface RideDto {
  id: string;
  riderId: string;
  driverId: string | null;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  pickup: LocationPoint;
  destination: LocationPoint;
  fare: {
    estimated: number;
    final: number | null;
    breakdown: RideFareBreakdown | null;
  };
  distance: { estimated: number; actual: number | null };
  duration: { estimated: number; actual: number | null };
  status: RideStatus;
  paymentStatus: PaymentStatus;
  vehicleCategory?: string;
  vehicleType?: string;
  driver: RideDriver | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  ratings?: Array<{
    id: string;
    rideId: string;
    fromId: string;
    toId: string;
    score: number;
    feedback?: string | null;
  }>;
  otp?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface RideLifecyclePayload {
  ride: RideDto;
}

export interface RideIdPayload {
  rideId: string;
}

export interface RiderRideCreatedPayload {
  ride: RideDto;
  otp: string | null;
}

export interface RiderLocationPayload {
  rideId: string;
  riderId: string;
  location: Coordinates;
  timestamp: number;
}
