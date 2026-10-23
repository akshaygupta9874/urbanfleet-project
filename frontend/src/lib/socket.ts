import { getAccessToken } from "../apiInterceptor";
import type { PaymentStatus } from "./payment";
import type { Coordinates } from "../types/location";
import type {
  RideIdPayload,
  RideLifecyclePayload,
  RiderRideCreatedPayload,
} from "../types/ride";

const ServerEvents = {
  RIDE_CREATED: "server:ride-created",
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

export interface DriverLocationPayload extends Coordinates {
  rideId: string;
}

export interface RideCancelledPayload {
  rideId: string;
  cancelledBy: "RIDER" | "DRIVER";
  reason?: string;
}

export interface PaymentCapturedPayload {
  ride: { id: string; paymentStatus: PaymentStatus };
}

export const DriverEvents = {
  UPDATE_LOCATION: "driver:update-location",
  HEARTBEAT: "driver:heartbeat",
} as const;

export type DriverEvent = (typeof DriverEvents)[keyof typeof DriverEvents];

interface RiderSocketOptions {
  onReady: () => void;
  onError: (message: string) => void;
  onRideCreated: (payload: RiderRideCreatedPayload) => void;
  onRideAccepted: (payload: RideLifecyclePayload) => void;
  onDriverLocation: (payload: DriverLocationPayload) => void;
  onDriverArriving: (payload: RideLifecyclePayload) => void;
  onRideStarted: (payload: RideLifecyclePayload) => void;
  onPaymentCaptured: (payload: PaymentCapturedPayload) => void;
  onRideArrivedAtDestination: (payload: RideLifecyclePayload) => void;
  onRideCompleted: (payload: RideLifecyclePayload) => void;
  onRideCancelled: (payload: RideCancelledPayload) => void;
  onNoDriversAvailable: (payload: RideIdPayload) => void;
}

const getApiUrl = (): string => {
  const envUrl = (import.meta.env.VITE_API_URL || "").trim();
  if (typeof window !== "undefined") {
    if (window.location.protocol === "https:" && (!envUrl || envUrl.startsWith("http://"))) {
      return window.location.origin;
    }
  }
  return (envUrl || "http://localhost:3001").replace(/\/+$/u, "");
};

const apiUrl = getApiUrl();
const inferredWebSocketUrl = apiUrl.replace(/^http/u, (protocol: string) =>
  protocol === "https" ? "wss" : "ws"
);

const getBaseWsUrl = (): string => {
  const envWs = (import.meta.env.VITE_WS_URL || "").trim();
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    if (!envWs || envWs.startsWith("ws://")) {
      return inferredWebSocketUrl;
    }
  }
  return (envWs || inferredWebSocketUrl).replace(/\/+$/u, "");
};

const baseWsUrl = getBaseWsUrl();
const WS_URL = baseWsUrl.includes("/ws") ? baseWsUrl : `${baseWsUrl}/ws/ride`;

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
        case ServerEvents.RIDE_CREATED:
          options.onRideCreated(message.data as RiderRideCreatedPayload);
          break;
        case ServerEvents.RIDE_ACCEPTED:
          options.onRideAccepted(message.data as RideLifecyclePayload);
          break;
        case ServerEvents.DRIVER_LOCATION:
          options.onDriverLocation(message.data as DriverLocationPayload);
          break;
        case ServerEvents.DRIVER_ARRIVED:
          options.onDriverArriving(message.data as RideLifecyclePayload);
          break;
        case ServerEvents.RIDE_STARTED:
          options.onRideStarted(message.data as RideLifecyclePayload);
          break;
        case ServerEvents.PAYMENT_CAPTURED:
          options.onPaymentCaptured(message.data as PaymentCapturedPayload);
          break;
        case ServerEvents.ARRIVED_AT_DESTINATION:
          options.onRideArrivedAtDestination(message.data as RideLifecyclePayload);
          break;
        case ServerEvents.RIDE_COMPLETED:
          options.onRideCompleted(message.data as RideLifecyclePayload);
          break;
        case ServerEvents.RIDE_CANCELLED:
          options.onRideCancelled(message.data as RideCancelledPayload);
          break;
        case ServerEvents.RIDE_NO_DRIVERS_AVAILABLE:
          options.onNoDriversAvailable(message.data as RideIdPayload);
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

export function sendDriverLocation(socket: WebSocket | null, coordinates: Coordinates) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(
    JSON.stringify({
      event: DriverEvents.UPDATE_LOCATION,
      data: coordinates,
    })
  );
}
