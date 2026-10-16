import { getAccessToken } from "../apiInterceptor";
import type { PaymentStatus } from "./payment";

const ServerEvents = {
  RIDE_ACCEPTED: "server:ride-accepted",
  DRIVER_LOCATION: "server:driver-location",
  DRIVER_ARRIVED: "server:driver-arrived",
  ARRIVED_AT_DESTINATION: "server:ride-arrived-at-destination",
  RIDE_STARTED: "server:ride-started",
  PAYMENT_CAPTURED: "server:payment-captured",
  RIDE_COMPLETED: "server:ride-completed",
  RIDE_CANCELLED: "server:ride-cancelled",
  RIDE_NO_DRIVERS_AVAILABLE: "server:ride-no-drivers-available",
  ERROR: "server:error",
} as const;

export type ServerEvent = (typeof ServerEvents)[keyof typeof ServerEvents];

export type ServerMessage<T = unknown> = {
  event: string;
  data: T;
};

export interface DriverLocationPayload {
  rideId: string;
  latitude: number;
  longitude: number;
}

export interface RideCancelledPayload {
  rideId: string;
  cancelledBy: "RIDER" | "DRIVER";
  reason?: string;
}

export interface PaymentCapturedPayload {
  ride: { _id: string; paymentStatus: PaymentStatus };
}

export const DriverEvents = {
  UPDATE_LOCATION: "driver:update-location",
  HEARTBEAT: "driver:heartbeat",
} as const;

export type DriverEvent = (typeof DriverEvents)[keyof typeof DriverEvents];

interface RiderSocketOptions {
  onReady: () => void;
  onError: (message: string) => void;
  onRideAccepted: () => void;
  onDriverLocation: (payload: DriverLocationPayload) => void;
  onDriverArriving: () => void;
  onRideStarted: () => void;
  onPaymentCaptured: (payload: PaymentCapturedPayload) => void;
  onRideArrivedAtDestination: () => void;
  onRideCompleted: () => void;
  onRideCancelled: (payload: RideCancelledPayload) => void;
  onNoDriversAvailable: () => void;
}

const apiUrl = (import.meta.env.VITE_API_URL || "http://localhost:3001").replace(/\/+$/u, "");
const inferredWebSocketUrl = apiUrl.replace(/^http/u, (protocol: string) =>
  protocol === "https" ? "wss" : "ws"
);

// In production the WebSocket server is hosted by the same service as the API.
// This keeps the real-time connection on Render even when VITE_WS_URL was not
// separately configured at build time.
const WS_URL = import.meta.env.VITE_WS_URL || inferredWebSocketUrl;

export function connectRiderSocket(options: RiderSocketOptions): WebSocket {
  const token = getAccessToken();
  if (!token) {
    throw new Error("Missing access token for socket connection.");
  }

  const socket = new WebSocket(`${WS_URL}?token=${token}`);

  socket.addEventListener("open", () => {
    options.onReady();
  });

  socket.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(event.data.toString()) as ServerMessage<unknown>;

      switch (message.event) {
        case ServerEvents.RIDE_ACCEPTED:
          options.onRideAccepted();
          break;
        case ServerEvents.DRIVER_LOCATION:
          options.onDriverLocation(message.data as DriverLocationPayload);
          break;
        case ServerEvents.DRIVER_ARRIVED:
          options.onDriverArriving();
          break;
        case ServerEvents.RIDE_STARTED:
          options.onRideStarted();
          break;
        case ServerEvents.PAYMENT_CAPTURED:
          options.onPaymentCaptured(message.data as PaymentCapturedPayload);
          break;
        case ServerEvents.ARRIVED_AT_DESTINATION:
          options.onRideArrivedAtDestination();
          break;
        case ServerEvents.RIDE_COMPLETED:
          options.onRideCompleted();
          break;
        case ServerEvents.RIDE_CANCELLED:
          options.onRideCancelled(message.data as RideCancelledPayload);
          break;
        case ServerEvents.RIDE_NO_DRIVERS_AVAILABLE:
          options.onNoDriversAvailable();
          break;
        case ServerEvents.ERROR:
          options.onError((message.data as { message?: string })?.message ?? "Socket error received.");
          break;
        default:
          break;
      }
    } catch {
      options.onError("Failed to parse socket message.");
    }
  });

  socket.addEventListener("error", () => {
    options.onError("WebSocket connection error.");
  });

  return socket;
}

interface DriverSocketOptions {
  onReady: () => void;
  onError: (message: string) => void;
}

export function connectDriverSocket(options: DriverSocketOptions): WebSocket {
  const token = getAccessToken();

  if (!token) {
    throw new Error("Missing access token for driver socket connection.");
  }

  const socket = new WebSocket(`${WS_URL}?token=${token}`);

  socket.addEventListener("open", () => {
    options.onReady();
  });

  socket.addEventListener("error", () => {
    options.onError("WebSocket connection error.");
  });

  return socket;
}

export function sendDriverLocation(socket: WebSocket | null, latitude: number, longitude: number) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(
    JSON.stringify({
      event: DriverEvents.UPDATE_LOCATION,
      data: {
        latitude,
        longitude,
      },
    })
  );
}
