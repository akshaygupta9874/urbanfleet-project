import { WebSocket } from 'ws';
import type { LocationPoint, RideDto } from '@urbanfleet/common';

export interface AuthenticatedSocketUser {
  userId: string;
  driverId?: string;
  roles: string[];
  role?: string | string[];
  sessionId?: string;
}

export interface AuthenticatedSocket extends WebSocket {
  user: AuthenticatedSocketUser;
}

export interface SocketMessage<T = unknown> {
  event: string;
  data: T;
}

export interface SocketErrorPayload {
  message: string;
  code?: string;
}

export interface DriverLocationPayload {
  rideId?: string;
  latitude: number;
  longitude: number;
}

export interface DriverAvailabilityPayload {
  available: boolean;
}

export interface RideActionPayload {
  rideId: string;
}

export interface RideCancelPayload {
  rideId: string;
  reason: string;
}

export interface RideCancelledPayload {
  rideId: string;
  cancelledBy: 'RIDER' | 'DRIVER';
  reason?: string;
}

export interface PaymentCapturedPayload {
  rideId?: string;
  amount?: number;
  paymentId?: string;
  ride?: {
    id: string;
    paymentStatus: string;
  };
}

export interface RideLifecyclePayload {
  rideId: string;
  ride: RideDto;
  driver?: {
    id: string;
    name: string;
    phone: string;
    vehicleModel?: string;
    vehiclePlate?: string;
    rating?: number;
  };
  pickupLocation?: LocationPoint;
  destinationLocation?: LocationPoint;
}