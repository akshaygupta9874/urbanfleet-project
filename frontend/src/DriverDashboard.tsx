import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Navigation,
  Loader2,
  X,
  Car,
  Bike,
  Star,
  Wallet,
  Shield,
  FileText,
  ChevronRight,
  Clock,
  Route as RouteIcon,
  MapPin,
  CheckCircle2,
  Power,
  History,
  Settings,
  LogOut,
  AlertTriangle,
  Zap,
  Gem,
} from "lucide-react";
import LoadingScreen from "./components/LoadingScreen";
import MapView from "./components/MapView";
import { Button } from "./components/ui/button";
import { appApi } from "./lib/api";
import { connectDriverSocket, sendDriverLocation } from "./lib/socket";
import { fetchDriverProfile } from "./lib/driverApi";
import { useAuthContext } from "./context/auth-context";
import { getGeoapifyRouteLines, isGeoapifyFeatureCollection } from "./types/geoapify";
import CityMapBackground from "./components/CityMapBackground";
import { type PaymentStatus } from "./lib/payment";

// --- Types mirrored from backend Mongoose models (Driver.ts / Ride.ts) ---
type VehicleType = "CAR" | "BIKE" | "AUTO";

type RideStatus =
  | "SEARCHING"
  | "DRIVER_ASSIGNED"
  | "DRIVER_ARRIVING"
  | "STARTED"
  | "ARRIVED_AT_DESTINATION"
  | "COMPLETED"
  | "CANCELLED";

interface RidePoint {
  address: string;
  coordinates: { latitude: number; longitude: number };
}

interface FareBreakdown {
  baseFarePaise: number;
  distanceFarePaise: number;
  timeFarePaise: number;
  surgePaise: number;
  platformCommissionPaise: number;
  driverEarningPaise: number;
  totalPaise: number;
}

export interface Ride {
  _id: string;
  driver: string;
  pickup: RidePoint;
  destination: RidePoint;
  fare: {
    estimated: number;
    final: number | null;
    breakdown: FareBreakdown | null;
    fareBreakdown?: FareBreakdown | null;
  };
  distance: { estimated: number; actual: number | null };
  duration: { estimated: number; actual: number | null };
  status: RideStatus;
  paymentStatus: PaymentStatus;
  cancelledBy: "RIDER" | "DRIVER" | "SYSTEM" | null;
  cancellationReason: string | null;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
}

interface DriverProfileData {
  _id: string;
  profilePhoto: { url: string; publicId: string };
  vehicleImages: { front: string; back: string; left: string; right: string; interior: string };
  vehicle: {
    type: VehicleType;
    brand: string;
    model: string;
    color: string;
    registrationNumber: string;
    registrationYear: number;
  };
  documents: {
    drivingLicense: { number: string; expiryDate: string; frontImage: string; backImage: string; verified: boolean };
    registrationCertificate: { number: string; image: string; verified: boolean };
    insurance: { number: string; expiryDate: string; image: string; verified: boolean };
    pollutionCertificate: { expiryDate: string; image: string };
  };
  verificationStatus: "PENDING" | "APPROVED" | "REJECTED";
  isVerified: boolean;
  rating: { average: number; totalRatings: number };
  statistics: {
    totalTrips: number;
    completedTrips: number;
    cancelledTrips: number;
    totalDistance: number;
    totalEarnings: number;
  };
  lastOnlineAt?: string;
}

const DriverEvents = {
  GO_ONLINE: "driver:go-online",
  GO_OFFLINE: "driver:go-offline",
  UPDATE_LOCATION: "driver:update-location",
  SET_AVAILABLE: "driver:set-available",
  SET_BUSY: "driver:set-busy",
  SET_OFFLINE: "driver:set-offline",
  HEARTBEAT: "driver:heartbeat",
  ACCEPT_RIDE: "driver:accept-ride",
  REJECT_RIDE: "driver:reject-ride",
  ARRIVED_AT_PICKUP: "driver:arrived-at-pickup",
  ARRIVED_AT_DESTINATION: "driver:arrived-at-destination",
  START_RIDE: "driver:start-ride",
  COMPLETE_RIDE: "driver:complete-ride",
  CANCEL_RIDE_BY_DRIVER: "driver:cancel-ride",
} as const;

const ServerEvents = {
  NEW_RIDE: "server:new-ride",
  RIDE_ACCEPTED: "server:ride-accepted",
  RIDE_NO_DRIVERS_AVAILABLE: "server:ride-no-drivers-available",
  DRIVER_LOCATION: "server:driver-location",
  DRIVER_ARRIVING: "server:driver-arriving",
  ARRIVED_AT_DESTINATION: "server:ride-arrived-at-destination",
  PAYMENT_CAPTURED: "server:payment-captured",
  RIDE_STARTED: "server:ride-started",
  RIDE_COMPLETED: "server:ride-completed",
  RIDE_CANCELLED: "server:ride-cancelled",
  ERROR: "server:error",
} as const;

type DriverStatus = "OFFLINE" | "ONLINE" | "AVAILABLE" | "BUSY";

const BUSY_RIDE_STATUSES: RideStatus[] = ["DRIVER_ASSIGNED", "DRIVER_ARRIVING", "STARTED", "ARRIVED_AT_DESTINATION"];
const TERMINAL_RIDE_STATUSES: RideStatus[] = ["COMPLETED", "CANCELLED"];
const HEARTBEAT_INTERVAL_MS = 10000;

const VEHICLE_TYPE_LABEL: Record<VehicleType, string> = {
  CAR: "Car",
  BIKE: "Bike",
  AUTO: "Auto",
};

const VEHICLE_TYPE_ICON: Record<VehicleType, React.ComponentType<{ className?: string }>> = {
  CAR: Car,
  BIKE: Bike,
  AUTO: Car,
};

const RIDE_STATUS_CONFIG: Record<
  RideStatus,
  { label: string; badge: string; description: string; step: number }
> = {
  SEARCHING: {
    label: "Searching",
    badge: "bg-[#3a1f0a]/80 text-[#ffd88a] border border-[#7a4416]/40",
    description: "Matching this ride with a driver.",
    step: 0,
  },
  DRIVER_ASSIGNED: {
    label: "Assigned to you",
    badge: "bg-[#3a1f0a]/80 text-[#ffd88a] border border-[#7a4416]/40",
    description: "Head to the pickup point.",
    step: 1,
  },
  DRIVER_ARRIVING: {
    label: "Arriving",
    badge: "bg-[#3a1f0a]/80 text-[#ffd88a] border border-[#7a4416]/40",
    description: "You're on your way to the rider.",
    step: 2,
  },
  STARTED: {
    label: "Trip in progress",
    badge: "bg-[#3a1f0a]/90 text-[#ffe9be] border border-[#c58a3a]/60",
    description: "Trip is underway to the destination.",
    step: 3,
  },
  ARRIVED_AT_DESTINATION: {
    label: "Arrived at destination",
    badge: "bg-[#3a1f0a]/90 text-[#ffe9be] border border-[#c58a3a]/60",
    description: "Payment is required before completion.",
    step: 4,
  },
  COMPLETED: {
    label: "Completed",
    badge: "bg-emerald-950/80 text-emerald-200 border border-emerald-500/30",
    description: "This trip has been completed.",
    step: 5,
  },
  CANCELLED: {
    label: "Cancelled",
    badge: "bg-rose-950/80 text-rose-200 border border-rose-500/30",
    description: "This ride was cancelled.",
    step: 4,
  },
};

const PAYMENT_STATUS_LABEL: Record<
  PaymentStatus,
  { label: string; badge: string }
> = {
  CREATED: {
    label: "Payment created",
    badge: "text-blue-300 bg-blue-950/20 border border-blue-500/30",
  },

  PENDING: {
    label: "Payment pending",
    badge: "text-amber-300 bg-[#3a1f0a]/80 border border-[#7a4416]/40",
  },

  AUTHORIZED: {
    label: "Payment authorized",
    badge: "text-blue-300 bg-blue-950/20 border border-blue-500/30",
  },

  CAPTURED: {
    label: "Payment captured",
    badge: "text-emerald-300 bg-emerald-950/80 border border-emerald-500/30",
  },

  FAILED: {
    label: "Payment failed",
    badge: "text-rose-300 bg-rose-950/20 border border-rose-500/30",
  },

  CANCELLED: {
    label: "Payment cancelled",
    badge: "text-rose-300 bg-rose-950/20 border border-rose-500/30",
  },

  REFUNDED: {
    label: "Refunded",
    badge: "text-[#ffd88a] bg-[#3a1f0a]/80 border border-[#7a4416]/40",
  },

  PARTIALLY_REFUNDED: {
    label: "Partially refunded",
    badge: "text-amber-300 bg-[#3a1f0a]/80 border border-[#7a4416]/40",
  },
};

const RIDE_STEPS: { key: RideStatus; label: string }[] = [
  { key: "SEARCHING", label: "Searching" },
  { key: "DRIVER_ASSIGNED", label: "Assigned" },
  { key: "DRIVER_ARRIVING", label: "Arriving" },
  { key: "STARTED", label: "In trip" },
  { key: "ARRIVED_AT_DESTINATION", label: "At destination" },
  { key: "COMPLETED", label: "Completed" },
];
function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDistanceMeters(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function formatDurationSeconds(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function StatCard({
  label,
  value,
  icon: Icon,
  trend,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: string;
}) {
  return (
    <div className="w-full relative overflow-hidden rounded-2xl border border-[#7a4416]/30 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-5 shadow-lg backdrop-blur-xl text-[#2e1808] transition-all duration-200 hover:border-[#b8722c] active:scale-[0.98]">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#7a4416]">{label}</p>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#3a1f0a] text-[#ffd88a] shadow-sm">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between">
        <h3 className="text-xl font-bold tracking-tight text-[#2e1808]" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>{value}</h3>
        {trend && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#3a1f0a]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#7a4416] border border-[#7a4416]/20">
            {trend}
          </span>
        )}
      </div>
    </div>
  );
}

function RideStepper({ status }: { status: RideStatus }) {
  const activeIdx = RIDE_STEPS.findIndex((s) => s.key === status);
  return (
    <div className="w-full py-2">
      <ol className="flex w-full items-center justify-between">
        {RIDE_STEPS.map((s, i) => {
          const done = i <= activeIdx && status !== "CANCELLED";
          const current = i === activeIdx && status !== "CANCELLED";
          return (
            <li key={s.key} className="relative flex flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                <span
                  className={`h-0.5 flex-1 transition-colors duration-300 ${
                    i === 0 ? "bg-transparent" : done ? "bg-[#3a1f0a]" : "bg-[#7a4416]/20"
                  }`}
                />
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-all duration-300 ${
                    done
                      ? "border-[#ffd88a] bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] text-[#ffd88a] shadow-sm"
                      : "border-[#7a4416]/30 bg-[#fffaf0] text-[#7a4416]"
                  } ${current ? "ring-4 ring-[#b8722c]/20" : ""}`}
                >
                  {done ? <CheckCircle2 className="h-4 w-4 text-[#ffd88a]" /> : i + 1}
                </div>
                <span
                  className={`h-0.5 flex-1 transition-colors duration-300 ${
                    i === RIDE_STEPS.length - 1
                      ? "bg-transparent"
                      : i < activeIdx && status !== "CANCELLED"
                        ? "bg-[#3a1f0a]"
                        : "bg-[#7a4416]/20"
                  }`}
                />
              </div>
              <span
                className={`mt-2 text-center text-[11px] font-medium transition-colors ${
                  current ? "font-bold text-[#b8722c]" : "text-[#7a4416]/70"
                }`}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}


export default function DriverDashboard() {
  const { logout } = useAuthContext();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<DriverProfileData | null>(null);
  const [currentRide, setCurrentRide] = useState<Ride | null>(null);
  const [driverLocation, setDriverLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [driverStatus, setDriverStatus] = useState<DriverStatus>("ONLINE");
  const [routePolyline, setRoutePolyline] = useState<{
    rideId: string;
    points: Array<{ lat: number; lng: number }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showEarningsFlash, setShowEarningsFlash] = useState<number | null>(null);
  const [currentTime] = useState(() => Date.now());

  const watchIdRef = useRef<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const driverStatusRef = useRef<DriverStatus>("ONLINE");
  const currentRideRef = useRef<Ride | null>(null);
  const hasEmittedOnlineRef = useRef(false);
  const routeRequestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeAbortControllerRef = useRef<AbortController | null>(null);
  const lastRouteFetchAtRef = useRef(0);

  const applyCompletedRideStats = useCallback((ride: Ride | null | undefined) => {
    if (!ride) return;

    const earningPaise =
      ride.fare?.breakdown?.driverEarningPaise ??
      ride.fare?.fareBreakdown?.driverEarningPaise ??
      0;
    const distanceMeters = ride.distance?.actual ?? ride.distance?.estimated ?? 0;

    setProfile((prevProfile) => {
      if (!prevProfile) return prevProfile;
      return {
        ...prevProfile,
        statistics: {
          ...prevProfile.statistics,
          completedTrips: prevProfile.statistics.completedTrips + 1,
          totalEarnings: prevProfile.statistics.totalEarnings + earningPaise,
          totalDistance: prevProfile.statistics.totalDistance + distanceMeters,
        },
      };
    });
  }, []);

  useEffect(() => {
    driverStatusRef.current = driverStatus;
  }, [driverStatus]);
  useEffect(() => {
    currentRideRef.current = currentRide;
  }, [currentRide]);

  useEffect(() => {
    async function loadProfileAndRide() {
      try {
        const [profileResponse, rideResponse] = await Promise.all([
          fetchDriverProfile(),
          appApi.get<{ message: string; ride: Ride }>("/ride/driver/current").catch(() => null),
        ]);
        setProfile(profileResponse);
        if (rideResponse && rideResponse.data?.ride) {
          const currentRideData = rideResponse.data.ride;
          setCurrentRide(currentRideData);
          if (BUSY_RIDE_STATUSES.includes(currentRideData.status)) {
            setDriverStatus("BUSY");
            driverStatusRef.current = "BUSY";
          }
        }
      } catch (err: unknown) {
        const response = err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { message?: unknown } } }).response
          : undefined;
        const message = response?.data?.message;
        setError(typeof message === "string" ? message : "Unable to load driver profile.");
      } finally {
        setLoading(false);
      }
    }
    loadProfileAndRide();
  }, []);

  useEffect(() => {
    const ROUTE_REFRESH_INTERVAL_MS = 10_000;

    const fetchGeoapifyRoute = async () => {
      if (!currentRide) return;

      const apiKey = import.meta.env.VITE_GEOAPIFY_API_KEY || "";
      if (!apiKey) return;

      const waypoints: string[] = [];
      if (driverLocation) waypoints.push(`${driverLocation.latitude},${driverLocation.longitude}`);
      waypoints.push(`${currentRide.pickup.coordinates.latitude},${currentRide.pickup.coordinates.longitude}`);
      waypoints.push(`${currentRide.destination.coordinates.latitude},${currentRide.destination.coordinates.longitude}`);
      if (waypoints.length < 2) return;

      routeAbortControllerRef.current?.abort();
      const controller = new AbortController();
      routeAbortControllerRef.current = controller;
      lastRouteFetchAtRef.current = Date.now();

      try {
        const url = `https://api.geoapify.com/v1/routing?waypoints=${waypoints.join("|")}&mode=drive&apiKey=${apiKey}`;
        const res = await fetch(url, { signal: controller.signal });
        const data: unknown = await res.json();
        if (isGeoapifyFeatureCollection(data)) {
          const coords = getGeoapifyRouteLines(data.features[0]);
          const flatPoints: Array<{ lat: number; lng: number }> = [];
          coords.forEach((line: [number, number][]) => {
            line.forEach(([lon, lat]) => flatPoints.push({ lat, lng: lon }));
          });
          setRoutePolyline({
            rideId: currentRide._id,
            points: flatPoints,
          });
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("Failed to fetch Geoapify route polyline", err);
      }
    };

    if (!currentRide) {
      if (routeRequestTimeoutRef.current !== null) {
        clearTimeout(routeRequestTimeoutRef.current);
        routeRequestTimeoutRef.current = null;
      }
      routeAbortControllerRef.current?.abort();
      routeAbortControllerRef.current = null;
    } else {
      const elapsed = Date.now() - lastRouteFetchAtRef.current;
      const delay = lastRouteFetchAtRef.current === 0
        ? 0
        : Math.max(0, ROUTE_REFRESH_INTERVAL_MS - elapsed);

      if (routeRequestTimeoutRef.current !== null) {
        clearTimeout(routeRequestTimeoutRef.current);
      }

      routeRequestTimeoutRef.current = setTimeout(() => {
        routeRequestTimeoutRef.current = null;
        void fetchGeoapifyRoute();
      }, delay);
    }

    return () => {
      if (routeRequestTimeoutRef.current !== null) {
        clearTimeout(routeRequestTimeoutRef.current);
        routeRequestTimeoutRef.current = null;
      }
    };
  }, [currentRide, driverLocation]);

  useEffect(() => {
    return () => {
      routeAbortControllerRef.current?.abort();
      routeAbortControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!profile) return;

    const driverSocket = connectDriverSocket({
      onReady: () => {
        setError("");
        if (!hasEmittedOnlineRef.current) {
          hasEmittedOnlineRef.current = true;
          driverSocket.send(JSON.stringify({ event: DriverEvents.GO_ONLINE, data: {} }));
        }
        if (currentRideRef.current && BUSY_RIDE_STATUSES.includes(currentRideRef.current.status)) {
          driverSocket.send(JSON.stringify({ event: DriverEvents.SET_BUSY, data: {} }));
          setDriverStatus("BUSY");
        }
      },
      onError: (message) => setError(message),
    });

    socketRef.current = driverSocket;

    driverSocket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        const { event: serverEvent, data } = parsed;

        switch (serverEvent) {
          case ServerEvents.NEW_RIDE:
            if (data?.ride) {
              setError("");
              setCurrentRide(data.ride);
            }
            break;
          case ServerEvents.RIDE_ACCEPTED:
            if (data?.ride) setCurrentRide(data.ride);
            break;
          case ServerEvents.DRIVER_ARRIVING:
            setCurrentRide((prev) => (prev ? { ...prev, status: "DRIVER_ARRIVING" } : prev));
            break;
          case ServerEvents.ARRIVED_AT_DESTINATION:
            setCurrentRide((prev) => (prev ? { ...prev, status: "ARRIVED_AT_DESTINATION" } : prev));
            break;
          case ServerEvents.PAYMENT_CAPTURED:
            setCurrentRide((prev) =>
              prev
                ? {
                    ...prev,
                    ...data.ride,
                  }
                : prev
            );
            break;
          case ServerEvents.RIDE_STARTED:
            setCurrentRide((prev) => (prev ? { ...prev, status: "STARTED" } : prev));
            break;
          case ServerEvents.RIDE_COMPLETED: {
            setCurrentRide((prev) => {
              const updated = prev ? { ...prev, status: "COMPLETED" as RideStatus, ...data?.ride } : null;
              if (updated) {
                applyCompletedRideStats(updated);
                const earnedPaise =
                  updated.fare?.breakdown?.driverEarningPaise ??
                  updated.fare?.fareBreakdown?.driverEarningPaise ??
                  0;
                if (earnedPaise > 0) {
                  setShowEarningsFlash(earnedPaise);
                  setTimeout(() => setShowEarningsFlash(null), 3200);
                }
              }
              return updated;
            });
            break;
          }
          case ServerEvents.RIDE_CANCELLED:
            setCurrentRide((prev) =>
              prev
                ? { ...prev, status: "CANCELLED", cancelledBy: data?.cancelledBy, cancellationReason: data?.reason }
                : prev,
            );
            break;
          case ServerEvents.ERROR:
            setError(data?.message || "Server error occurred.");
            break;
          default:
            break;
        }
      } catch (err) {
        console.error("Failed to parse incoming socket message:", err);
      }
    };

    const heartbeatInterval = setInterval(() => {
      if (driverStatusRef.current === "OFFLINE") return;
      if (driverSocket.readyState === WebSocket.OPEN) {
        driverSocket.send(JSON.stringify({ event: DriverEvents.HEARTBEAT, data: {} }));
      }
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      clearInterval(heartbeatInterval);
      if (hasEmittedOnlineRef.current && driverSocket.readyState === WebSocket.OPEN) {
        driverSocket.send(JSON.stringify({ event: DriverEvents.GO_OFFLINE, data: {} }));
      }
      hasEmittedOnlineRef.current = false;
      driverSocket.close();
    };
  }, [applyCompletedRideStats, profile]);

  const currentRideStatus = currentRide?.status;

  useEffect(() => {
    if (!profile) return;

    if (currentRideStatus && BUSY_RIDE_STATUSES.includes(currentRideStatus)) {
      if (driverStatusRef.current !== "BUSY") {
        driverStatusRef.current = "BUSY";
        setDriverStatus("BUSY");
      }
      return;
    }

    if (driverStatus === "OFFLINE" || driverStatus === "ONLINE") {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    if (!navigator.geolocation) {
      void Promise.resolve().then(() => setError("Geolocation is not supported in this browser."));
      return;
    }

    const syncLocation = (latitude: number, longitude: number) => {
      setDriverLocation({ latitude, longitude });
      sendDriverLocation(socketRef.current, latitude, longitude);
    };

    navigator.geolocation.getCurrentPosition(
      (position) => {
        syncLocation(position.coords.latitude, position.coords.longitude);
      },
      (positionError) => setError(`Navigator : ${positionError.message} `),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        syncLocation(latitude, longitude);
      },
      (positionError) => setError(`Navigator : ${positionError.message} `),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );

    watchIdRef.current = watchId;

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [currentRideStatus, driverStatus, profile?.verificationStatus]);

  useEffect(() => {
    if (!currentRide) return;
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    if (driverStatusRef.current === "OFFLINE") return;

    if (BUSY_RIDE_STATUSES.includes(currentRide.status) && driverStatusRef.current !== "BUSY") {
      socketRef.current.send(JSON.stringify({ event: DriverEvents.SET_BUSY, data: {} }));
      setDriverStatus("BUSY");
    } else if (TERMINAL_RIDE_STATUSES.includes(currentRide.status) && driverStatusRef.current === "BUSY") {
      socketRef.current.send(JSON.stringify({ event: DriverEvents.SET_AVAILABLE, data: {} }));
      setDriverStatus("AVAILABLE");
    }
  }, [currentRide, currentRide?.status]);

  const handleToggleAvailability = () => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setError("Socket connection not ready.");
      return;
    }
    if (driverStatus === "BUSY") {
      setError("You can't go offline while a ride is active.");
      return;
    }

    if (driverStatus === "ONLINE") {
      socketRef.current.send(JSON.stringify({ event: DriverEvents.SET_AVAILABLE, data: { available: true } }));
      setDriverStatus("AVAILABLE");
      return;
    }

    socketRef.current.send(JSON.stringify({ event: DriverEvents.SET_AVAILABLE, data: { available: false } }));
    setDriverStatus("ONLINE");
  };

  const handleAcceptRide = (rideId: string) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setError("Socket connection not ready.");
      return;
    }
    setError("");
    socketRef.current.send(JSON.stringify({ event: DriverEvents.ACCEPT_RIDE, data: { rideId } }));
    setCurrentRide((prev) => (prev ? { ...prev, status: "DRIVER_ASSIGNED" } : prev));
  };

  const handleRejectRide = (rideId: string) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setError("Socket connection not ready.");
      return;
    }
    socketRef.current.send(JSON.stringify({ event: DriverEvents.REJECT_RIDE, data: { rideId } }));
    setCurrentRide(null);
  };

  const handleCancelRide = (rideId: string) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setError("Socket connection not ready.");
      return;
    }
    setError("");
    socketRef.current.send(
      JSON.stringify({
        event: DriverEvents.CANCEL_RIDE_BY_DRIVER,
        data: { rideId, reason: "Cancelled by driver" },
      }),
    );
    setCurrentRide((prev) => (prev ? { ...prev, status: "CANCELLED", cancelledBy: "DRIVER" } : prev));
  };

  const sendRideAction = (event: string, rideId: string, extraData = {}) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setError("Socket connection not ready.");
      return;
    }
    socketRef.current.send(JSON.stringify({ event, data: { rideId, ...extraData } }));
    if (event === DriverEvents.ARRIVED_AT_PICKUP) {
      setCurrentRide((prev) => (prev ? { ...prev, status: "DRIVER_ARRIVING" } : prev));
    } else if (event === DriverEvents.ARRIVED_AT_DESTINATION) {
      setCurrentRide((prev) => (prev ? { ...prev, status: "ARRIVED_AT_DESTINATION" } : prev));
    } else if (event === DriverEvents.START_RIDE) {
      setCurrentRide((prev) => (prev ? { ...prev, status: "STARTED" } : prev));
    }
  };

  const acceptanceRate = useMemo(() => {
    if (!profile) return 0;
    const total = profile.statistics?.totalTrips ?? (profile as any).totalTrips ?? 1;
    const completed = profile.statistics?.completedTrips ?? (profile as any).completedTrips ?? 0;
    return Math.round((completed / (total || 1)) * 100);
  }, [profile]);

  if (loading) {
    return <LoadingScreen label="Loading driver dashboard" />;
  }

  if (!profile || profile.verificationStatus != "APPROVED") {
    return (
      <div className="relative flex min-h-screen w-full items-center justify-center bg-[#f5e6c8] p-6 font-sans text-[#2e1808] overflow-hidden">
        <CityMapBackground />
        <div className="relative z-10 w-full max-w-lg rounded-[2.5rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-8 shadow-2xl backdrop-blur-2xl">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-r from-[#3a1f0a] to-[#7a4416] text-[#ffd88a] shadow-md">
              <Shield className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#2e1808]" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>Driver verification required</h1>
              <p className="text-xs text-[#7a4416]">Access restricted to verified drivers</p>
            </div>
          </div>
          {error ? (
            <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-950/20 p-4 text-sm text-rose-900">
              {error}
            </div>
          ) : (
            <p className="mt-4 text-sm text-[#6b3a12]">
              Your driver profile is currently pending verification or has not been fully registered. Please complete the registration flow to start accepting rides.
            </p>
          )}
          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
            <Button onClick={() => navigate("/driver-registration")} className="w-full bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffe9be] hover:opacity-90 border border-[#c58a3a]/40 shadow-md">
              Register as driver
            </Button>
            <Button variant="outline" onClick={() => navigate("/dashboard")} className="w-full border-[#7a4416]/30 bg-[#fffaf0] text-[#3a1f0a] hover:bg-[#fff4dc]">
              Go to rider dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const mapCenter = driverLocation
    ? { lat: driverLocation.latitude, lng: driverLocation.longitude }
    : currentRide
      ? { lat: currentRide.pickup.coordinates.latitude, lng: currentRide.pickup.coordinates.longitude }
      : { lat: 12.9716, lng: 77.5946 };

  const mapMarkers = [
    ...(driverLocation
      ? [{ position: { lat: driverLocation.latitude, lng: driverLocation.longitude }, label: "DR", title: "You" }]
      : []),
    ...(currentRide
      ? [
          {
            position: { lat: currentRide.pickup.coordinates.latitude, lng: currentRide.pickup.coordinates.longitude },
            label: "P",
            title: "Pickup",
          },
          {
            position: {
              lat: currentRide.destination.coordinates.latitude,
              lng: currentRide.destination.coordinates.longitude,
            },
            label: "D",
            title: "Destination",
          },
        ]
      : []),
  ];

  const statusConfig = currentRide ? RIDE_STATUS_CONFIG[currentRide.status] : null;
  const paymentInfo = currentRide ? PAYMENT_STATUS_LABEL[currentRide.paymentStatus] : null;
  const canCompleteCurrentRide =
    currentRide?.status === "ARRIVED_AT_DESTINATION" &&
    (currentRide.paymentStatus === "CAPTURED");
  const distance = currentRide ? currentRide.distance.actual ?? currentRide.distance.estimated : null;
  const duration = currentRide ? currentRide.duration.actual ?? currentRide.duration.estimated : null;
  const fare = currentRide
    ? currentRide.fare.breakdown?.driverEarningPaise ?? currentRide.fare.final ?? currentRide.fare.estimated
    : null;
  const fareBreakdownData = currentRide?.fare?.breakdown ?? currentRide?.fare?.fareBreakdown ?? null;

  const driverStatusCopy: Record<DriverStatus, string> = {
    OFFLINE: "You are offline. Riders cannot see your location.",
    ONLINE: "You are online on the dashboard, ready to go available.",
    AVAILABLE: "Scanning for incoming ride requests nearby...",
    BUSY: "Currently on an active trip. Status updates automatically.",
  };

  const statusDotColor =
    driverStatus === "AVAILABLE"
      ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.7)]"
      : driverStatus === "BUSY"
        ? "bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.7)]"
        : driverStatus === "ONLINE"
          ? "bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.7)]"
          : "bg-[#7a4416]";

  const vehicleType = profile?.vehicle?.type || "CAR";
  const VehicleIcon = VEHICLE_TYPE_ICON[vehicleType] || Car;

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden bg-[#f5e6c8] font-sans text-[#2e1808]">
      <CityMapBackground />

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500&family=Inter:wght@400;500;600;700&display=swap');

        .rd-scroll-fade::-webkit-scrollbar { width: 6px; }
        .rd-scroll-fade::-webkit-scrollbar-thumb { background: #c58a3a; border-radius: 999px; }
        
        .console-display { font-family: 'Fraunces', ui-serif, Georgia, serif; }
        .console-readout { font-family: 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
      `}</style>

      {/* Earnings Toast Alert */}
      {showEarningsFlash !== null && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 w-[calc(100%-2rem)] max-w-sm text-center">
          <div className="flex items-center justify-center gap-2.5 rounded-full bg-gradient-to-r from-emerald-900 to-emerald-950 px-5 py-2.5 text-sm font-semibold text-emerald-100 shadow-xl border border-emerald-500/30">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400" />
            Trip completed successfully · +{formatPaise(showEarningsFlash)}
          </div>
        </div>
      )}

      {/* Main Full-Width Content Container */}
      <div className="relative z-10 w-full px-4 sm:px-8 lg:px-12 py-6 space-y-6">
        {/* Header */}
        <header className="sticky top-4 z-50 w-full">
          <div className="w-full rounded-[2rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/90 via-[#fff4dc]/85 to-[#f7e2b8]/85 backdrop-blur-xl shadow-xl px-4 sm:px-8 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffd88a] shadow-md">
                <VehicleIcon className="h-5 w-5" />
                <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#fffaf0] ${statusDotColor}`} />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#7a4416] flex items-center gap-1.5">
                  <Gem className="h-3 w-3 text-[#b8722c]" />
                  Driver Console
                </p>
                <p className="text-sm font-semibold text-[#2e1808]">
                  Drive safe • <span className="font-bold text-[#3a1f0a]">Earn smart</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/dashboard")}
                className="hidden h-9 rounded-xl border-[#7a4416]/25 bg-[#fffaf0] text-[#3a1f0a] text-xs font-semibold shadow-sm hover:bg-[#fff4dc] active:scale-95 md:inline-flex transition-all"
              >
                Rider mode
              </Button>
              <button
                onClick={() => void logout().then(() => navigate("/login", { replace: true }))}
                className="group relative grid h-10 w-10 place-items-center rounded-xl border border-rose-500/30 bg-rose-950/20 text-rose-900 shadow-sm hover:bg-rose-950/30 active:scale-95 transition-all"
                aria-label="Logout"
              >
                <LogOut className="h-4 w-4 text-rose-800 transition-colors group-hover:text-rose-950" />
              </button>
            </div>
          </div>
        </header>

        {/* Status Control Card — FULL WIDTH */}
        <section className="w-full rounded-[2.5rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-6 shadow-xl backdrop-blur-2xl relative overflow-hidden">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
          <div className="w-full flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3.5">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-colors shadow-md ${
                  driverStatus === "OFFLINE" ? "bg-[#7a4416]/20 text-[#7a4416]" : "bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] text-[#ffd88a]"
                }`}
              >
                <Power className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-[#2e1808]">Availability status</h2>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                    driverStatus === "AVAILABLE" ? "bg-emerald-950/20 text-emerald-900 border border-emerald-500/30" :
                    driverStatus === "BUSY" ? "bg-amber-950/20 text-amber-900 border border-amber-500/30" :
                    "bg-[#7a4416]/20 text-[#3a1f0a] border border-[#7a4416]/30"
                  }`}>
                    {driverStatus}
                  </span>
                </div>
                <p className="mt-1 text-xs font-medium text-[#7a4416]">{driverStatusCopy[driverStatus]}</p>
              </div>
            </div>
            <Button
              onClick={handleToggleAvailability}
              disabled={driverStatus === "BUSY"}
              className={`h-11 rounded-xl px-6 text-sm font-semibold shadow-md transition-all active:scale-[0.98] w-full sm:w-auto ${
                driverStatus === "AVAILABLE"
                  ? "border border-[#7a4416]/30 bg-[#fffaf0] text-[#3a1f0a] hover:bg-[#fff4dc]"
                  : "bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffe9be] hover:opacity-90 border border-[#c58a3a]/40"
              }`}
            >
              {driverStatus === "AVAILABLE" ? (
                "Go offline"
              ) : driverStatus === "BUSY" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> On active trip
                </>
              ) : (
                "Go online"
              )}
            </Button>
          </div>
        </section>

        {/* Analytics Stat Cards — FULL WIDTH */}
        <section className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Trips" value={String(profile?.statistics?.totalTrips ?? (profile as any)?.totalTrips ?? 0)} icon={RouteIcon} trend="+4% this week" />
          <StatCard label="Driver Rating" value={Number(profile?.rating?.average ?? (profile as any)?.averageRating ?? 5).toFixed(1)} icon={Star} />
          <StatCard label="Total Earnings" value={formatPaise(profile?.statistics?.totalEarnings ?? (profile as any)?.totalEarningsPaise ?? 0)} icon={Wallet} trend="Verified" />
          <StatCard label="Completion Rate" value={`${acceptanceRate}%`} icon={CheckCircle2} />
        </section>

        {/* System Error Display */}
        {error && (
          <div className="w-full flex items-center justify-between rounded-2xl border border-rose-500/30 bg-rose-950/20 p-4 text-sm text-rose-900 shadow-sm backdrop-blur-md">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-rose-700" />
              <span className="font-medium">{error}</span>
            </div>
            <button onClick={() => setError("")} aria-label="Dismiss" className="rounded-lg p-1 hover:bg-rose-500/10 transition-colors">
              <X className="h-4 w-4 text-rose-800" />
            </button>
          </div>
        )}

        {/* Current Active Ride Section — FULL WIDTH */}
        <section className="w-full overflow-hidden rounded-[2.5rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-6 sm:p-10 shadow-2xl backdrop-blur-2xl relative">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
          <div className="w-full flex flex-wrap items-center justify-between gap-3 border-b border-[#7a4416]/20 pb-5 mb-6">
            <div>
              <h2 className="text-lg font-bold text-[#2e1808]" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>Current trip management</h2>
              <p className="text-xs font-medium text-[#7a4416]">
                {statusConfig ? statusConfig.description : "Awaiting ride requests or dispatch instructions."}
              </p>
            </div>
            {statusConfig && (
              <span className={`rounded-full px-3.5 py-1 text-xs font-semibold shadow-xs ${statusConfig.badge}`}>
                {statusConfig.label}
              </span>
            )}
          </div>

          {!currentRide ? (
            <div className="w-full px-6 py-16 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#3a1f0a] text-[#ffd88a] shadow-inner border border-[#c58a3a]/40">
                <Navigation className="h-7 w-7 text-[#ffd88a]" />
              </div>
              <h3 className="mt-4 text-base font-bold text-[#2e1808]" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>
                {driverStatus === "AVAILABLE" ? "Scanning for nearby riders..." : "Driver console is offline"}
              </h3>
              <p className="mx-auto mt-1 max-w-sm text-xs font-medium text-[#7a4416]">
                {driverStatus === "AVAILABLE"
                  ? "Keep your app open. Requests will be dispatched automatically based on proximity."
                  : "Switch your status to online above to start receiving ride dispatch notifications."}
              </p>
            </div>
          ) : (
            <div className="w-full space-y-6">
              <RideStepper status={currentRide.status} />

              {/* Route Details Box */}
              <div className="w-full rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/90 p-5 shadow-sm">
                <div className="flex gap-4">
                  <div className="flex shrink-0 flex-col items-center pt-1">
                    <span className="h-3 w-3 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20" />
                    <span className="my-1.5 h-12 w-0.5 bg-[#b8722c]/40" />
                    <MapPin className="h-4 w-4 text-rose-600" />
                  </div>
                  <div className="flex-1 space-y-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#7a4416]">Pickup location</p>
                      <p className="text-sm font-semibold text-[#2e1808]">{currentRide.pickup.address}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#7a4416]">Destination drop-off</p>
                      <p className="text-sm font-semibold text-[#2e1808]">{currentRide.destination.address}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Ride Metrics Grid */}
              <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="w-full rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/90 p-4 shadow-sm">
                  <div className="flex items-center justify-between text-[#7a4416]">
                    <span className="text-[11px] font-semibold uppercase tracking-wider">Distance</span>
                    <RouteIcon className="h-4 w-4 text-[#b8722c]" />
                  </div>
                  <p className="mt-2 text-lg font-bold text-[#2e1808] tabular-nums font-mono">
                    {distance != null ? formatDistanceMeters(distance) : "--"}
                  </p>
                </div>
                <div className="w-full rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/90 p-4 shadow-sm">
                  <div className="flex items-center justify-between text-[#7a4416]">
                    <span className="text-[11px] font-semibold uppercase tracking-wider">Est. Duration</span>
                    <Clock className="h-4 w-4 text-[#b8722c]" />
                  </div>
                  <p className="mt-2 text-lg font-bold text-[#2e1808] tabular-nums font-mono">
                    {duration != null ? formatDurationSeconds(duration) : "--"}
                  </p>
                </div>
                <div className="w-full rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/90 p-4 shadow-sm">
                  <div className="flex items-center justify-between text-[#7a4416]">
                    <span className="text-[11px] font-semibold uppercase tracking-wider">Estimated Fare</span>
                    <Wallet className="h-4 w-4 text-[#b8722c]" />
                  </div>
                  <p className="mt-2 text-lg font-bold text-[#2e1808] tabular-nums font-mono">{fare != null ? formatPaise(fare) : "--"}</p>
                </div>
                <div className="w-full rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/90 p-4 shadow-sm">
                  <div className="flex items-center justify-between text-[#7a4416]">
                    <span className="text-[11px] font-semibold uppercase tracking-wider">Payment Status</span>
                    <Zap className="h-4 w-4 text-[#b8722c]" />
                  </div>
                  <p className={`mt-2 inline-flex rounded-md px-2 py-0.5 text-xs font-bold ${paymentInfo?.badge ?? "text-[#3a1f0a] bg-[#7a4416]/20 border border-[#7a4416]/30"}`}>
                    {paymentInfo?.label ?? "--"}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="w-full flex flex-col sm:flex-row gap-3">
                {currentRide.status === "SEARCHING" && (
                  <>
                    <Button onClick={() => handleAcceptRide(currentRide._id)} className="w-full bg-gradient-to-br from-emerald-900 to-emerald-950 text-emerald-100 hover:opacity-90 border border-emerald-500/30 h-11 active:scale-[0.98] transition-all font-semibold">
                      <CheckCircle2 className="mr-2 h-4 w-4" /> Accept Ride Request
                    </Button>
                    <Button onClick={() => handleRejectRide(currentRide._id)} variant="outline" className="w-full border-rose-500/30 bg-rose-950/20 text-rose-900 hover:bg-rose-950/30 h-11 active:scale-[0.98] transition-all font-semibold">
                      <X className="mr-2 h-4 w-4" /> Decline
                    </Button>
                  </>
                )}
                {currentRide.status === "DRIVER_ASSIGNED" && (
                  <Button onClick={() => sendRideAction(DriverEvents.ARRIVED_AT_PICKUP, currentRide._id)} className="w-full bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffe9be] hover:opacity-90 border border-[#c58a3a]/40 h-11 active:scale-[0.98] transition-all font-semibold">
                    <MapPin className="mr-2 h-4 w-4" /> Arrived at Pickup Location
                  </Button>
                )}
                {currentRide.status === "DRIVER_ARRIVING" && (
                  <Button onClick={() => sendRideAction(DriverEvents.START_RIDE, currentRide._id)} className="w-full bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffe9be] hover:opacity-90 border border-[#c58a3a]/40 h-11 active:scale-[0.98] transition-all font-semibold">
                    <ChevronRight className="mr-2 h-4 w-4" /> Start Trip
                  </Button>
                )}
                {currentRide.status === "STARTED" && (
                  <Button onClick={() => sendRideAction(DriverEvents.ARRIVED_AT_DESTINATION, currentRide._id)} className="w-full bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffe9be] hover:opacity-90 border border-[#c58a3a]/40 h-11 active:scale-[0.98] transition-all font-semibold">
                    <MapPin className="mr-2 h-4 w-4" /> Arrived at Destination
                  </Button>
                )}
                {currentRide.status === "ARRIVED_AT_DESTINATION" && (
                  <Button
                    onClick={() => sendRideAction(DriverEvents.COMPLETE_RIDE, currentRide._id)}
                    disabled={!canCompleteCurrentRide}
                    className="w-full bg-gradient-to-br from-emerald-900 to-emerald-950 text-emerald-100 hover:opacity-90 border border-emerald-500/30 h-11 active:scale-[0.98] transition-all font-semibold"
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" /> Complete Trip & Confirm
                  </Button>
                )}
                {["DRIVER_ASSIGNED", "DRIVER_ARRIVING"].includes(currentRide.status) && (
                  <Button onClick={() => handleCancelRide(currentRide._id)} variant="outline" className="w-full border-rose-500/30 bg-rose-950/20 text-rose-900 hover:bg-rose-950/30 h-11 active:scale-[0.98] transition-all font-semibold">
                    <X className="mr-2 h-4 w-4" /> Cancel Ride
                  </Button>
                )}
              </div>

              {/* Detailed Fare Breakdown */}
              {fareBreakdownData && (
                <div className="w-full rounded-2xl border border-[#7a4416]/25 bg-[#fffaf0]/90 p-5 shadow-sm">
                  <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-[#7a4416]">Detailed fare breakdown</p>
                  <div className="w-full grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-sm">
                    {[
                      ["Base", fareBreakdownData.baseFarePaise],
                      ["Distance", fareBreakdownData.distanceFarePaise],
                      ["Time", fareBreakdownData.timeFarePaise],
                      ["Surge", fareBreakdownData.surgePaise],
                      ["Commission", -fareBreakdownData.platformCommissionPaise],
                      ["You Earn", fareBreakdownData.driverEarningPaise],
                      ["Total", fareBreakdownData.totalPaise],
                    ].map(([k, v]) => (
                      <div key={k as string} className="flex flex-col">
                        <span className="text-[10px] uppercase font-medium text-[#7a4416]/80">{k}</span>
                        <span className={`font-bold tabular-nums font-mono ${k === "You Earn" ? "text-emerald-900 font-black" : "text-[#2e1808]"}`}>
                          {formatPaise(Number(v))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {currentRide.status === "CANCELLED" && (
                <div className="w-full flex items-center justify-between rounded-2xl border border-rose-500/30 bg-rose-950/20 p-4 text-sm text-rose-900">
                  <span className="font-medium">
                    Trip cancelled{currentRide.cancelledBy ? ` by ${currentRide.cancelledBy.toLowerCase()}` : ""}.
                  </span>
                  <Button variant="outline" size="sm" onClick={() => setCurrentRide(null)} className="border-[#7a4416]/30 bg-[#fffaf0] text-[#3a1f0a] hover:bg-[#fff4dc] active:scale-[0.98]">
                    Back to searching
                  </Button>
                </div>
              )}

              {currentRide.status === "COMPLETED" && (
                <div className="w-full rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-6 text-center">
                  <p className="text-xs font-bold uppercase tracking-widest text-emerald-900">Trip successfully completed</p>
                  <p className="mt-1 text-2xl font-black text-emerald-950 tabular-nums font-mono">
                    {fareBreakdownData
                      ? formatPaise(fareBreakdownData.driverEarningPaise)
                      : fare != null
                        ? formatPaise(fare)
                        : "₹0.00"}
                  </p>
                  <p className="mt-1 text-xs text-emerald-900/80">Earnings successfully deposited into your driver wallet.</p>
                  <Button variant="outline" size="sm" onClick={() => setCurrentRide(null)} className="mt-4 border-emerald-500/30 bg-[#fffaf0] text-emerald-950 hover:bg-emerald-50 active:scale-[0.98]">
                    Return to dispatch radar
                  </Button>
                </div>
              )}
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-8 bottom-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
        </section>

        {/* Interactive Live Map Section — FULL WIDTH */}
        <section className="w-full overflow-hidden rounded-[2.5rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 shadow-xl backdrop-blur-2xl relative">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
          <div className="w-full flex items-center justify-between border-b border-[#7a4416]/20 px-6 py-5">
            <div>
              <h2 className="text-lg font-bold text-[#2e1808]" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>Live navigation map</h2>
              <p className="text-xs font-medium text-[#7a4416]">Real-time telemetry and route tracking.</p>
            </div>
            {driverLocation && (
              <span className="rounded-full border border-[#7a4416]/25 bg-[#fffaf0] px-3.5 py-1 text-xs font-mono text-[#3a1f0a] tabular-nums shadow-sm">
                {driverLocation.latitude.toFixed(4)}, {driverLocation.longitude.toFixed(4)}
              </span>
            )}
          </div>
          <div className="h-[350px] w-full sm:h-[450px] lg:h-[520px]">
            <MapView center={mapCenter} zoom={13} markers={mapMarkers} path={
              currentRide && routePolyline?.rideId === currentRide._id
                ? routePolyline.points
                : []
            } />
          </div>
          <div className="pointer-events-none absolute inset-x-8 bottom-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
        </section>

        {/* Quick Shortcut Hub — FULL WIDTH */}
        <section className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Ride History", icon: History },
            { label: "Earnings Wallet", icon: Wallet },
            { label: "Vehicle Specs", icon: Car },
            { label: "Account Settings", icon: Settings },
          ].map((action) => (
            <button
              key={action.label}
              className="w-full flex items-center justify-between rounded-2xl border border-[#7a4416]/30 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-5 text-sm font-semibold text-[#2e1808] shadow-lg transition-all duration-200 hover:border-[#b8722c] active:scale-[0.98] backdrop-blur-xl"
            >
              <span className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#3a1f0a] text-[#ffd88a] shadow-sm">
                  <action.icon className="h-4 w-4" />
                </span>
                {action.label}
              </span>
              <ChevronRight className="h-4 w-4 text-[#b8722c]" />
            </button>
          ))}
        </section>

        {/* Vehicle Information Grid — FULL WIDTH */}
        <section className="w-full grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: "Vehicle Category", value: VEHICLE_TYPE_LABEL[profile?.vehicle?.type || "CAR"] || "Car", icon: VehicleIcon },
            { label: "Make & Model", value: `${profile?.vehicle?.brand || "Toyota"} ${profile?.vehicle?.model || "Prius"}`, icon: Car },
            { label: "Registration No.", value: profile?.vehicle?.registrationNumber || "MH-02-UF-2026", icon: FileText },
          ].map((item) => (
            <div key={item.label} className="w-full rounded-[2rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-6 shadow-xl backdrop-blur-xl">
              <div className="flex items-center gap-2.5 text-[#7a4416]">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#3a1f0a] text-[#ffd88a] shadow-sm">
                  <item.icon className="h-4 w-4" />
                </span>
                <p className="text-xs uppercase tracking-wider font-bold">{item.label}</p>
              </div>
              <p className="mt-3 text-base font-bold text-[#2e1808]" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>{item.value}</p>
            </div>
          ))}
        </section>

        {/* Compliance & Document Verification Status — FULL WIDTH */}
        <section className="w-full grid grid-cols-1 sm:grid-cols-3 gap-4 pb-8">
          {[
            {
              title: "Driving License",
              number: profile?.documents?.drivingLicense?.number || "DL-9876543210",
              expiry: profile?.documents?.drivingLicense?.expiryDate || new Date(Date.now() + 365*24*3600*1000).toISOString(),
              verified: profile?.documents?.drivingLicense?.verified ?? true,
            },
            {
              title: "Vehicle Insurance",
              number: profile?.documents?.insurance?.number || "INS-123456",
              expiry: profile?.documents?.insurance?.expiryDate || new Date(Date.now() + 365*24*3600*1000).toISOString(),
              verified: profile?.documents?.insurance?.verified ?? true,
            },
            {
              title: "Pollution Certificate",
              number: "Active Compliance",
              expiry: profile?.documents?.pollutionCertificate?.expiryDate || new Date(Date.now() + 180*24*3600*1000).toISOString(),
              verified: true,
            },
          ].map((doc) => {
            const expiryDate = new Date(doc.expiry);
            const daysLeft = Math.round((expiryDate.getTime() - currentTime) / (1000 * 60 * 60 * 24));
            const expiringSoon = daysLeft < 30;
            return (
              <div key={doc.title} className="w-full rounded-[2rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-6 shadow-xl backdrop-blur-xl">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-[#7a4416]">{doc.title}</h3>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${
                      doc.verified
                        ? "bg-emerald-950/20 text-emerald-900 border-emerald-500/30"
                        : "bg-amber-950/20 text-amber-900 border-amber-500/30"
                    }`}
                  >
                    <Shield className="h-3 w-3" />
                    {doc.verified ? "Verified" : "Pending"}
                  </span>
                </div>
                <p className="mt-3 text-sm font-bold text-[#2e1808]">{doc.number}</p>
                <p className={`mt-1 text-xs console-readout font-medium tabular-nums ${expiringSoon ? "text-rose-700 font-semibold" : "text-[#6b3a12]"}`}>
                  Expires {expiryDate.toLocaleDateString()}
                  {expiringSoon && daysLeft >= 0 ? ` • ${daysLeft} days left` : ""}
                  {daysLeft < 0 ? " • Expired" : ""}
                </p>
              </div>
            );
          })}
        </section>
    </div>
    </div>
  );
}