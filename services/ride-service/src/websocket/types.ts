import { WebSocket } from 'ws';
import type { Coordinates, LocationPoint, RideDto } from '@urbanfleet/common';

export interface AuthenticatedSocketUser {
  userId: string;
  driverId?: string;
  role: string[];
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
  ride: Pick<RideDto, 'id' | 'paymentStatus'>;
}

export interface RideLifecyclePayload {
  ride: RideDto;
}

export interface HeartbeatPayload {
  timestamp: number;
}

export interface RiderLocationPayload {
  rideId: string;
  riderId: string;
  location: Coordinates;
  timestamp: number;
}

export interface RiderRideRequestPayload {
  pickup: LocationPoint;
  destination: LocationPoint;
  vehicleCategory?: string;
}

export interface RideProgressPayload {
  rideId: string;
}
