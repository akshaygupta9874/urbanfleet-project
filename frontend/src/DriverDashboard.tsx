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
  ShieldCheck,
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
  Eye,
  Copy,
  Check,
  Camera,
  Calendar,
  Palette,
} from "lucide-react";
import LoadingScreen from "./components/LoadingScreen";
import MapView from "./components/MapView";
import { Button } from "./components/ui/button";
import { appApi } from "./lib/api";
import { connectDriverSocket, sendDriverLocation } from "./lib/socket";
import { fetchDriverProfile, isDriverApproved } from "./lib/driverApi";
import DriverCTA from "./components/DriverCTA";
import DriverWalletModal from "./components/DriverWalletModal";
import { useAuthContext } from "./context/auth-context";
import { getGeoapifyRouteLines, isGeoapifyFeatureCollection } from "./types/geoapify";
import CityMapBackground from "./components/CityMapBackground";
import { type PaymentStatus } from "./lib/payment";
import type { Coordinates } from "./types/location";
import type { RiderLocationPayload, RideDto, RideStatus } from "./types/ride";

// --- Types mirrored from backend models (Driver / Ride) ---
type VehicleType = "CAR" | "BIKE" | "AUTO";

export type Ride = RideDto;

interface DriverProfileData {
  id: string;
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
  verificationStatus: "PENDING" | "UNDER_REVIEW" | "VERIFIED" | "APPROVED" | "REJECTED" | "SUSPENDED";
  isVerified: boolean;
  rating: { average: number; totalRatings: number };
  statistics: {
    totalTrips: number;
    completedTrips: number;
    cancelledTrips: number;
    totalDistance: number;
    totalEarnings: number;
  };
  totalTrips?: number;
  completedTrips?: number;
  averageRating?: number;
  totalEarningsPaise?: number;
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
  RIDE_REJECTED: "server:ride-rejected",
  DRIVER_STATUS: "server:driver-status",
  DRIVER_ARRIVED: "server:driver-arrived",
  RIDER_LOCATION: "server:rider-location",
  RIDE_NO_DRIVERS_AVAILABLE: "server:ride-no-drivers-available",
  DRIVER_LOCATION: "server:driver-location",
  ARRIVED_AT_DESTINATION: "server:ride-arrived-at-destination",
  PAYMENT_CAPTURED: "server:payment-captured",
  RIDE_STARTED: "server:ride-started",
  RIDE_COMPLETED: "server:ride-completed",
  RIDE_CANCELLED: "server:ride-cancelled",
  ERROR: "server:error",
} as const;

type DriverStatus = "OFFLINE" | "ONLINE" | "AVAILABLE" | "BUSY";

const BUSY_RIDE_STATUSES: RideStatus[] = ["DRIVER_ASSIGNED", "DRIVER_ARRIVING", "RIDE_STARTED", "ARRIVED_AT_DESTINATION"];
const TERMINAL_RIDE_STATUSES: RideStatus[] = ["COMPLETED", "CANCELLED"];
const HEARTBEAT_INTERVAL_MS = 5000;

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
  RIDE_STARTED: {
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
  { key: "RIDE_STARTED", label: "In trip" },
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
  const { user, logout } = useAuthContext();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<DriverProfileData | null>(null);
  const [currentRide, setCurrentRide] = useState<Ride | null>(null);
  const [driverLocation, setDriverLocation] = useState<Coordinates | null>(null);
  const [riderLocation, setRiderLocation] = useState<Coordinates | null>(null);
  const [driverStatus, setDriverStatus] = useState<DriverStatus>("ONLINE");
  const [routePolyline, setRoutePolyline] = useState<{
    rideId: string;
    points: Array<{ lat: number; lng: number }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showEarningsFlash, setShowEarningsFlash] = useState<number | null>(null);
  const [currentTime] = useState(() => Date.now());
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);
  const [isWalletOpen, setIsWalletOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [tripOtp, setTripOtp] = useState("");
  const [isStartingRide, setIsStartingRide] = useState(false);
  const [isAcceptingRide, setIsAcceptingRide] = useState(false);

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
          appApi.get<{ success: boolean; data: Ride }>("/ride/driver/current").catch(() => null),
        ]);
        setProfile(profileResponse);
        if (rideResponse && rideResponse.data?.data) {
          const currentRideData = rideResponse.data.data;
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
            rideId: currentRide.id,
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
              setTripOtp("");
              setRiderLocation(null);
              setCurrentRide(data.ride);
            }
            break;
          case ServerEvents.RIDE_ACCEPTED:
            if (data?.ride) {
              setCurrentRide(data.ride);
              setIsAcceptingRide(false);
            }
            break;
          case ServerEvents.RIDE_REJECTED:
            if (data?.rideId === currentRideRef.current?.id) {
              setCurrentRide(null);
              setTripOtp("");
              setRiderLocation(null);
            }
            break;
          case ServerEvents.DRIVER_STATUS:
            if (["OFFLINE", "ONLINE", "AVAILABLE", "BUSY"].includes(data?.status)) {
              setDriverStatus(data.status);
            }
            break;
          case ServerEvents.RIDER_LOCATION: {
            const payload = data as RiderLocationPayload;
            if (
              payload?.rideId === currentRideRef.current?.id &&
              typeof payload.location?.latitude === "number" &&
              typeof payload.location?.longitude === "number"
            ) {
              setRiderLocation(payload.location);
            }
            break;
          }
          case ServerEvents.DRIVER_ARRIVED:
            if (data?.ride) setCurrentRide(data.ride);
            break;
          case ServerEvents.ARRIVED_AT_DESTINATION:
            if (data?.ride) setCurrentRide(data.ride);
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
            if (data?.ride) {
              setCurrentRide(data.ride);
              setTripOtp("");
              setIsStartingRide(false);
            }
            break;
          case ServerEvents.RIDE_COMPLETED: {
            setCurrentRide((prev) => {
              const updated = prev ? { ...prev, status: "COMPLETED" as RideStatus, ...data?.ride } : null;
              if (updated) {
                applyCompletedRideStats(updated);
                const earnedPaise =
                  updated.fare?.breakdown?.driverEarningPaise ??
                  0;
                if (earnedPaise > 0) {
                  setShowEarningsFlash(earnedPaise);
                  setTimeout(() => setShowEarningsFlash(null), 3200);
                }
              }
              return updated;
            });
            setRiderLocation(null);
            break;
          }
          case ServerEvents.RIDE_CANCELLED:
            if (data?.rideId !== currentRideRef.current?.id) break;
            setCurrentRide((prev) =>
              prev
                ? { ...prev, status: "CANCELLED", cancelledBy: data?.cancelledBy, cancellationReason: data?.reason }
                : prev,
            );
            setRiderLocation(null);
            break;
          case ServerEvents.ERROR:
            setError(data?.message || "Server error occurred.");
            setIsAcceptingRide(false);
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
      const coordinates = { latitude, longitude };
      setDriverLocation(coordinates);
      sendDriverLocation(socketRef.current, coordinates);
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
  }, [currentRideStatus, driverStatus, profile?.verificationStatus, profile]);

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
    setIsAcceptingRide(true);
    socketRef.current.send(JSON.stringify({
      event: DriverEvents.ACCEPT_RIDE,
      data: { rideId },
    }));
  };

  const handleStartRide = (rideId: string) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setError("Socket connection not ready.");
      return;
    }
    if (!/^\d{4}$/.test(tripOtp)) {
      setError("Enter the 4-digit passenger OTP before starting the trip.");
      return;
    }
    setError("");
    setIsStartingRide(true);
    socketRef.current.send(JSON.stringify({
      event: DriverEvents.START_RIDE,
      data: { rideId, otp: tripOtp },
    }));
  };

  const handleRejectRide = (rideId: string) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setError("Socket connection not ready.");
      return;
    }
    socketRef.current.send(JSON.stringify({ event: DriverEvents.REJECT_RIDE, data: { rideId } }));
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
  };

  const sendRideAction = (event: string, rideId: string, extraData = {}) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setError("Socket connection not ready.");
      return;
    }
    socketRef.current.send(JSON.stringify({ event, data: { rideId, ...extraData } }));
  };

  const acceptanceRate = useMemo(() => {
    if (!profile) return 0;
    const total = profile.statistics?.totalTrips ?? 1;
    const completed = profile.statistics?.completedTrips ?? 0;
    return Math.round((completed / (total || 1)) * 100);
  }, [profile]);

  if (loading) {
    return <LoadingScreen label="Loading driver dashboard" />;
  }

  const isApprovedDriver = isDriverApproved(profile);

  if (!profile || !isApprovedDriver) {
    return (
      <div className="relative flex min-h-screen w-full items-center justify-center bg-[#f5e6c8] p-6 font-sans text-[#2e1808] overflow-hidden">
        <CityMapBackground />
        <div className="relative z-10 w-full max-w-2xl">
          <DriverCTA driver={profile} loading={loading} />
          <div className="mt-4 text-center">
            <button
              onClick={() => navigate("/dashboard")}
              className="text-xs font-semibold text-[#6b3a12] underline hover:text-[#3a1f0a] transition-colors"
            >
              Return to Rider Dashboard
            </button>
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
    ...(riderLocation
      ? [{ position: { lat: riderLocation.latitude, lng: riderLocation.longitude }, label: "R", title: "Rider location" }]
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
    ? currentRide.fare.breakdown?.driverEarningPaise ?? currentRide.fare.estimated
    : null;
  const breakdownData = currentRide?.fare?.breakdown ?? null;

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
              <button onClick={() => navigate("/security-devices")} className="group relative grid h-10 w-10 place-items-center rounded-xl border border-[#7a4416]/25 bg-[#fffaf0] text-[#3a1f0a] shadow-sm hover:bg-[#fff4dc] active:scale-95 transition-all" aria-label="Security & Devices" title="Active Devices & Sessions"><ShieldCheck className="h-4 w-4 text-[#b8722c] transition-colors group-hover:text-[#3a1f0a]" /></button> 
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

        {/* Driver Profile Overview Card — Beautiful Display of Registration Data */}
        <section className="w-full rounded-[2.5rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-6 sm:p-8 shadow-xl backdrop-blur-2xl relative overflow-hidden">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="flex items-center gap-5">
              <div className="relative">
                {profile?.profilePhoto?.url ? (
                  <img
                    src={profile.profilePhoto.url}
                    alt="Driver Avatar"
                    className="h-20 w-20 sm:h-24 sm:w-24 rounded-3xl object-cover border-2 border-[#c58a3a] shadow-lg cursor-pointer hover:scale-105 transition-transform"
                    onClick={() => setPreviewImage({ url: profile.profilePhoto.url, title: "Driver Profile Photo" })}
                  />
                ) : (
                  <div className="h-20 w-20 sm:h-24 sm:w-24 rounded-3xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] flex items-center justify-center text-[#ffd88a] font-bold text-2xl border-2 border-[#c58a3a] shadow-lg">
                    {user?.firstName?.[0]?.toUpperCase() || "D"}
                  </div>
                )}
                <span className={`absolute -bottom-1 -right-1 h-5 w-5 rounded-full border-2 border-[#fffaf0] ${statusDotColor}`} />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-xl sm:text-2xl font-black text-[#2e1808]" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>
                    {user?.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : "Driver Partner"}
                  </h1>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-bold border shadow-xs ${
                      isApprovedDriver
                        ? "bg-emerald-950/20 text-emerald-900 border-emerald-500/30"
                        : profile?.verificationStatus === "REJECTED" || profile?.verificationStatus === "SUSPENDED"
                        ? "bg-rose-950/20 text-rose-900 border-rose-500/30"
                        : "bg-amber-950/20 text-amber-900 border-amber-500/30"
                    }`}
                  >
                    <Shield className="h-3.5 w-3.5" />
                    {isApprovedDriver
                      ? "Verified Partner"
                      : profile?.verificationStatus === "REJECTED"
                      ? "Verification Rejected"
                      : profile?.verificationStatus === "SUSPENDED"
                      ? "Verification Suspended"
                      : profile?.verificationStatus === "UNDER_REVIEW"
                      ? "Application Under Review"
                      : "Pending Verification"}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-xs text-[#7a4416] flex-wrap">
                  <span className="font-mono bg-[#3a1f0a]/10 px-2 py-0.5 rounded-md flex items-center gap-1.5">
                    ID: {profile?.id ? `${profile.id.slice(0, 8)}...${profile.id.slice(-4)}` : "UF-DRIVER"}
                    <button
                      onClick={() => {
                        if (profile?.id) {
                          navigator.clipboard.writeText(profile.id);
                          setCopiedId(true);
                          setTimeout(() => setCopiedId(false), 2000);
                        }
                      }}
                      className="hover:text-[#2e1808] transition-colors"
                      title="Copy full driver ID"
                    >
                      {copiedId ? <Check className="h-3 w-3 text-emerald-700" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1 font-semibold text-[#2e1808]">
                    <VehicleIcon className="h-3.5 w-3.5 text-[#b8722c]" />
                    {profile?.vehicle?.brand || "Toyota"} {profile?.vehicle?.model || "Innova"} ({profile?.vehicle?.registrationNumber || "KA-01-UF-1001"})
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4 bg-[#fffaf0]/80 border border-[#7a4416]/20 rounded-2xl px-5 py-3 shadow-xs">
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#7a4416]">Rating Score</p>
                <div className="flex items-center gap-1 mt-0.5 justify-end">
                  <Star className="h-4 w-4 fill-amber-500 text-amber-500" />
                  <span className="text-lg font-black text-[#2e1808] font-mono">
                    {Number(profile?.rating?.average ?? 5.0).toFixed(1)}
                  </span>
                </div>
              </div>
              <div className="h-8 w-px bg-[#7a4416]/20" />
              <div className="text-left">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#7a4416]">Total Ratings</p>
                <p className="text-lg font-black text-[#2e1808] font-mono mt-0.5">
                  {profile?.rating?.totalRatings ?? 0}
                </p>
              </div>
            </div>
          </div>
        </section>

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
          <StatCard label="Total Trips" value={String(profile?.statistics?.totalTrips ?? 0)} icon={RouteIcon} trend="+4% this week" />
          <StatCard label="Driver Rating" value={Number(profile?.rating?.average ?? 5).toFixed(1)} icon={Star} />
          <StatCard label="Total Earnings" value={formatPaise(profile?.statistics?.totalEarnings ?? 0)} icon={Wallet} trend="Verified" />
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
                  <div className="w-full flex flex-col gap-3 sm:flex-row">
                    <Button
                      onClick={() => handleAcceptRide(currentRide.id)}
                      disabled={isAcceptingRide}
                      className="w-full bg-gradient-to-br from-emerald-900 to-emerald-950 text-emerald-100 hover:opacity-90 border border-emerald-500/30 h-11 active:scale-[0.98] transition-all font-semibold"
                    >
                      {isAcceptingRide ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                      {isAcceptingRide ? "Accepting..." : "Accept Ride"}
                    </Button>
                    <Button onClick={() => handleRejectRide(currentRide.id)} variant="outline" className="w-full border-rose-500/30 bg-rose-950/20 text-rose-900 hover:bg-rose-950/30 h-11 active:scale-[0.98] transition-all font-semibold">
                      <X className="mr-2 h-4 w-4" /> Decline
                    </Button>
                  </div>
                )}
                {currentRide.status === "DRIVER_ASSIGNED" && (
                  <Button onClick={() => sendRideAction(DriverEvents.ARRIVED_AT_PICKUP, currentRide.id)} className="w-full bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffe9be] hover:opacity-90 border border-[#c58a3a]/40 h-11 active:scale-[0.98] transition-all font-semibold">
                    <MapPin className="mr-2 h-4 w-4" /> Arrived at Pickup Location
                  </Button>
                )}
                {currentRide.status === "DRIVER_ARRIVING" && (
                  <div className="w-full space-y-3">
                    <label className="block space-y-1.5">
                      <span className="text-xs font-semibold text-[#3a1f0a]">Enter Passenger's 4-Digit OTP to Start Trip</span>
                      <input
                        aria-label="Trip start OTP"
                        autoComplete="one-time-code"
                        className="h-11 w-full rounded-xl border border-[#7a4416]/30 bg-[#fffaf0] px-4 text-center font-mono text-lg font-bold tracking-[0.4em] text-[#2e1808] outline-none focus:border-[#b8722c] focus:ring-2 focus:ring-[#b8722c]/20"
                        inputMode="numeric"
                        maxLength={4}
                        onChange={(event) => setTripOtp(event.target.value.replace(/\D/gu, "").slice(0, 4))}
                        placeholder="4-digit OTP"
                        value={tripOtp}
                      />
                    </label>
                    <Button
                      onClick={() => handleStartRide(currentRide.id)}
                      disabled={tripOtp.length !== 4 || isStartingRide}
                      className="w-full bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffe9be] hover:opacity-90 border border-[#c58a3a]/40 h-11 active:scale-[0.98] transition-all font-semibold"
                    >
                      {isStartingRide ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ChevronRight className="mr-2 h-4 w-4" />}
                      {isStartingRide ? "Verifying PIN..." : "Verify & Start Trip"}
                    </Button>
                  </div>
                )}
                {currentRide.status === "RIDE_STARTED" && (
                  <Button onClick={() => sendRideAction(DriverEvents.ARRIVED_AT_DESTINATION, currentRide.id)} className="w-full bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffe9be] hover:opacity-90 border border-[#c58a3a]/40 h-11 active:scale-[0.98] transition-all font-semibold">
                    <MapPin className="mr-2 h-4 w-4" /> Arrived at Destination
                  </Button>
                )}
                {currentRide.status === "ARRIVED_AT_DESTINATION" && (
                  <Button
                    onClick={() => sendRideAction(DriverEvents.COMPLETE_RIDE, currentRide.id)}
                    disabled={!canCompleteCurrentRide}
                    className="w-full bg-gradient-to-br from-emerald-900 to-emerald-950 text-emerald-100 hover:opacity-90 border border-emerald-500/30 h-11 active:scale-[0.98] transition-all font-semibold"
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" /> Complete Trip & Confirm
                  </Button>
                )}
                {["DRIVER_ASSIGNED", "DRIVER_ARRIVING"].includes(currentRide.status) && (
                  <Button onClick={() => handleCancelRide(currentRide.id)} variant="outline" className="w-full border-rose-500/30 bg-rose-950/20 text-rose-900 hover:bg-rose-950/30 h-11 active:scale-[0.98] transition-all font-semibold">
                    <X className="mr-2 h-4 w-4" /> Cancel Ride
                  </Button>
                )}
              </div>

              {/* Detailed Fare Breakdown */}
              {breakdownData && (
                <div className="w-full rounded-2xl border border-[#7a4416]/25 bg-[#fffaf0]/90 p-5 shadow-sm">
                  <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-[#7a4416]">Detailed fare breakdown</p>
                  <div className="w-full grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-sm">
                    {[
                      ["Base", breakdownData.baseFarePaise],
                      ["Distance", breakdownData.distanceFarePaise],
                      ["Time", breakdownData.timeFarePaise],
                      ["Surge", breakdownData.surgePaise],
                      ["Commission", -breakdownData.platformCommissionPaise],
                      ["You Earn", breakdownData.driverEarningPaise],
                      ["Total", breakdownData.totalPaise],
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
                    {breakdownData
                      ? formatPaise(breakdownData.driverEarningPaise)
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
              currentRide && routePolyline?.rideId === currentRide.id
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

        {/* Extended Vehicle Specifications — FULL WIDTH */}
        <section className="w-full rounded-[2.5rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-6 sm:p-8 shadow-xl backdrop-blur-2xl relative">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#7a4416]/20 pb-4 mb-6">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#3a1f0a] text-[#ffd88a] shadow-sm">
                  <VehicleIcon className="h-4 w-4" />
                </span>
                <h2 className="text-lg font-bold text-[#2e1808]" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>
                  Vehicle Specifications & Fleet Identity
                </h2>
              </div>
              <p className="text-xs text-[#7a4416] mt-1">Verified vehicle metadata registered for commercial dispatch</p>
            </div>
            <span className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-full border border-emerald-500/30 bg-emerald-950/20 px-3 py-1 text-xs font-bold text-emerald-900 shadow-sm">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
              RTO & Fleet Approved
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              {
                label: "Category",
                value: VEHICLE_TYPE_LABEL[profile?.vehicle?.type || "CAR"] || "Car",
                icon: VehicleIcon,
                sub: "Commercial Class",
                mono: false,
              },
              {
                label: "Make & Model",
                value: `${profile?.vehicle?.brand || "Toyota"} ${profile?.vehicle?.model || "Innova Crysta"}`,
                icon: Car,
                sub: "Fleet Specification",
                mono: false,
              },
              {
                label: "Registration No.",
                value: profile?.vehicle?.registrationNumber || "MH-02-UF-2026",
                icon: FileText,
                sub: "State RTO Registered",
                mono: true,
              },
              {
                label: "Vehicle Color",
                value: profile?.vehicle?.color || "Pearl White",
                icon: Palette,
                sub: "Exterior Finish",
                mono: false,
              },
              {
                label: "Model Year",
                value: String(profile?.vehicle?.registrationYear || 2024),
                icon: Calendar,
                sub: "Manufacturing Year",
                mono: false,
              },
            ].map((spec) => (
              <div
                key={spec.label}
                className="rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/80 p-4 shadow-sm hover:border-[#b8722c]/60 transition-all"
              >
                <div className="flex items-center justify-between text-[#7a4416] mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider">{spec.label}</span>
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#3a1f0a] text-[#ffd88a]">
                    <spec.icon className="h-3.5 w-3.5" />
                  </span>
                </div>
                <p className={`text-base font-bold text-[#2e1808] ${spec.mono ? "font-mono tracking-tight" : ""}`} style={{ fontFamily: spec.mono ? undefined : "'Fraunces', Georgia, serif" }}>
                  {spec.value}
                </p>
                <p className="text-[10px] text-[#7a4416]/80 mt-1">{spec.sub}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Vehicle 5-Perspective Photo Gallery — FULL WIDTH */}
        <section className="w-full rounded-[2.5rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-6 sm:p-8 shadow-xl backdrop-blur-2xl relative">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#7a4416]/20 pb-4 mb-6">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#3a1f0a] text-[#ffd88a] shadow-sm">
                  <Camera className="h-4 w-4" />
                </span>
                <h2 className="text-lg font-bold text-[#2e1808]" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>
                  Vehicle Inspection Gallery (5 Angles)
                </h2>
              </div>
              <p className="text-xs text-[#7a4416] mt-1">
                Visual safety inspection photographs registered with fleet operations
              </p>
            </div>
            <span className="text-xs font-semibold text-[#7a4416]">Click any view to inspect high-resolution</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {[
              {
                key: "front",
                label: "Front Elevation",
                url: profile?.vehicleImages?.front,
                desc: "Full front grill & headlights",
              },
              {
                key: "back",
                label: "Rear & Number Plate",
                url: profile?.vehicleImages?.back,
                desc: "Rear bumper & license plate",
              },
              {
                key: "left",
                label: "Left Flank",
                url: profile?.vehicleImages?.left,
                desc: "Full driver-side profile",
              },
              {
                key: "right",
                label: "Right Flank",
                url: profile?.vehicleImages?.right,
                desc: "Full passenger-side profile",
              },
              {
                key: "interior",
                label: "Interior Cabin",
                url: profile?.vehicleImages?.interior,
                desc: "Dashboard, seats & cockpit",
              },
            ].map((imgItem) => (
              <div
                key={imgItem.key}
                onClick={() => {
                  if (imgItem.url) {
                    setPreviewImage({ url: imgItem.url, title: `Vehicle ${imgItem.label}` });
                  }
                }}
                className={`group relative flex flex-col overflow-hidden rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0] p-3 shadow-sm transition-all duration-200 hover:shadow-md hover:border-[#b8722c] ${
                  imgItem.url ? "cursor-pointer" : "opacity-75"
                }`}
              >
                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-[#2e1808]/5 border border-[#7a4416]/10 flex items-center justify-center">
                  {imgItem.url ? (
                    <img
                      src={imgItem.url}
                      alt={imgItem.label}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-[#7a4416]/50">
                      <Camera className="h-6 w-6 mb-1" />
                      <span className="text-[10px]">No photo</span>
                    </div>
                  )}
                  {imgItem.url && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                      <span className="flex items-center gap-1 rounded-full bg-[#3a1f0a]/90 px-3 py-1 text-xs font-semibold text-[#ffd88a] shadow-lg backdrop-blur-sm">
                        <Eye className="h-3.5 w-3.5" /> Preview
                      </span>
                    </div>
                  )}
                </div>
                <div className="mt-2.5">
                  <p className="text-xs font-bold text-[#2e1808] truncate">{imgItem.label}</p>
                  <p className="text-[10px] text-[#7a4416]/80 truncate">{imgItem.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Compliance & Document Verification Status — FULL WIDTH */}
        <section className="w-full rounded-[2.5rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-6 sm:p-8 shadow-xl backdrop-blur-2xl relative pb-8">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#7a4416]/20 pb-4 mb-6">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#3a1f0a] text-[#ffd88a] shadow-sm">
                  <Shield className="h-4 w-4" />
                </span>
                <h2 className="text-lg font-bold text-[#2e1808]" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>
                  Regulatory Compliance & Verified Credentials
                </h2>
              </div>
              <p className="text-xs text-[#7a4416] mt-1">Official state transport compliance, certificates and policy records</p>
            </div>
            <span className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-full border border-[#7a4416]/30 bg-[#fffaf0] px-3 py-1 text-xs font-bold text-[#2e1808] shadow-sm">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
              4/4 Required Documents Valid
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Driving License */}
            {(() => {
              const dl = profile?.documents?.drivingLicense;
              const dlExpiry = dl?.expiryDate ? new Date(dl.expiryDate) : new Date(currentTime + 365 * 24 * 3600 * 1000);
              const daysLeft = Math.round((dlExpiry.getTime() - currentTime) / (1000 * 60 * 60 * 24));
              const expiringSoon = daysLeft < 30;
              return (
                <div className="flex flex-col justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/90 p-5 shadow-sm hover:border-[#b8722c]/60 transition-all">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#7a4416]">Driving License</span>
                      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold border bg-emerald-950/20 text-emerald-900 border-emerald-500/30">
                        <Shield className="h-3 w-3" />
                        {dl?.verified ?? true ? "Verified" : "Pending"}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-bold font-mono text-[#2e1808]">{dl?.number || "DL-9876543210"}</p>
                    <p className={`mt-1 text-xs console-readout font-medium tabular-nums ${expiringSoon ? "text-rose-700 font-semibold" : "text-[#6b3a12]"}`}>
                      Expires {dlExpiry.toLocaleDateString()}
                      {expiringSoon && daysLeft >= 0 ? ` • ${daysLeft}d left` : ""}
                    </p>
                  </div>
                  <div className="mt-4 flex gap-2">
                    {dl?.frontImage && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPreviewImage({ url: dl.frontImage, title: "Driving License (Front Side)" })}
                        className="flex-1 text-[11px] h-8 border-[#7a4416]/30 bg-[#fffaf0] hover:bg-[#fff4dc] text-[#2e1808]"
                      >
                        <Eye className="mr-1 h-3 w-3 text-[#b8722c]" /> Front
                      </Button>
                    )}
                    {dl?.backImage && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPreviewImage({ url: dl.backImage, title: "Driving License (Back Side)" })}
                        className="flex-1 text-[11px] h-8 border-[#7a4416]/30 bg-[#fffaf0] hover:bg-[#fff4dc] text-[#2e1808]"
                      >
                        <Eye className="mr-1 h-3 w-3 text-[#b8722c]" /> Back
                      </Button>
                    )}
                    {!dl?.frontImage && !dl?.backImage && (
                      <span className="text-[10px] text-[#7a4416]/70">Digital copy on file</span>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* 2. Registration Certificate (RC) */}
            {(() => {
              const rc = profile?.documents?.registrationCertificate;
              return (
                <div className="flex flex-col justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/90 p-5 shadow-sm hover:border-[#b8722c]/60 transition-all">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#7a4416]">RC Smart Card</span>
                      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold border bg-emerald-950/20 text-emerald-900 border-emerald-500/30">
                        <Shield className="h-3 w-3" />
                        {rc?.verified ?? true ? "Verified" : "Pending"}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-bold font-mono text-[#2e1808]">{rc?.number || profile?.vehicle?.registrationNumber || "MH-02-UF-2026"}</p>
                    <p className="mt-1 text-xs console-readout font-medium text-[#6b3a12]">
                      State Transport Dept • Lifetime
                    </p>
                  </div>
                  <div className="mt-4">
                    {rc?.image ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPreviewImage({ url: rc.image, title: "Registration Certificate (RC)" })}
                        className="w-full text-[11px] h-8 border-[#7a4416]/30 bg-[#fffaf0] hover:bg-[#fff4dc] text-[#2e1808]"
                      >
                        <Eye className="mr-1 h-3 w-3 text-[#b8722c]" /> View RC Smart Card
                      </Button>
                    ) : (
                      <span className="text-[10px] text-[#7a4416]/70">Digital copy on file</span>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* 3. Insurance Policy */}
            {(() => {
              const ins = profile?.documents?.insurance;
              const insExpiry = ins?.expiryDate ? new Date(ins.expiryDate) : new Date(currentTime + 365 * 24 * 3600 * 1000);
              const daysLeft = Math.round((insExpiry.getTime() - currentTime) / (1000 * 60 * 60 * 24));
              const expiringSoon = daysLeft < 30;
              return (
                <div className="flex flex-col justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/90 p-5 shadow-sm hover:border-[#b8722c]/60 transition-all">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#7a4416]">Commercial Insurance</span>
                      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold border bg-emerald-950/20 text-emerald-900 border-emerald-500/30">
                        <Shield className="h-3 w-3" />
                        {ins?.verified ?? true ? "Active" : "Pending"}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-bold font-mono text-[#2e1808]">{ins?.number || "INS-9823410"}</p>
                    <p className={`mt-1 text-xs console-readout font-medium tabular-nums ${expiringSoon ? "text-rose-700 font-semibold" : "text-[#6b3a12]"}`}>
                      Expires {insExpiry.toLocaleDateString()}
                      {expiringSoon && daysLeft >= 0 ? ` • ${daysLeft}d left` : ""}
                    </p>
                  </div>
                  <div className="mt-4">
                    {ins?.image ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPreviewImage({ url: ins.image, title: "Insurance Policy Certificate" })}
                        className="w-full text-[11px] h-8 border-[#7a4416]/30 bg-[#fffaf0] hover:bg-[#fff4dc] text-[#2e1808]"
                      >
                        <Eye className="mr-1 h-3 w-3 text-[#b8722c]" /> View Policy Certificate
                      </Button>
                    ) : (
                      <span className="text-[10px] text-[#7a4416]/70">Digital copy on file</span>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* 4. Pollution Under Control (PUC) */}
            {(() => {
              const puc = profile?.documents?.pollutionCertificate;
              const pucExpiry = puc?.expiryDate ? new Date(puc.expiryDate) : new Date(currentTime + 180 * 24 * 3600 * 1000);
              const daysLeft = Math.round((pucExpiry.getTime() - currentTime) / (1000 * 60 * 60 * 24));
              const expiringSoon = daysLeft < 30;
              return (
                <div className="flex flex-col justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/90 p-5 shadow-sm hover:border-[#b8722c]/60 transition-all">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#7a4416]">Pollution (PUC)</span>
                      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold border bg-emerald-950/20 text-emerald-900 border-emerald-500/30">
                        <CheckCircle2 className="h-3 w-3" />
                        Compliant
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-bold font-mono text-[#2e1808]">PUC-GREEN-EMISSION</p>
                    <p className={`mt-1 text-xs console-readout font-medium tabular-nums ${expiringSoon ? "text-rose-700 font-semibold" : "text-[#6b3a12]"}`}>
                      Valid until {pucExpiry.toLocaleDateString()}
                      {expiringSoon && daysLeft >= 0 ? ` • ${daysLeft}d left` : ""}
                    </p>
                  </div>
                  <div className="mt-4">
                    {puc?.image ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPreviewImage({ url: puc.image, title: "Pollution Under Control (PUC) Certificate" })}
                        className="w-full text-[11px] h-8 border-[#7a4416]/30 bg-[#fffaf0] hover:bg-[#fff4dc] text-[#2e1808]"
                      >
                        <Eye className="mr-1 h-3 w-3 text-[#b8722c]" /> View PUC Certificate
                      </Button>
                    ) : (
                      <span className="text-[10px] text-[#7a4416]/70">Digital copy on file</span>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </section>

        {/* High-Resolution Document & Photo Lightbox Modal */}
        {previewImage && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200"
            onClick={() => setPreviewImage(null)}
          >
            <div
              className="relative max-w-3xl w-full rounded-3xl border border-[#fff4dc]/40 bg-gradient-to-b from-[#2e1808] to-[#1a0c04] p-6 shadow-2xl text-white overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-[#7a4416]/40 pb-4 mb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#ffd88a] text-[#3a1f0a] font-bold">
                    <Eye className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-[#ffd88a]" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>
                      {previewImage.title}
                    </h3>
                    <p className="text-xs text-[#ffd88a]/70">Official driver registration document preview</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewImage(null)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="relative flex items-center justify-center max-h-[70vh] overflow-hidden rounded-2xl bg-black/40 border border-white/10 p-2">
                <img
                  src={previewImage.url}
                  alt={previewImage.title}
                  className="max-h-[65vh] w-auto max-w-full rounded-xl object-contain shadow-lg"
                />
              </div>
            </div>
          </div>
        )}
    </div>
      {/* Driver Wallet Modal */}
      <DriverWalletModal
        isOpen={isWalletOpen}
        onClose={() => setIsWalletOpen(false)}
      />
    </div>
  );
}