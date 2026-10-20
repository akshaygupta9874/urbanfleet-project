import { WebSocket } from 'ws';
import type { Coordinates, LocationPoint } from '@urbanfleet/common';

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
  otp?: string;
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

import { Ride } from '../db/client.js';

export interface PaymentCapturedPayload {
  ride: Ride | Record<string, unknown>;
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
