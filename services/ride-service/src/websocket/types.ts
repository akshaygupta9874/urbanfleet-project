import { WebSocket } from 'ws';

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
  latitude: number;
  longitude: number;
}

export interface RideProgressPayload {
  rideId: string;
}
