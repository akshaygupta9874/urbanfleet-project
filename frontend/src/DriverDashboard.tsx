import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence, type Variants } from "framer-motion";
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
  Route as RouteIcon,
  MapPin,
  CheckCircle2,
  Power,
  History,
  LogOut,
  AlertTriangle,
  Eye,
  Copy,
  Check,
  Camera,
  Calendar,
  Award,
  MessageSquare,
  Laptop,
  Smartphone,
  Tablet,
  Trash2,
  RefreshCw,
  Sparkles,
  Building2,
  Radio,
  Compass,
} from "lucide-react";
import LoadingScreen from "./components/LoadingScreen";
import MapView from "./components/MapView";
import { Button } from "./components/ui/button";
import { appApi } from "./lib/api";
import { connectDriverSocket, sendDriverLocation } from "./lib/socket";
import {
  fetchDriverProfile,
  fetchDriverRideHistory,
  fetchDriverRideMetrics,
  fetchDriverRatings,
  isDriverApproved,
  type DriverRideItem,
  type DriverRideMetrics,
  type DriverRatingsSummary,
  type DriverReviewItem,
} from "./lib/driverApi";
import { sessionApi, type DeviceSession } from "./lib/sessionApi";
import DriverCTA from "./components/DriverCTA";
import DriverWalletModal, { type DriverBalance } from "./components/DriverWalletModal";
import DriverBankDetailsModal from "./components/DriverBankDetailsModal";
import { useAuthContext } from "./context/auth-context";
import { getGeoapifyRouteLines, isGeoapifyFeatureCollection } from "./types/geoapify";
import CityMapBackground from "./components/CityMapBackground";
import { formatFare, formatDistance, formatDuration, getDistanceKm, calculateHaversineDistanceKm } from "./lib/formatters";
import { type PaymentStatus } from "./lib/payment";
import type { Coordinates } from "./types/location";
import type { RiderLocationPayload, RideDto, RideStatus } from "./types/ride";

// --- Types mirrored from backend models (Driver / Ride) ---
type VehicleType = "CAR" | "BIKE" | "AUTO";

export type Ride = RideDto;

type DashboardTab = "console" | "history" | "ratings" | "vehicle" | "sessions";

interface DriverProfileData {
  id: string;
  isAvailable?: boolean;
  isOnline?: boolean;
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
    drivingLicense: {
      number: string;
      expiryDate: string;
      frontImage: string;
      backImage: string;
      verified: boolean;
    };
    registrationCertificate: { number: string; image: string; verified: boolean };
    insurance: { number: string; expiryDate: string; image: string; verified: boolean };
    pollutionCertificate: { expiryDate: string; image: string };
  };
  verificationStatus:
    | "PENDING"
    | "UNDER_REVIEW"
    | "VERIFIED"
    | "APPROVED"
    | "REJECTED"
    | "SUSPENDED";
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
  accountHolderName?: string;
  accountNumber?: string;
  ifscCode?: string;
  bankName?: string;
  upiId?: string;
  passbookPhoto?: { url: string; publicId: string } | null;
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

const BUSY_RIDE_STATUSES: RideStatus[] = [
  "DRIVER_ASSIGNED",
  "DRIVER_ARRIVING",
  "RIDE_STARTED",
  "ARRIVED_AT_DESTINATION",
];
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
    label: "Incoming Dispatch",
    badge:
      "bg-amber-950/90 text-amber-200 border border-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.25)]",
    description: "New passenger request matched to your coordinates.",
    step: 0,
  },
  DRIVER_ASSIGNED: {
    label: "En Route to Pickup",
    badge: "bg-[#3a1f0a]/90 text-[#ffd88a] border border-[#c58a3a]/50",
    description: "Navigate to the passenger pickup location.",
    step: 1,
  },
  DRIVER_ARRIVING: {
    label: "At Pickup • Verify PIN",
    badge: "bg-[#3a1f0a]/90 text-[#ffd88a] border border-[#c58a3a]/50",
    description: "Enter the passenger's 4-digit PIN to start the trip.",
    step: 2,
  },
  RIDE_STARTED: {
    label: "In Transit",
    badge:
      "bg-emerald-950/90 text-emerald-200 border border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.2)]",
    description: "En route to destination drop-off.",
    step: 3,
  },
  ARRIVED_AT_DESTINATION: {
    label: "At Destination",
    badge: "bg-[#3a1f0a]/95 text-[#ffe9be] border border-[#c58a3a]/60",
    description: "Awaiting final payment settlement to close trip.",
    step: 4,
  },
  COMPLETED: {
    label: "Trip Settled",
    badge: "bg-emerald-950/90 text-emerald-200 border border-emerald-500/40",
    description: "This trip has been settled and logged.",
    step: 5,
  },
  CANCELLED: {
    label: "Cancelled",
    badge: "bg-rose-950/90 text-rose-200 border border-rose-500/40",
    description: "This ride dispatch was cancelled.",
    step: 4,
  },
};

const PAYMENT_STATUS_LABEL: Record<PaymentStatus, { label: string; badge: string }> = {
  CREATED: {
    label: "Created",
    badge: "text-blue-900 bg-blue-500/15 border border-blue-600/30",
  },
  PENDING: {
    label: "Pending",
    badge: "text-amber-900 bg-amber-500/15 border border-amber-600/30",
  },
  AUTHORIZED: {
    label: "Authorized",
    badge: "text-blue-900 bg-blue-500/15 border border-blue-600/30",
  },
  CAPTURED: {
    label: "Captured ✓",
    badge: "text-emerald-950 bg-emerald-500/20 border border-emerald-600/40",
  },
  FAILED: {
    label: "Failed",
    badge: "text-rose-900 bg-rose-500/15 border border-rose-600/30",
  },
  CANCELLED: {
    label: "Cancelled",
    badge: "text-rose-900 bg-rose-500/15 border border-rose-600/30",
  },
};

const RIDE_STEPS: { key: RideStatus; label: string }[] = [
  { key: "SEARCHING", label: "Offer" },
  { key: "DRIVER_ASSIGNED", label: "Assigned" },
  { key: "DRIVER_ARRIVING", label: "Pickup" },
  { key: "RIDE_STARTED", label: "Transit" },
  { key: "ARRIVED_AT_DESTINATION", label: "Drop" },
  { key: "COMPLETED", label: "Settled" },
];

const formatPaise = formatFare;

// --- Framer Motion Variants ---
const tabPanelVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.28,
      ease: [0.16, 1, 0.3, 1],
    },
  },
};

const cardAppearVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
  },
};

// --- Luxury Telemetry Skeleton Loader ---
function TabTelemetryLoader({
  title,
  subtitle,
  cardCount = 3,
}: {
  title: string;
  subtitle: string;
  cardCount?: number;
}) {
  return (
    <div className="w-full space-y-5 animate-in fade-in duration-200">
      <div className="relative overflow-hidden rounded-[2rem] border border-[#fff4dc]/85 bg-gradient-to-b from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-6 sm:p-8 shadow-xl backdrop-blur-2xl">
        <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#7a4416]/15 pb-5 mb-6">
          <div className="flex items-center gap-3.5">
            <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#241205] text-[#ffd88a] shadow-md">
              <Loader2 className="h-5 w-5 animate-spin text-[#ffd88a]" />
              <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#fffaf0] bg-amber-500 animate-ping" />
            </div>
            <div>
              <h3 className="console-display text-lg sm:text-xl font-black text-[#2e1808]">
                {title}
              </h3>
              <p className="text-xs font-medium text-[#7a4416] mt-0.5">{subtitle}</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-2 self-start sm:self-auto rounded-full border border-[#c58a3a]/40 bg-[#fffaf0] px-3.5 py-1.5 text-[11px] console-readout font-bold text-[#3a1f0a] shadow-2xs">
            <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            SYNCING LEDGER…
          </span>
        </div>

        <div className="space-y-3.5">
          {Array.from({ length: cardCount }).map((_, idx) => (
            <div
              key={idx}
              className="relative overflow-hidden rounded-2xl border border-[#7a4416]/15 bg-[#fffdf9]/90 p-5 shadow-2xs"
            >
              <div className="uf-skeleton-shimmer pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-[#fff4dc]/80 to-transparent" />
              <div className="flex items-center justify-between border-b border-[#7a4416]/10 pb-3 mb-3.5">
                <div className="flex items-center gap-2.5">
                  <div className="h-5 w-20 rounded-md bg-[#3a1f0a]/15" />
                  <div className="h-3.5 w-32 rounded-md bg-[#7a4416]/15" />
                </div>
                <div className="h-5 w-20 rounded-full bg-[#3a1f0a]/15" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                <div className="md:col-span-2 space-y-2.5">
                  <div className="h-3.5 w-3/4 rounded-md bg-[#3a1f0a]/15" />
                  <div className="h-3.5 w-2/3 rounded-md bg-[#7a4416]/15" />
                </div>
                <div className="flex md:flex-col items-end justify-between gap-2">
                  <div className="h-6 w-24 rounded-lg bg-[#3a1f0a]/20" />
                  <div className="h-3 w-20 rounded-md bg-[#7a4416]/15" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Precision Center-to-Center Stepper ---
function RideStepper({ status }: { status: RideStatus }) {
  const idx = RIDE_STEPS.findIndex((s) => s.key === status);
  const activeIdx = idx === -1 ? 0 : idx;
  const progress = RIDE_STEPS.length > 1 ? activeIdx / (RIDE_STEPS.length - 1) : 0;

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9]/95 px-2 sm:px-3 py-3.5 shadow-inner">
      <div className="pointer-events-none absolute left-[8.333%] right-[8.333%] top-[27px] h-[2.5px] rounded-full bg-[#7a4416]/15">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#3a1f0a] via-[#b8722c] to-emerald-600 transition-all duration-500 ease-out"
          style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }}
        />
      </div>

      <ol className="relative z-10 grid grid-cols-6 items-start w-full">
        {RIDE_STEPS.map((s, i) => {
          const done = i <= activeIdx && status !== "CANCELLED";
          const current = i === activeIdx && status !== "CANCELLED";
          return (
            <li key={s.key} className="flex flex-col items-center gap-1.5 min-w-0 px-0.5">
              <div
                className={`grid h-6 w-6 sm:h-7 sm:w-7 shrink-0 place-items-center rounded-full border-2 text-[10px] font-bold transition-all duration-300 ${
                  done
                    ? "border-[#ffd88a] bg-gradient-to-br from-[#3a1f0a] to-[#2e1808] text-[#ffd88a] shadow-sm"
                    : "border-[#7a4416]/30 bg-[#fffaf0] text-[#7a4416]"
                } ${current ? "ring-4 ring-[#c58a3a]/30 scale-110" : ""}`}
              >
                {done ? <CheckCircle2 className="h-3.5 w-3.5 text-[#ffd88a]" /> : i + 1}
              </div>
              <span
                className={`w-full truncate text-center text-[8.5px] sm:text-[9.5px] font-bold uppercase tracking-tight sm:tracking-wider transition-colors ${
                  current
                    ? "text-[#2e1808] font-black"
                    : done
                      ? "text-[#6b3a12]"
                      : "text-[#7a4416]/60"
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

const getStoredDriverAvailability = (userId?: string): boolean => {
  if (!userId || typeof window === "undefined") return false;
  try {
    return localStorage.getItem(`urbanfleet_driver_available_${userId}`) === "true";
  } catch {
    return false;
  }
};

export default function DriverDashboard() {
  const { user, logout } = useAuthContext();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<DriverProfileData | null>(null);
  const [currentRide, setCurrentRide] = useState<Ride | null>(null);
  const [driverLocation, setDriverLocation] = useState<Coordinates | null>(null);
  const [riderLocation, setRiderLocation] = useState<Coordinates | null>(null);
  const [driverStatus, setDriverStatus] = useState<DriverStatus>(() => {
    if (typeof window !== "undefined") {
      try {
        const keys = Object.keys(localStorage);
        const availKey = keys.find((k) => k.startsWith("urbanfleet_driver_available_"));
        if (availKey && localStorage.getItem(availKey) === "true") {
          return "AVAILABLE";
        }
      } catch {
        // Fallback
      }
    }
    return "ONLINE";
  });
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
  const [walletBalance, setWalletBalance] = useState<DriverBalance | null>(null);

  const syncWalletBalance = useCallback(async () => {
    try {
      const res = await appApi.get<{ success: boolean; data: DriverBalance }>(
        "/payments/payouts/balance"
      );
      if (res.data?.data) {
        setWalletBalance(res.data.data);
      }
    } catch {
      // Non-blocking
    }
  }, []);

  const [isBankDetailsOpen, setIsBankDetailsOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [tripOtp, setTripOtp] = useState("");
  const [isStartingRide, setIsStartingRide] = useState(false);
  const [isAcceptingRide, setIsAcceptingRide] = useState(false);

  // Tabs & Data States
  const [activeTab, setActiveTab] = useState<DashboardTab>("console");
  const [rideHistory, setRideHistory] = useState<DriverRideItem[]>([]);
  const [driverMetrics, setDriverMetrics] = useState<DriverRideMetrics | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [hasLoadedHistory, setHasLoadedHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<"ALL" | "COMPLETED" | "CANCELLED">("ALL");

  const [ratingsSummary, setRatingsSummary] = useState<DriverRatingsSummary | null>(null);
  const [ratingsLoading, setRatingsLoading] = useState(true);
  const [hasLoadedRatings, setHasLoadedRatings] = useState(false);

  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [hasLoadedSessions, setHasLoadedSessions] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [isRevokingAllSessions, setIsRevokingAllSessions] = useState(false);
  const [sessionSuccessMsg, setSessionSuccessMsg] = useState<string | null>(null);

  const loadDriverHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const [historyData, metricsData] = await Promise.all([
        fetchDriverRideHistory(),
        fetchDriverRideMetrics().catch(() => null),
      ]);
      setRideHistory(historyData);
      if (metricsData) {
        setDriverMetrics(metricsData);
      }
    } catch (err) {
      console.error("Failed to load driver ride history:", err);
    } finally {
      setHistoryLoading(false);
      setHasLoadedHistory(true);
    }
  }, []);

  const loadDriverRatings = useCallback(async () => {
    setRatingsLoading(true);
    try {
      const data = await fetchDriverRatings();
      setRatingsSummary(data);
    } catch (err) {
      console.error("Failed to load driver ratings:", err);
    } finally {
      setRatingsLoading(false);
      setHasLoadedRatings(true);
    }
  }, []);

  const loadDriverSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const data = await sessionApi.listSessions();
      setSessions(data.sessions || []);
    } catch (err) {
      console.error("Failed to load driver sessions:", err);
    } finally {
      setSessionsLoading(false);
      setHasLoadedSessions(true);
    }
  }, []);

  const handleSelectTab = useCallback(
    (nextTab: DashboardTab) => {
      if (nextTab === activeTab) return;

      if (nextTab === "history" && !hasLoadedHistory) {
        setHistoryLoading(true);
      } else if (nextTab === "ratings" && !hasLoadedRatings) {
        setRatingsLoading(true);
      } else if (nextTab === "sessions" && !hasLoadedSessions) {
        setSessionsLoading(true);
      }

      setActiveTab(nextTab);

      if (nextTab === "console") {
        setTimeout(() => {
          window.dispatchEvent(new Event("resize"));
        }, 60);
      }
    },
    [activeTab, hasLoadedHistory, hasLoadedRatings, hasLoadedSessions]
  );

  const handleRevokeSession = async (sessionId: string) => {
    setRevokingSessionId(sessionId);
    setSessionSuccessMsg(null);
    try {
      await sessionApi.revokeSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setSessionSuccessMsg("Session revoked successfully.");
    } catch (err) {
      console.error("Failed to revoke session:", err);
      setError("Failed to revoke session. Please try again.");
    } finally {
      setRevokingSessionId(null);
    }
  };

  const handleRevokeAllOtherSessions = async () => {
    setIsRevokingAllSessions(true);
    setSessionSuccessMsg(null);
    try {
      await sessionApi.logoutAllOtherSessions();
      setSessions((prev) => prev.filter((s) => s.isCurrent));
      setSessionSuccessMsg("All other sessions have been logged out successfully.");
    } catch (err) {
      console.error("Failed to revoke other sessions:", err);
      setError("Failed to revoke other sessions.");
    } finally {
      setIsRevokingAllSessions(false);
    }
  };

  useEffect(() => {
    if (activeTab === "history") {
      void loadDriverHistory();
    } else if (activeTab === "ratings") {
      void loadDriverRatings();
    } else if (activeTab === "sessions") {
      void loadDriverSessions();
    }
  }, [activeTab, loadDriverHistory, loadDriverRatings, loadDriverSessions]);

  const watchIdRef = useRef<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const driverStatusRef = useRef<DriverStatus>(driverStatus);

  useEffect(() => {
    if (!user?.id) return;
    const isSaved = getStoredDriverAvailability(user.id);
    if (isSaved && driverStatusRef.current !== "BUSY") {
      setDriverStatus("AVAILABLE");
      driverStatusRef.current = "AVAILABLE";
    }
  }, [user?.id]);

  const currentRideRef = useRef<Ride | null>(null);
  const hasEmittedOnlineRef = useRef(false);
  const routeRequestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeAbortControllerRef = useRef<AbortController | null>(null);
  const lastRouteFetchAtRef = useRef(0);

  const applyCompletedRideStats = useCallback((ride: Ride | null | undefined) => {
    if (!ride) return;

    const earningPaise =
      ride.fare?.breakdown?.driverEarningPaise ??
      (ride.fare?.final
        ? Math.round(ride.fare.final * 0.8)
        : ride.fare?.estimated
          ? Math.round(ride.fare.estimated * 0.8)
          : 0);
    const distanceKm = getDistanceKm(ride.distance);

    setDriverMetrics((prev) => {
      if (!prev) {
        return {
          totalTrips: 1,
          completedTrips: 1,
          cancelledTrips: 0,
          totalDistanceKm: distanceKm,
          totalDistanceMeters: Math.round(distanceKm * 1000),
          totalFarePaise: ride.fare?.final ?? ride.fare?.estimated ?? 0,
          totalEarningsPaise: earningPaise,
        };
      }
      return {
        ...prev,
        totalTrips: prev.totalTrips + 1,
        completedTrips: prev.completedTrips + 1,
        totalDistanceKm: Number((prev.totalDistanceKm + distanceKm).toFixed(2)),
        totalDistanceMeters: prev.totalDistanceMeters + Math.round(distanceKm * 1000),
        totalFarePaise: prev.totalFarePaise + (ride.fare?.final ?? ride.fare?.estimated ?? 0),
        totalEarningsPaise: prev.totalEarningsPaise + earningPaise,
      };
    });

    setRideHistory((prev) => {
      const completedItem: DriverRideItem = {
        id: ride.id,
        riderId: ride.riderId,
        driverId: ride.driverId ?? null,
        status: "COMPLETED",
        paymentStatus: ride.paymentStatus ?? "CAPTURED",
        pickup: ride.pickup,
        destination: ride.destination,
        fare: {
          estimated: ride.fare?.estimated ?? 0,
          final: ride.fare?.final ?? null,
          breakdown: ride.fare?.breakdown ?? null,
        },
        distance: {
          estimated: ride.distance?.estimated ?? 0,
          actual: ride.distance?.actual ?? ride.distance?.estimated ?? 0,
        },
        duration: ride.duration ?? { estimated: 0, actual: null },
        createdAt: ride.createdAt || new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      if (prev.some((r) => r.id === ride.id)) {
        return prev.map((r) => (r.id === ride.id ? completedItem : r));
      }
      return [completedItem, ...prev];
    });

    setProfile((prevProfile) => {
      if (!prevProfile) return prevProfile;
      return {
        ...prevProfile,
        statistics: {
          ...prevProfile.statistics,
          completedTrips: prevProfile.statistics.completedTrips + 1,
          totalEarnings: prevProfile.statistics.totalEarnings + earningPaise,
          totalDistance: prevProfile.statistics.totalDistance + distanceKm,
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

  // Trap browser Back navigation while a driving assignment is active
  useEffect(() => {
    if (currentRide && BUSY_RIDE_STATUSES.includes(currentRide.status)) {
      window.history.pushState(null, "", window.location.href);
      const handlePopState = () => {
        window.history.pushState(null, "", window.location.href);
      };
      window.addEventListener("popstate", handlePopState);
      return () => {
        window.removeEventListener("popstate", handlePopState);
      };
    }
  }, [currentRide]);

  useEffect(() => {
    if (user?.roles?.includes("RIDER") && !user?.roles?.includes("DRIVER")) {
      navigate("/dashboard", { replace: true });
      return;
    }
  }, [user?.roles, navigate]);

  useEffect(() => {
    async function loadProfileAndRide() {
      try {
        if (user?.roles?.includes("RIDER")) {
          const riderRes = await appApi
            .get<{ success: boolean; data: Ride }>("/rides/current")
            .catch(() => null);
          const riderRide = riderRes?.data?.data;
          if (
            riderRide &&
            riderRide.riderId === user?.id &&
            !["COMPLETED", "CANCELLED"].includes(riderRide.status)
          ) {
            navigate(`/ride/${riderRide.id}`, { replace: true });
            return;
          }
        }

        const [
          profileResponse,
          rideResponse,
          ratingsResponse,
          historyResponse,
          metricsResponse,
          balanceResponse,
        ] = await Promise.all([
          fetchDriverProfile().catch(() => null),
          appApi.get<{ success: boolean; data: Ride }>("/rides/driver/current").catch(() => null),
          fetchDriverRatings().catch(() => null),
          fetchDriverRideHistory().catch(() => []),
          fetchDriverRideMetrics().catch(() => null),
          appApi
            .get<{ success: boolean; data: DriverBalance }>("/payments/payouts/balance")
            .catch(() => null),
        ]);

        if (profileResponse) setProfile(profileResponse);
        if (ratingsResponse) {
          setRatingsSummary(ratingsResponse);
          setHasLoadedRatings(true);
          setRatingsLoading(false);
        }
        if (historyResponse) {
          setRideHistory(historyResponse);
          setHasLoadedHistory(true);
          setHistoryLoading(false);
        }
        if (metricsResponse) {
          setDriverMetrics(metricsResponse);
        }
        if (balanceResponse?.data?.data) {
          setWalletBalance(balanceResponse.data.data);
        }

        const hasBusyRide = Boolean(
          rideResponse?.data?.data && BUSY_RIDE_STATUSES.includes(rideResponse.data.data.status)
        );

        if (rideResponse && rideResponse.data?.data) {
          const currentRideData = rideResponse.data.data;
          setCurrentRide(currentRideData);
          if (BUSY_RIDE_STATUSES.includes(currentRideData.status)) {
            setDriverStatus("BUSY");
            driverStatusRef.current = "BUSY";
          }
        }

        if (!hasBusyRide) {
          const isDbAvailable = Boolean(profileResponse?.isAvailable);
          const isStoredAvailable = user?.id ? getStoredDriverAvailability(user.id) : false;
          if (isDbAvailable || isStoredAvailable) {
            setDriverStatus("AVAILABLE");
            driverStatusRef.current = "AVAILABLE";
            if (user?.id) {
              try {
                localStorage.setItem(`urbanfleet_driver_available_${user.id}`, "true");
              } catch (err) {
                console.warn("Failed to save driver availability to localStorage:", err);
              }
            }
          }
        }
      } catch (err: unknown) {
        const response =
          err && typeof err === "object" && "response" in err
            ? (err as { response?: { status?: number; data?: { message?: unknown } } }).response
            : undefined;
        if (response?.status === 404) {
          setProfile(null);
        } else {
          const message = response?.data?.message;
          setError(typeof message === "string" ? message : "Unable to load driver profile.");
        }
      } finally {
        setLoading(false);
      }
    }
    loadProfileAndRide();
  }, [user?.id, user?.roles, navigate]);

  useEffect(() => {
    const ROUTE_REFRESH_INTERVAL_MS = 10_000;

    const fetchGeoapifyRoute = async () => {
      if (!currentRide) return;

      const apiKey = import.meta.env.VITE_GEOAPIFY_API_KEY || "";
      if (!apiKey) return;

      const waypoints: string[] = [];
      if (driverLocation) waypoints.push(`${driverLocation.latitude},${driverLocation.longitude}`);
      waypoints.push(
        `${currentRide.pickup.coordinates.latitude},${currentRide.pickup.coordinates.longitude}`
      );
      waypoints.push(
        `${currentRide.destination.coordinates.latitude},${currentRide.destination.coordinates.longitude}`
      );
      if (waypoints.length < 2) return;

      routeAbortControllerRef.current?.abort();
      const controller = new AbortController();
      routeAbortControllerRef.current = controller;
      lastRouteFetchAtRef.current = Date.now();

      try {
        const url = `https://api.geoapify.com/v1/routing?waypoints=${waypoints.join(
          "|"
        )}&mode=drive&apiKey=${apiKey}`;
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
      const delay =
        lastRouteFetchAtRef.current === 0
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
        const isPersistedAvailable =
          (user?.id ? getStoredDriverAvailability(user.id) : false) ||
          Boolean(profile?.isAvailable) ||
          driverStatusRef.current === "AVAILABLE";

        if (!hasEmittedOnlineRef.current) {
          hasEmittedOnlineRef.current = true;
          driverSocket.send(
            JSON.stringify({
              event: DriverEvents.GO_ONLINE,
              data: { available: isPersistedAvailable },
            })
          );
        }
        if (
          currentRideRef.current &&
          BUSY_RIDE_STATUSES.includes(currentRideRef.current.status)
        ) {
          driverSocket.send(JSON.stringify({ event: DriverEvents.SET_BUSY, data: {} }));
          setDriverStatus("BUSY");
          driverStatusRef.current = "BUSY";
        } else if (isPersistedAvailable) {
          driverSocket.send(
            JSON.stringify({
              event: DriverEvents.SET_AVAILABLE,
              data: { available: true },
            })
          );
          setDriverStatus("AVAILABLE");
          driverStatusRef.current = "AVAILABLE";
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
              const isPersistedAvailable =
                (user?.id ? getStoredDriverAvailability(user.id) : false) ||
                driverStatusRef.current === "AVAILABLE";

              if (
                data.status === "ONLINE" &&
                isPersistedAvailable &&
                (!currentRideRef.current ||
                  !BUSY_RIDE_STATUSES.includes(currentRideRef.current.status))
              ) {
                setDriverStatus("AVAILABLE");
                driverStatusRef.current = "AVAILABLE";
              } else {
                setDriverStatus(data.status);
                driverStatusRef.current = data.status;
                if (user?.id && (data.status === "AVAILABLE" || data.status === "ONLINE")) {
                  try {
                    localStorage.setItem(
                      `urbanfleet_driver_available_${user.id}`,
                      data.status === "AVAILABLE" ? "true" : "false"
                    );
                  } catch (err) {
                    console.warn("Failed to save driver availability to localStorage:", err);
                  }
                }
              }
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
              const updated = prev
                ? { ...prev, status: "COMPLETED" as RideStatus, ...data?.ride }
                : null;
              if (updated) {
                applyCompletedRideStats(updated);
                const earnedPaise = updated.fare?.breakdown?.driverEarningPaise ?? 0;
                if (earnedPaise > 0) {
                  setShowEarningsFlash(earnedPaise);
                  setTimeout(() => setShowEarningsFlash(null), 3200);
                }
              }
              return updated;
            });
            setRiderLocation(null);
            void Promise.all([
              fetchDriverProfile().then((fresh) => {
                if (fresh) setProfile(fresh);
              }),
              syncWalletBalance(),
              loadDriverHistory(),
              loadDriverRatings(),
            ]);
            setTimeout(() => {
              void Promise.all([
                fetchDriverProfile().then((fresh) => {
                  if (fresh) setProfile(fresh);
                }),
                syncWalletBalance(),
                loadDriverHistory(),
                loadDriverRatings(),
              ]);
            }, 1200);
            break;
          }
          case ServerEvents.RIDE_CANCELLED:
            if (data?.rideId !== currentRideRef.current?.id) break;
            setCurrentRide((prev) =>
              prev
                ? {
                    ...prev,
                    status: "CANCELLED",
                    cancelledBy: data?.cancelledBy,
                    cancellationReason: data?.reason,
                  }
                : prev
            );
            setRiderLocation(null);
            break;
          case ServerEvents.ERROR:
            setError(data?.message || "Server error occurred.");
            setIsAcceptingRide(false);
            setIsStartingRide(false);
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
  }, [
    applyCompletedRideStats,
    loadDriverHistory,
    loadDriverRatings,
    profile,
    syncWalletBalance,
    user?.id,
  ]);

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
      void Promise.resolve().then(() =>
        setError("Geolocation is not supported in this browser.")
      );
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
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        syncLocation(latitude, longitude);
      },
      (positionError) => setError(`Navigator : ${positionError.message} `),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
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
    } else if (
      TERMINAL_RIDE_STATUSES.includes(currentRide.status) &&
      driverStatusRef.current === "BUSY"
    ) {
      socketRef.current.send(JSON.stringify({ event: DriverEvents.SET_AVAILABLE, data: {} }));
      setDriverStatus("AVAILABLE");
    }
  }, [currentRide, currentRide?.status]);

  const handleToggleAvailability = async () => {
    if (driverStatus === "BUSY") {
      setError("You can't go offline while a ride is active.");
      return;
    }

    const nextIsAvailable = driverStatus !== "AVAILABLE";
    const nextStatus: DriverStatus = nextIsAvailable ? "AVAILABLE" : "ONLINE";

    setDriverStatus(nextStatus);
    driverStatusRef.current = nextStatus;

    if (user?.id) {
      try {
        localStorage.setItem(
          `urbanfleet_driver_available_${user.id}`,
          nextIsAvailable ? "true" : "false"
        );
      } catch (err) {
        console.warn("Failed to set driver availability in localStorage:", err);
      }
    }

    try {
      void appApi
        .post("/drivers/availability", { isAvailable: nextIsAvailable })
        .then(() => {
          setProfile((prev) => (prev ? { ...prev, isAvailable: nextIsAvailable } : prev));
        })
        .catch((err) => {
          console.warn("Could not persist driver availability to API:", err);
        });
    } catch (err) {
      console.warn("Failed to dispatch driver availability request:", err);
    }

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          event: DriverEvents.SET_AVAILABLE,
          data: { available: nextIsAvailable },
        })
      );
    }
  };

  const handleAcceptRide = (rideId: string) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setError("Socket connection not ready.");
      return;
    }
    setError("");
    setIsAcceptingRide(true);
    socketRef.current.send(
      JSON.stringify({
        event: DriverEvents.ACCEPT_RIDE,
        data: { rideId },
      })
    );
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
    socketRef.current.send(
      JSON.stringify({
        event: DriverEvents.START_RIDE,
        data: { rideId, otp: tripOtp },
      })
    );
  };

  const handleRejectRide = (rideId: string) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setError("Socket connection not ready.");
      return;
    }
    socketRef.current.send(
      JSON.stringify({ event: DriverEvents.REJECT_RIDE, data: { rideId } })
    );
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
      })
    );
  };

  const sendRideAction = (event: string, rideId: string, extraData = {}) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setError("Socket connection not ready.");
      return;
    }
    socketRef.current.send(JSON.stringify({ event, data: { rideId, ...extraData } }));
  };

  // --- Computed Metrics ---
  const completedRides = useMemo(() => {
    return rideHistory.filter((r) => r.status === "COMPLETED");
  }, [rideHistory]);

  const historyDistanceKm = useMemo(() => {
    return completedRides.reduce((acc, r) => {
      const d = r.distance?.actual ?? r.distance?.estimated ?? 0;
      return acc + (typeof d === "number" ? d : Number(d) || 0);
    }, 0);
  }, [completedRides]);

  const historyEarningsPaise = useMemo(() => {
    return completedRides.reduce((acc, r) => {
      const earning =
        r.fare?.breakdown?.driverEarningPaise ??
        (r.fare?.final
          ? Math.round(r.fare.final * 0.8)
          : r.fare?.estimated
            ? Math.round(r.fare.estimated * 0.8)
            : 0);
      return acc + earning;
    }, 0);
  }, [completedRides]);

  const effectiveTotalDistanceKm = useMemo(() => {
    const metricKm = Number(driverMetrics?.totalDistanceKm ?? 0);
    const rawProfileDistance = Number(profile?.statistics?.totalDistance ?? 0);
    const profileDistanceKm =
      rawProfileDistance > 10000 ? rawProfileDistance / 1000 : rawProfileDistance;
    return Math.max(metricKm, historyDistanceKm, profileDistanceKm);
  }, [driverMetrics?.totalDistanceKm, historyDistanceKm, profile?.statistics?.totalDistance]);

  const effectiveNetEarningsPaise = useMemo(() => {
    const ledgerEarned = Number(walletBalance?.earnedPaise ?? 0);
    const metricEarnings = Number(driverMetrics?.totalEarningsPaise ?? 0);
    const profileEarnings = Number(
      profile?.statistics?.totalEarnings ?? profile?.totalEarningsPaise ?? 0
    );
    return Math.max(ledgerEarned, metricEarnings, historyEarningsPaise, profileEarnings);
  }, [
    walletBalance?.earnedPaise,
    driverMetrics?.totalEarningsPaise,
    historyEarningsPaise,
    profile?.statistics?.totalEarnings,
    profile?.totalEarningsPaise,
  ]);

  const effectiveCompletedTrips = useMemo(() => {
    const metricCompleted = Number(driverMetrics?.completedTrips ?? 0);
    const profileCompleted = Number(profile?.statistics?.completedTrips ?? 0);
    return Math.max(metricCompleted, completedRides.length, profileCompleted);
  }, [driverMetrics?.completedTrips, completedRides.length, profile?.statistics?.completedTrips]);

  const effectiveTotalTrips = useMemo(() => {
    const metricTotal = Number(driverMetrics?.totalTrips ?? 0);
    const profileTotal = Number(profile?.statistics?.totalTrips ?? profile?.totalTrips ?? 0);
    return Math.max(metricTotal, rideHistory.length, profileTotal, effectiveCompletedTrips);
  }, [
    driverMetrics?.totalTrips,
    rideHistory.length,
    profile?.statistics?.totalTrips,
    profile?.totalTrips,
    effectiveCompletedTrips,
  ]);

  const effectiveAcceptanceRate = useMemo(() => {
    if (effectiveTotalTrips <= 0) return 100;
    return Math.min(100, Math.round((effectiveCompletedTrips / effectiveTotalTrips) * 100));
  }, [effectiveCompletedTrips, effectiveTotalTrips]);

  const fallbackRatingsFromHistory: DriverReviewItem[] = useMemo(() => {
    const list: DriverReviewItem[] = [];
    for (const r of rideHistory) {
      if (r.ratings && r.ratings.length > 0) {
        for (const rt of r.ratings) {
          list.push({
            id: rt.id,
            score: rt.score,
            comment: rt.feedback || null,
            createdAt: rt.createdAt || r.completedAt || r.createdAt,
            pickupAddress: r.pickup?.address,
            destinationAddress: r.destination?.address,
            passengerLabel: "Verified Passenger",
          });
        }
      }
    }
    return list;
  }, [rideHistory]);

  const effectiveReviews: DriverReviewItem[] = useMemo(() => {
    return ratingsSummary ? ratingsSummary.reviews : fallbackRatingsFromHistory;
  }, [ratingsSummary, fallbackRatingsFromHistory]);

  const effectiveTotalRatings = useMemo(() => {
    if (ratingsSummary) return ratingsSummary.totalRatings;
    if (fallbackRatingsFromHistory.length > 0) return fallbackRatingsFromHistory.length;
    return Number(profile?.rating?.totalRatings ?? 0);
  }, [ratingsSummary, fallbackRatingsFromHistory, profile?.rating?.totalRatings]);

  const effectiveAverage = useMemo(() => {
    if (ratingsSummary && ratingsSummary.averageRating !== null) {
      return ratingsSummary.averageRating;
    }
    if (fallbackRatingsFromHistory.length > 0) {
      const sum = fallbackRatingsFromHistory.reduce((acc, r) => acc + r.score, 0);
      return Number((sum / fallbackRatingsFromHistory.length).toFixed(2));
    }
    return effectiveTotalRatings > 0 ? Number(profile?.rating?.average ?? 5.0) : 5.0;
  }, [
    ratingsSummary,
    fallbackRatingsFromHistory,
    effectiveTotalRatings,
    profile?.rating?.average,
  ]);

  const effectiveDistribution = useMemo(() => {
    if (ratingsSummary?.distribution) {
      return ratingsSummary.distribution;
    }
    const dist: Record<number, { count: number; pct: number }> = {
      5: { count: 0, pct: 0 },
      4: { count: 0, pct: 0 },
      3: { count: 0, pct: 0 },
      2: { count: 0, pct: 0 },
      1: { count: 0, pct: 0 },
    };
    if (fallbackRatingsFromHistory.length > 0) {
      for (const r of fallbackRatingsFromHistory) {
        const s = Math.max(1, Math.min(5, Math.round(r.score)));
        dist[s].count++;
      }
      for (let s = 1; s <= 5; s++) {
        dist[s].pct = Math.round((dist[s].count / fallbackRatingsFromHistory.length) * 100);
      }
    }
    return dist;
  }, [ratingsSummary, fallbackRatingsFromHistory]);

  if (loading) {
    return <LoadingScreen label="Loading driver cockpit" />;
  }

  const isApprovedDriver = isDriverApproved(profile);

  if (!profile || !isApprovedDriver) {
    return (
      <div className="relative flex min-h-screen w-full items-center justify-center bg-[#f5e6c8] p-6 font-sans text-[#2e1808] overflow-hidden">
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          <CityMapBackground />
        </div>
        <div className="relative z-10 w-full max-w-2xl">
          <DriverCTA driver={profile} loading={loading} />
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => void logout().finally(() => navigate("/login", { replace: true }))}
              className="text-xs font-semibold text-[#6b3a12] underline hover:text-[#3a1f0a] transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const mapCenter = driverLocation
    ? { lat: driverLocation.latitude, lng: driverLocation.longitude }
    : currentRide
      ? {
          lat: currentRide.pickup.coordinates.latitude,
          lng: currentRide.pickup.coordinates.longitude,
        }
      : { lat: 22.5726, lng: 88.3639 };

  const mapMarkers = [
    ...(driverLocation
      ? [
          {
            position: { lat: driverLocation.latitude, lng: driverLocation.longitude },
            label: "DR",
            title: "You",
          },
        ]
      : []),
    ...(currentRide
      ? [
          {
            position: {
              lat: currentRide.pickup.coordinates.latitude,
              lng: currentRide.pickup.coordinates.longitude,
            },
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
      ? [
          {
            position: { lat: riderLocation.latitude, lng: riderLocation.longitude },
            label: "R",
            title: "Rider location",
          },
        ]
      : []),
  ];

  const statusConfig = currentRide ? RIDE_STATUS_CONFIG[currentRide.status] : null;
  const paymentInfo = currentRide ? PAYMENT_STATUS_LABEL[currentRide.paymentStatus] : null;
  const canCompleteCurrentRide =
    currentRide?.status === "ARRIVED_AT_DESTINATION" &&
    currentRide.paymentStatus === "CAPTURED";
  const distance = currentRide ? currentRide.distance : null;
  const duration = currentRide ? currentRide.duration : null;
  const fare = currentRide
    ? currentRide.fare.breakdown?.driverEarningPaise ??
      (currentRide.fare.final
        ? Math.round(currentRide.fare.final * 0.8)
        : currentRide.fare.estimated
          ? Math.round(currentRide.fare.estimated * 0.8)
          : null)
    : null;
  const totalTripFare = currentRide
    ? currentRide.fare.final ?? currentRide.fare.estimated ?? 0
    : 0;
  const breakdownData = currentRide?.fare?.breakdown ?? null;

  const liveDriverMetrics = useMemo(() => {
    if (!currentRide) return null;
    const estTripDist = currentRide.distance?.actual ?? currentRide.distance?.estimated ?? 0;
    const estTripDur = currentRide.duration?.actual ?? currentRide.duration?.estimated ?? 0;

    if (currentRide.status === "DRIVER_ASSIGNED" || currentRide.status === "DRIVER_ARRIVING") {
      if (driverLocation && currentRide.pickup?.coordinates) {
        const straightKm = calculateHaversineDistanceKm(driverLocation, currentRide.pickup.coordinates);
        const roadDistKm = straightKm * 1.3;
        const etaMin = Math.max(1, Math.round(roadDistKm * 2.4));
        return {
          distanceLabel: "To Pickup",
          distanceValue: formatDistance(roadDistKm),
          timeLabel: "Pickup ETA",
          timeValue: formatDuration(etaMin),
        };
      }
      return {
        distanceLabel: "To Pickup",
        distanceValue: formatDistance(estTripDist),
        timeLabel: "Pickup ETA",
        timeValue: "2-5 min",
      };
    }

    if (currentRide.status === "RIDE_STARTED") {
      if (driverLocation && currentRide.destination?.coordinates) {
        const straightKm = calculateHaversineDistanceKm(driverLocation, currentRide.destination.coordinates);
        const roadDistKm = straightKm * 1.3;
        const etaMin = Math.max(1, Math.round(roadDistKm * 2.2));
        return {
          distanceLabel: "To Drop-off",
          distanceValue: formatDistance(roadDistKm),
          timeLabel: "Trip ETA",
          timeValue: formatDuration(etaMin),
        };
      }
      return {
        distanceLabel: "To Drop-off",
        distanceValue: formatDistance(estTripDist),
        timeLabel: "Trip ETA",
        timeValue: formatDuration(estTripDur),
      };
    }

    if (currentRide.status === "ARRIVED_AT_DESTINATION") {
      return {
        distanceLabel: "Trip Dist",
        distanceValue: formatDistance(estTripDist),
        timeLabel: "Trip Status",
        timeValue: "Arrived",
      };
    }

    // Default / COMPLETED
    return {
      distanceLabel: "Trip Dist",
      distanceValue: formatDistance(estTripDist),
      timeLabel: "Trip Duration",
      timeValue: formatDuration(estTripDur),
    };
  }, [currentRide, driverLocation]);

  const statusDotColor =
    driverStatus === "AVAILABLE"
      ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.85)]"
      : driverStatus === "BUSY"
        ? "bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.85)]"
        : driverStatus === "ONLINE"
          ? "bg-sky-500 shadow-[0_0_12px_rgba(14,165,233,0.85)]"
          : "bg-[#7a4416]";

  const vehicleType = profile?.vehicle?.type || "CAR";
  const VehicleIcon = VEHICLE_TYPE_ICON[vehicleType] || Car;
  const driverFullName = user?.firstName
    ? `${user.firstName} ${user.lastName || ""}`.trim()
    : "Captain Partner";

  const NAV_TABS: Array<{
    id: DashboardTab;
    label: string;
    shortLabel: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string | number;
    pulse?: boolean;
  }> = [
    {
      id: "console",
      label: "Radar & Dispatch",
      shortLabel: "Radar",
      icon: Compass,
      pulse: Boolean(currentRide),
    },
    {
      id: "history",
      label: "Trip Ledger",
      shortLabel: "Ledger",
      icon: History,
      badge: hasLoadedHistory && rideHistory.length > 0 ? rideHistory.length : undefined,
    },
    {
      id: "ratings",
      label: "Ratings",
      shortLabel: "Ratings",
      icon: Star,
      badge: effectiveTotalRatings > 0 ? `${effectiveAverage.toFixed(1)}★` : undefined,
    },
    {
      id: "vehicle",
      label: "Fleet & RTO",
      shortLabel: "Fleet",
      icon: Car,
    },
    {
      id: "sessions",
      label: "Security",
      shortLabel: "Security",
      icon: ShieldCheck,
    },
  ];

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden bg-[#f5e6c8] font-sans text-[#2e1808] selection:bg-[#3a1f0a] selection:text-[#ffd88a]">
      {/* Fixed Viewport Background */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <CityMapBackground />
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700;0,9..144,800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600;700;800&display=swap');

        .console-display { font-family: 'Fraunces', ui-serif, Georgia, serif; }
        .console-readout { font-family: 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }

        @keyframes ufRadarRing {
          0% { transform: scale(0.8); opacity: 0.75; }
          75% { transform: scale(1.75); opacity: 0; }
          100% { transform: scale(1.75); opacity: 0; }
        }
        @keyframes ufRadarSweep {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes ufShimmer {
          100% { transform: translateX(200%); }
        }
        .animate-radar-ring-1 {
          animation: ufRadarRing 2.8s cubic-bezier(0.16, 1, 0.3, 1) infinite;
        }
        .animate-radar-ring-2 {
          animation: ufRadarRing 2.8s cubic-bezier(0.16, 1, 0.3, 1) 1.4s infinite;
        }
        .animate-radar-sweep {
          animation: ufRadarSweep 5s linear infinite;
        }
        .uf-skeleton-shimmer {
          animation: ufShimmer 1.8s infinite ease-in-out;
        }
      `}</style>

      {/* Earnings Toast Flash */}
      <AnimatePresence>
        {showEarningsFlash !== null && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed left-1/2 top-5 z-50 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md text-center"
          >
            <div className="flex items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-emerald-950 via-emerald-900 to-emerald-950 px-6 py-3.5 text-sm font-bold text-emerald-100 shadow-2xl border border-emerald-400/40 backdrop-blur-xl">
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 animate-ping" />
              <span>Trip Settled • Credited +{formatPaise(showEarningsFlash)} to Wallet</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Container */}
      <div className="relative z-10 mx-auto w-full max-w-[1600px] px-3.5 sm:px-6 lg:px-10 py-3.5 sm:py-5 space-y-4 sm:space-y-5">
        {/* =====================================================================
            1. UNIFIED STICKY COCKPIT COMMAND BAR (Identity + Tabs + Quick Actions)
           ===================================================================== */}
        <header className="sticky top-2.5 z-40 w-full">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="w-full rounded-[1.5rem] sm:rounded-[1.85rem] border border-[#fff4dc]/90 bg-gradient-to-r from-[#fffdf9]/95 via-[#fff5e2]/92 to-[#f6e0b5]/92 backdrop-blur-2xl shadow-[0_14px_34px_-10px_rgba(46,24,8,0.16)] p-2.5 sm:px-5 sm:py-3 space-y-2.5 xl:space-y-0"
          >
            <div className="flex items-center justify-between gap-2.5">
              {/* Left: Driver Avatar + Name + HSRP Plate */}
              <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0">
                <button
                  type="button"
                  onClick={() =>
                    profile?.profilePhoto?.url &&
                    setPreviewImage({
                      url: profile.profilePhoto.url,
                      title: `${driverFullName} • Verified Captain`,
                    })
                  }
                  className="relative group h-10 w-10 sm:h-12 sm:w-12 shrink-0 rounded-2xl overflow-hidden border-2 border-[#c58a3a] bg-gradient-to-br from-[#3a1f0a] to-[#241205] text-[#ffd88a] shadow-md focus:outline-none"
                  title="Inspect Captain Portrait"
                >
                  {profile?.profilePhoto?.url ? (
                    <img
                      src={profile.profilePhoto.url}
                      alt={driverFullName}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                    />
                  ) : (
                    <span className="console-display grid h-full w-full place-items-center text-lg font-black">
                      {driverFullName[0]?.toUpperCase() || "C"}
                    </span>
                  )}
                  <span
                    className={`absolute bottom-0.5 right-0.5 h-2.5 w-2.5 sm:h-3 sm:w-3 rounded-full border-2 border-[#fffaf0] ${statusDotColor}`}
                  />
                </button>

                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    <h1 className="console-display truncate text-sm sm:text-lg font-black text-[#2e1808] tracking-tight">
                      {driverFullName}
                    </h1>
                    <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-950/15 border border-emerald-600/30 px-2 py-0.5 text-[10px] font-bold text-emerald-900">
                      <Shield className="h-2.5 w-2.5 text-emerald-700" /> Verified
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                    {/* Indian High-Security Registration Plate Badge */}
                    <span className="inline-flex items-center gap-1 rounded-md border border-[#3a1f0a] bg-[#ffd88a] px-1.5 py-0.2 console-readout text-[10px] font-extrabold tracking-wider text-[#2e1808] shadow-2xs">
                      <span className="text-[8px] font-black text-[#7a4416]">IND</span>
                      <span>{profile?.vehicle?.registrationNumber || "FLEET"}</span>
                    </span>
                    <span className="hidden md:inline truncate text-[11px] font-semibold text-[#6b3a12]">
                      •{" "}
                      {profile?.vehicle
                        ? `${profile.vehicle.brand} ${profile.vehicle.model}`
                        : VEHICLE_TYPE_LABEL[vehicleType]}
                    </span>
                  </div>
                </div>
              </div>

              {/* Center (XL+): Segmented Navigation Pills */}
              <nav
                aria-label="Driver Console Sections"
                className="hidden xl:flex items-center gap-1 rounded-2xl border border-[#7a4416]/15 bg-[#fffaf0]/90 p-1 shadow-inner"
              >
                {NAV_TABS.map((tab) => {
                  const isActive = activeTab === tab.id;
                  const TabIcon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => handleSelectTab(tab.id)}
                      className={`relative flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${
                        isActive
                          ? "text-[#ffe9be]"
                          : "text-[#6b3a12] hover:bg-[#fff4dc]/80 hover:text-[#2e1808]"
                      }`}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="driverCockpitNavDesktop"
                          transition={{ type: "spring", stiffness: 400, damping: 32 }}
                          className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#241205] shadow-md ring-1 ring-[#c58a3a]/50"
                        />
                      )}
                      <span className="relative z-10 flex items-center gap-1.5">
                        <TabIcon
                          className={`h-3.5 w-3.5 ${
                            isActive
                              ? "text-[#ffd88a]"
                              : tab.id === "ratings"
                                ? "text-amber-500 fill-amber-500"
                                : "text-[#b8722c]"
                          }`}
                        />
                        <span>{tab.label}</span>
                        {tab.pulse && (
                          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                        )}
                        {tab.badge !== undefined && (
                          <span
                            className={`rounded-full px-1.5 py-0.2 text-[10px] console-readout font-bold ${
                              isActive
                                ? "bg-white/15 text-[#ffd88a]"
                                : "bg-[#3a1f0a]/10 text-[#3a1f0a]"
                            }`}
                          >
                            {tab.badge}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </nav>

              {/* Right: Quick Action Controls */}
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                {/* Master Availability Pill Button */}
                <button
                  type="button"
                  onClick={handleToggleAvailability}
                  disabled={driverStatus === "BUSY"}
                  className={`flex items-center gap-1.5 h-9 sm:h-10 px-3 sm:px-3.5 rounded-xl text-xs font-bold transition-all active:scale-95 shadow-sm border ${
                    driverStatus === "AVAILABLE"
                      ? "bg-gradient-to-br from-emerald-800 to-emerald-950 text-emerald-50 border-emerald-400/40 shadow-[0_6px_20px_-6px_rgba(16,185,129,0.5)]"
                      : driverStatus === "BUSY"
                        ? "bg-amber-950/90 text-amber-100 border-amber-500/40 cursor-not-allowed"
                        : "bg-[#fffaf0] text-[#3a1f0a] border-[#7a4416]/30 hover:bg-[#fff4dc]"
                  }`}
                  title="Toggle Radar Dispatch Status"
                >
                  <Power className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden sm:inline">
                    {driverStatus === "AVAILABLE"
                      ? "Scanning • Online"
                      : driverStatus === "BUSY"
                        ? "On Active Trip"
                        : "Go Online"}
                  </span>
                </button>

                {/* Wallet Vault Pill */}
                <button
                  type="button"
                  onClick={() => setIsWalletOpen(true)}
                  className="group flex items-center gap-1.5 h-9 sm:h-10 px-3 sm:px-3.5 rounded-xl border border-[#c58a3a]/50 bg-gradient-to-br from-[#3a1f0a] via-[#59300e] to-[#241205] text-[#ffe9be] text-xs font-bold shadow-md hover:border-[#ffd88a]/60 active:scale-95 transition-all"
                  title="Open Driver Wallet & Instant Payouts"
                >
                  <Wallet className="h-3.5 w-3.5 text-[#ffd88a] shrink-0" />
                  <span className="console-readout text-[11px] sm:text-xs text-[#ffd88a]">
                    {formatPaise(walletBalance?.availablePaise ?? effectiveNetEarningsPaise)}
                  </span>
                </button>

                {/* Bank & UPI Modal Trigger */}
                <button
                  type="button"
                  onClick={() => setIsBankDetailsOpen(true)}
                  className="grid h-9 w-9 sm:h-10 sm:w-10 place-items-center rounded-xl border border-[#7a4416]/25 bg-[#fffaf0] text-[#3a1f0a] hover:bg-[#fff4dc] active:scale-95 transition-all shadow-2xs"
                  aria-label="Bank & UPI Details"
                  title="Bank & UPI Payout Settings"
                >
                  <Building2 className="h-4 w-4 text-[#b8722c]" />
                </button>

                {/* Dual-Role Passenger Switch */}
                {user?.roles?.includes("RIDER") && (
                  <button
                    type="button"
                    onClick={() => navigate("/dashboard")}
                    className="hidden sm:flex items-center gap-1.5 h-9 sm:h-10 px-3 rounded-xl border border-[#7a4416]/25 bg-[#fffaf0] text-[#3a1f0a] hover:bg-[#fff4dc] active:scale-95 transition-all shadow-2xs text-xs font-bold"
                    title="Switch to Passenger Mode"
                  >
                    <Navigation className="h-3.5 w-3.5 text-[#b8722c]" />
                    <span className="hidden lg:inline">Rider Mode</span>
                  </button>
                )}

                {/* Sign Out */}
                <button
                  type="button"
                  onClick={() =>
                    void logout().finally(() => navigate("/login", { replace: true }))
                  }
                  className="grid h-9 w-9 sm:h-10 sm:w-10 place-items-center rounded-xl border border-rose-500/30 bg-rose-950/15 text-rose-900 hover:bg-rose-950/25 active:scale-95 transition-all"
                  aria-label="Logout"
                  title="Sign out"
                >
                  <LogOut className="h-4 w-4 text-rose-800" />
                </button>
              </div>
            </div>

            {/* Mobile/Tablet Segmented Navigation Dock (Hidden on XL+) */}
            <nav
              aria-label="Driver Console Sections Mobile"
              className="grid grid-cols-5 xl:hidden gap-1 rounded-xl border border-[#7a4416]/15 bg-[#fffaf0]/90 p-1 shadow-inner"
            >
              {NAV_TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                const TabIcon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => handleSelectTab(tab.id)}
                    className={`relative flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 px-1 rounded-lg text-[10px] sm:text-xs font-bold transition-colors ${
                      isActive
                        ? "text-[#ffe9be]"
                        : "text-[#6b3a12] hover:bg-[#fff4dc]/80 hover:text-[#2e1808]"
                    }`}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="driverCockpitNavMobile"
                        transition={{ type: "spring", stiffness: 400, damping: 32 }}
                        className="pointer-events-none absolute inset-0 rounded-lg bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#241205] shadow-sm"
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-1">
                      <TabIcon
                        className={`h-3.5 w-3.5 shrink-0 ${
                          isActive
                            ? "text-[#ffd88a]"
                            : tab.id === "ratings"
                              ? "text-amber-500 fill-amber-500"
                              : "text-[#b8722c]"
                        }`}
                      />
                      <span className="truncate">{tab.shortLabel}</span>
                      {tab.pulse && (
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                      )}
                    </span>
                  </button>
                );
              })}
            </nav>
          </motion.div>
        </header>

        {/* System Error Banner */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              className="w-full flex items-center justify-between gap-3 rounded-2xl border border-rose-500/40 bg-rose-950/20 px-4 sm:px-5 py-3 text-xs sm:text-sm text-rose-950 shadow-md backdrop-blur-md"
            >
              <div className="flex items-center gap-3 min-w-0">
                <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5 shrink-0 text-rose-700" />
                <span className="font-semibold break-words">{error}</span>
              </div>
              <button
                type="button"
                onClick={() => setError("")}
                aria-label="Dismiss"
                className="rounded-lg p-1.5 hover:bg-rose-500/15 transition-colors shrink-0"
              >
                <X className="h-4 w-4 text-rose-900" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* =====================================================================
            2. UNIFIED 4-TILE BENTO TELEMETRY RIBBON (Clean, Non-Redundant KPIs)
           ===================================================================== */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 w-full">
          {/* Tile 1: Interactive Dispatch Status */}
          <div
            className={`relative overflow-hidden rounded-[1.5rem] border p-4 sm:p-5 shadow-md backdrop-blur-xl transition-all ${
              driverStatus === "AVAILABLE"
                ? "border-emerald-600/45 bg-gradient-to-br from-[#fffdf9]/95 via-[#f2fbf6]/90 to-[#dff5e8]/90"
                : driverStatus === "BUSY"
                  ? "border-amber-600/45 bg-gradient-to-br from-[#fffdf9]/95 via-[#fff6e5]/90 to-[#fbe6c2]/90"
                  : "border-[#c58a3a]/35 bg-gradient-to-br from-[#fffdf9]/95 via-[#fff6e5]/90 to-[#f5dfb5]/90"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.14em] text-[#7a4416]">
                Radar Telemetry
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                  driverStatus === "AVAILABLE"
                    ? "bg-emerald-950/15 text-emerald-900 border border-emerald-600/30"
                    : driverStatus === "BUSY"
                      ? "bg-amber-950/15 text-amber-900 border border-amber-600/30"
                      : "bg-[#3a1f0a]/10 text-[#3a1f0a]"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${statusDotColor}`} />
                {driverStatus}
              </span>
            </div>
            <div className="mt-3 flex items-end justify-between gap-2">
              <div>
                <p className="console-display text-lg sm:text-xl font-black text-[#2e1808]">
                  {driverStatus === "AVAILABLE"
                    ? "Broadcasting"
                    : driverStatus === "BUSY"
                      ? "In Mission"
                      : "Standby"}
                </p>
                <p className="text-[11px] font-medium text-[#6b3a12] mt-0.5 truncate">
                  {driverLocation
                    ? `${driverLocation.latitude.toFixed(3)}°N, ${driverLocation.longitude.toFixed(3)}°E`
                    : "Awaiting GPS lock"}
                </p>
              </div>
              <button
                type="button"
                onClick={handleToggleAvailability}
                disabled={driverStatus === "BUSY"}
                className="rounded-xl bg-[#3a1f0a] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#ffd88a] shadow-xs hover:opacity-90 disabled:opacity-50"
              >
                {driverStatus === "AVAILABLE" ? "Pause" : "Scan"}
              </button>
            </div>
          </div>

          {/* Tile 2: Net Earnings & Payout Vault */}
          <div
            onClick={() => setIsWalletOpen(true)}
            className="group cursor-pointer relative overflow-hidden rounded-[1.5rem] border border-[#c58a3a]/35 bg-gradient-to-br from-[#fffdf9]/95 via-[#fff6e5]/90 to-[#f5dfb5]/90 p-4 sm:p-5 shadow-md backdrop-blur-xl hover:border-[#b8722c] transition-all"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.14em] text-[#7a4416]">
                Net Earnings
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#3a1f0a] to-[#5c3211] text-[#ffd88a] shadow-xs group-hover:scale-105 transition-transform">
                <Wallet className="h-3.5 w-3.5" />
              </div>
            </div>
            <p className="mt-2.5 console-display text-xl sm:text-2xl font-black text-[#2e1808] console-readout">
              {formatPaise(effectiveNetEarningsPaise)}
            </p>
            <div className="mt-1 flex items-center justify-between text-[11px] font-semibold text-[#6b3a12]">
              <span>80% Captain Share</span>
              <span className="inline-flex items-center text-[#b8722c] font-bold group-hover:translate-x-0.5 transition-transform">
                Payouts <ChevronRight className="h-3 w-3" />
              </span>
            </div>
          </div>

          {/* Tile 3: Completed Trips & Distance */}
          <div
            onClick={() => handleSelectTab("history")}
            className="group cursor-pointer relative overflow-hidden rounded-[1.5rem] border border-[#c58a3a]/35 bg-gradient-to-br from-[#fffdf9]/95 via-[#fff6e5]/90 to-[#f5dfb5]/90 p-4 sm:p-5 shadow-md backdrop-blur-xl hover:border-[#b8722c] transition-all"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.14em] text-[#7a4416]">
                Completed Trips
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#3a1f0a] to-[#5c3211] text-[#ffd88a] shadow-xs group-hover:scale-105 transition-transform">
                <RouteIcon className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <p className="console-display text-xl sm:text-2xl font-black text-[#2e1808] console-readout">
                {effectiveCompletedTrips}
              </p>
              <span className="text-xs font-bold text-emerald-900 console-readout">
                ({effectiveAcceptanceRate}% rate)
              </span>
            </div>
            <p className="mt-1 text-[11px] font-semibold text-[#6b3a12] truncate">
              {formatDistance(effectiveTotalDistanceKm)} total navigated
            </p>
          </div>

          {/* Tile 4: Captain Rating & Driver ID */}
          <div
            onClick={() => handleSelectTab("ratings")}
            className="group cursor-pointer relative overflow-hidden rounded-[1.5rem] border border-[#c58a3a]/35 bg-gradient-to-br from-[#fffdf9]/95 via-[#fff6e5]/90 to-[#f5dfb5]/90 p-4 sm:p-5 shadow-md backdrop-blur-xl hover:border-[#b8722c] transition-all"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.14em] text-[#7a4416]">
                Captain Standing
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#3a1f0a] to-[#5c3211] text-[#ffd88a] shadow-xs">
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              </div>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <p className="console-display text-xl sm:text-2xl font-black text-[#2e1808] console-readout">
                {effectiveTotalRatings > 0 ? effectiveAverage.toFixed(2) : "New"}
              </p>
              <span className="text-xs font-semibold text-[#7a4416]">
                • {effectiveTotalRatings} {effectiveTotalRatings === 1 ? "review" : "reviews"}
              </span>
            </div>
            <div
              onClick={(e) => {
                e.stopPropagation();
                if (profile?.id) {
                  navigator.clipboard.writeText(profile.id);
                  setCopiedId(true);
                  setTimeout(() => setCopiedId(false), 2000);
                }
              }}
              className="mt-1 inline-flex items-center gap-1.5 text-[10.5px] console-readout font-bold text-[#3a1f0a] hover:text-[#b8722c]"
              title="Copy Driver ID"
            >
              <span>ID: #{profile?.id?.slice(-6) || "DRIVER"}</span>
              {copiedId ? (
                <Check className="h-3 w-3 text-emerald-700" />
              ) : (
                <Copy className="h-3 w-3 opacity-70" />
              )}
            </div>
          </div>
        </section>

        {/* =====================================================================
            3. TAB WORKSPACE CONTAINER
           ===================================================================== */}
        <div className="relative w-full min-h-[620px]">
          {/* -------------------------------------------------------------------
              TAB 1: LIVE RADAR & DISPATCH CONSOLE (5 / 7 Split-Screen)
             ------------------------------------------------------------------- */}
          <div
            className={
              activeTab === "console"
                ? "block space-y-5 animate-in fade-in duration-200"
                : "hidden"
            }
          >
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 sm:gap-6 items-stretch">
              {/* LEFT COLUMN (5 Cols): Active Mission Deck OR Radar Scanner */}
              <section className="xl:col-span-5 flex flex-col justify-between overflow-hidden rounded-[2rem] border border-[#fff4dc]/85 bg-gradient-to-b from-[#fffdf9]/95 via-[#fff4dc]/92 to-[#f7e2b8]/92 p-5 sm:p-7 shadow-2xl backdrop-blur-2xl relative">
                <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

                <div className="flex-1 flex flex-col">
                  {/* Card Header */}
                  <div className="flex items-center justify-between gap-3 border-b border-[#7a4416]/15 pb-4 mb-5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#3a1f0a] text-[#ffd88a] shadow-xs">
                        <Radio className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <h2 className="console-display truncate text-base sm:text-lg font-black text-[#2e1808]">
                          {currentRide ? "Active Mission Control" : "Geospatial Dispatch Radar"}
                        </h2>
                        <p className="truncate text-xs font-medium text-[#7a4416]">
                          {statusConfig
                            ? statusConfig.description
                            : driverStatus === "AVAILABLE"
                              ? "Listening for proximity-matched passenger requests"
                              : "Switch radar to Online to receive ride offers"}
                        </p>
                      </div>
                    </div>

                    {statusConfig && (
                      <span
                        className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold shadow-xs ${statusConfig.badge}`}
                      >
                        {statusConfig.label}
                      </span>
                    )}
                  </div>

                  {/* Mission Body */}
                  <AnimatePresence mode="wait">
                    {!currentRide ? (
                      <motion.div
                        key="idle-radar-deck"
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        className="flex-1 flex flex-col items-center justify-between py-4 text-center"
                      >
                        {/* Concentric Radar Sweep Graphic */}
                        <div className="relative my-4 flex h-36 w-36 items-center justify-center">
                          <div className="absolute inset-0 rounded-full border border-[#7a4416]/20 bg-[#fffaf0]/50" />
                          <div className="absolute inset-4 rounded-full border border-dashed border-[#b8722c]/35" />
                          {driverStatus === "AVAILABLE" && (
                            <>
                              <span className="pointer-events-none absolute inset-0 rounded-full border-2 border-emerald-500/40 animate-radar-ring-1" />
                              <span className="pointer-events-none absolute inset-2 rounded-full border border-[#b8722c]/45 animate-radar-ring-2" />
                              <div
                                className="pointer-events-none absolute inset-2 rounded-full animate-radar-sweep"
                                style={{
                                  background:
                                    "conic-gradient(from 0deg, transparent 70%, rgba(16, 185, 129, 0.22) 100%)",
                                }}
                              />
                            </>
                          )}
                          <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#5c3211] to-[#241205] text-[#ffd88a] shadow-xl border border-[#c58a3a]/50">
                            <Navigation
                              className={`h-7 w-7 text-[#ffd88a] ${
                                driverStatus === "AVAILABLE" ? "animate-pulse" : ""
                              }`}
                            />
                          </div>
                        </div>

                        <div className="max-w-sm space-y-1.5">
                          <h3 className="console-display text-lg sm:text-xl font-black text-[#2e1808]">
                            {driverStatus === "AVAILABLE"
                              ? "Scanning Kolkata Sector…"
                              : "Radar Transceiver Standby"}
                          </h3>
                          <p className="text-xs font-medium text-[#7a4416] leading-relaxed">
                            {driverStatus === "AVAILABLE"
                              ? "Your coordinates are indexed in Redis Geo. Incoming passenger dispatches will lock onto this console automatically."
                              : "You are currently hidden from passenger dispatch. Engage your radar below when ready to accept trips."}
                          </p>
                        </div>

                        {/* 4-Point Pre-Flight Telemetry Checklist */}
                        <div className="mt-6 w-full grid grid-cols-2 gap-2.5 text-left">
                          {[
                            {
                              label: "GPS Transceiver",
                              status: driverLocation ? "Locked" : "Acquiring",
                              ok: Boolean(driverLocation),
                            },
                            {
                              label: "Dispatch Socket",
                              status: driverStatus !== "OFFLINE" ? "Connected" : "Standby",
                              ok: driverStatus !== "OFFLINE",
                            },
                            {
                              label: "RTO Credentials",
                              status: "4/4 Verified",
                              ok: true,
                            },
                            {
                              label: "Payout Channel",
                              status:
                                profile?.upiId || profile?.accountNumber ? "Linked" : "Setup Needed",
                              ok: Boolean(profile?.upiId || profile?.accountNumber),
                            },
                          ].map((item) => (
                            <div
                              key={item.label}
                              className="flex items-center justify-between rounded-xl border border-[#7a4416]/15 bg-[#fffdf9]/90 px-3 py-2.5 shadow-2xs"
                            >
                              <div className="min-w-0">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-[#7a4416] truncate">
                                  {item.label}
                                </p>
                                <p className="text-xs font-extrabold text-[#2e1808] mt-0.5">
                                  {item.status}
                                </p>
                              </div>
                              <span
                                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                                  item.ok ? "bg-emerald-500" : "bg-amber-500 animate-pulse"
                                }`}
                              />
                            </div>
                          ))}
                        </div>

                        {/* Master CTA Button */}
                        <Button
                          onClick={handleToggleAvailability}
                          className={`mt-5 h-12 w-full rounded-2xl text-xs font-bold uppercase tracking-wider shadow-lg transition-all active:scale-[0.98] ${
                            driverStatus === "AVAILABLE"
                              ? "border border-[#7a4416]/35 bg-[#fffaf0] text-[#3a1f0a] hover:bg-[#fff4dc]"
                              : "bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#241205] text-[#ffe9be] border border-[#c58a3a]/50"
                          }`}
                        >
                          <Power className="mr-2 h-4 w-4" />
                          {driverStatus === "AVAILABLE"
                            ? "Pause Radar & Go Standby"
                            : "Engage Radar & Go Online"}
                        </Button>
                      </motion.div>
                    ) : (
                      <motion.div
                        key={currentRide.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="w-full space-y-4"
                      >
                        <RideStepper status={currentRide.status} />

                        {/* Route Pickup & Drop-off Timeline Box */}
                        <div className="w-full rounded-2xl border border-[#7a4416]/25 bg-[#fffdf9] p-4 shadow-xs">
                          <div className="flex gap-3.5">
                            <div className="flex shrink-0 flex-col items-center pt-1.5">
                              <span className="h-3 w-3 rounded-full bg-emerald-600 ring-4 ring-emerald-500/20" />
                              <span className="my-1.5 h-10 w-0.5 border-l-2 border-dashed border-[#b8722c]/60" />
                              <MapPin className="h-4 w-4 text-rose-600" />
                            </div>
                            <div className="flex-1 space-y-3 min-w-0">
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-800">
                                  Pickup Point
                                </p>
                                <p className="text-xs sm:text-sm font-bold text-[#2e1808] mt-0.5 break-words">
                                  {currentRide.pickup.address}
                                </p>
                              </div>
                              <div className="border-t border-[#7a4416]/10 pt-2.5">
                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-rose-800">
                                  Destination Drop-Off
                                </p>
                                <p className="text-xs sm:text-sm font-bold text-[#2e1808] mt-0.5 break-words">
                                  {currentRide.destination.address}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* 4-Tile Trip Metrics Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                          <div className="rounded-xl border border-[#7a4416]/20 bg-[#fffdf9] p-3">
                            <span className="text-[9.5px] font-bold uppercase tracking-wider text-[#7a4416]">
                              {liveDriverMetrics?.distanceLabel ?? "Distance"}
                            </span>
                            <p className="mt-1 text-sm font-black text-[#2e1808] console-readout">
                              {liveDriverMetrics?.distanceValue ?? (distance != null ? formatDistance(distance) : "--")}
                            </p>
                          </div>
                          <div className="rounded-xl border border-[#7a4416]/20 bg-[#fffdf9] p-3">
                            <span className="text-[9.5px] font-bold uppercase tracking-wider text-[#7a4416]">
                              {liveDriverMetrics?.timeLabel ?? "Est. Time"}
                            </span>
                            <p className="mt-1 text-sm font-black text-[#2e1808] console-readout">
                              {liveDriverMetrics?.timeValue ?? (duration != null ? formatDuration(duration) : "--")}
                            </p>
                          </div>
                          <div className="rounded-xl border border-[#7a4416]/20 bg-[#fffdf9] p-3">
                            <span className="text-[9.5px] font-bold uppercase tracking-wider text-[#7a4416]">
                              Your Payout
                            </span>
                            <p className="mt-1 text-sm font-black text-emerald-900 console-readout">
                              {fare != null ? formatPaise(fare) : "--"}
                            </p>
                          </div>
                          <div className="rounded-xl border border-[#7a4416]/20 bg-[#fffdf9] p-3">
                            <span className="text-[9.5px] font-bold uppercase tracking-wider text-[#7a4416]">
                              Settlement
                            </span>
                            <p
                              className={`mt-1 inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                                paymentInfo?.badge ??
                                "text-[#3a1f0a] bg-[#7a4416]/15 border border-[#7a4416]/30"
                              }`}
                            >
                              {paymentInfo?.label ?? "--"}
                            </p>
                          </div>
                        </div>

                        {/* Stage-Specific Mission Controls */}
                        <div className="space-y-3 pt-1">
                          {currentRide.status === "SEARCHING" && (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                              <Button
                                onClick={() => handleAcceptRide(currentRide.id)}
                                disabled={isAcceptingRide}
                                className="sm:col-span-2 bg-gradient-to-br from-emerald-800 via-emerald-900 to-emerald-950 text-emerald-50 border border-emerald-400/40 h-12 rounded-xl font-bold shadow-lg"
                              >
                                {isAcceptingRide ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="mr-2 h-4 w-4" />
                                )}
                                {isAcceptingRide ? "Accepting…" : "Accept Dispatch"}
                              </Button>
                              <Button
                                onClick={() => handleRejectRide(currentRide.id)}
                                variant="outline"
                                className="border-rose-500/35 bg-rose-950/15 text-rose-950 hover:bg-rose-950/25 h-12 rounded-xl font-bold"
                              >
                                <X className="mr-1.5 h-4 w-4" /> Decline
                              </Button>
                            </div>
                          )}

                          {currentRide.status === "DRIVER_ASSIGNED" && (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                              <Button
                                onClick={() =>
                                  sendRideAction(DriverEvents.ARRIVED_AT_PICKUP, currentRide.id)
                                }
                                className="sm:col-span-2 bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffe9be] border border-[#c58a3a]/50 h-12 rounded-xl font-bold shadow-md"
                              >
                                <MapPin className="mr-2 h-4 w-4 text-[#ffd88a]" /> Arrived at Pickup
                              </Button>
                              <Button
                                onClick={() => handleCancelRide(currentRide.id)}
                                variant="outline"
                                className="border-rose-500/35 bg-rose-950/15 text-rose-950 hover:bg-rose-950/25 h-12 rounded-xl font-bold"
                              >
                                <X className="mr-1.5 h-4 w-4" /> Cancel
                              </Button>
                            </div>
                          )}

                          {currentRide.status === "DRIVER_ARRIVING" && (
                            <div className="space-y-3 rounded-2xl border-2 border-[#c58a3a]/50 bg-[#fffaf0] p-4 shadow-inner">
                              <label className="block space-y-2">
                                <span className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[#3a1f0a]">
                                  <span>Boarding 4-Digit PIN</span>
                                  <span className="text-[10px] font-semibold text-[#7a4416]">
                                    Ask passenger for PIN
                                  </span>
                                </span>
                                <input
                                  aria-label="Trip start OTP"
                                  autoComplete="one-time-code"
                                  className="h-12 w-full rounded-xl border-2 border-[#7a4416]/30 bg-[#fffdf9] px-4 text-center console-readout text-xl font-black tracking-[0.6em] text-[#2e1808] outline-none transition-all focus:border-[#3a1f0a] focus:ring-4 focus:ring-[#c58a3a]/25"
                                  inputMode="numeric"
                                  maxLength={4}
                                  onChange={(event) =>
                                    setTripOtp(event.target.value.replace(/\D/gu, "").slice(0, 4))
                                  }
                                  placeholder="••••"
                                  value={tripOtp}
                                />
                              </label>
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                                <Button
                                  onClick={() => handleStartRide(currentRide.id)}
                                  disabled={tripOtp.length !== 4 || isStartingRide}
                                  className="sm:col-span-2 bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffe9be] border border-[#c58a3a]/50 h-12 rounded-xl font-bold shadow-md"
                                >
                                  {isStartingRide ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  ) : (
                                    <ChevronRight className="mr-2 h-4 w-4" />
                                  )}
                                  {isStartingRide ? "Verifying…" : "Verify & Start Trip"}
                                </Button>
                                <Button
                                  onClick={() => handleCancelRide(currentRide.id)}
                                  variant="outline"
                                  className="border-rose-500/35 bg-rose-950/15 text-rose-950 hover:bg-rose-950/25 h-12 rounded-xl font-bold"
                                >
                                  <X className="mr-1.5 h-4 w-4" /> Cancel
                                </Button>
                              </div>
                            </div>
                          )}

                          {currentRide.status === "RIDE_STARTED" && (
                            <Button
                              onClick={() =>
                                sendRideAction(
                                  DriverEvents.ARRIVED_AT_DESTINATION,
                                  currentRide.id
                                )
                              }
                              className="w-full bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffe9be] border border-[#c58a3a]/50 h-12 rounded-xl font-bold shadow-md"
                            >
                              <MapPin className="mr-2 h-4 w-4 text-[#ffd88a]" /> Mark Arrived at
                              Destination
                            </Button>
                          )}

                          {currentRide.status === "ARRIVED_AT_DESTINATION" && (
                            <Button
                              onClick={() =>
                                sendRideAction(DriverEvents.COMPLETE_RIDE, currentRide.id)
                              }
                              disabled={!canCompleteCurrentRide}
                              className="w-full bg-gradient-to-br from-emerald-800 via-emerald-900 to-emerald-950 text-emerald-50 border border-emerald-400/40 h-12 rounded-xl font-bold shadow-lg disabled:opacity-50"
                            >
                              <CheckCircle2 className="mr-2 h-4 w-4" />
                              {canCompleteCurrentRide
                                ? "Complete Trip & Settle Ledger"
                                : "Awaiting Rider Payment Capture…"}
                            </Button>
                          )}
                        </div>

                        {/* Audited Fare Split */}
                        {breakdownData && (
                          <div className="rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9]/95 p-3.5 shadow-2xs">
                            <div className="flex items-center justify-between mb-2.5 pb-1.5 border-b border-[#7a4416]/10">
                              <span className="text-[10px] font-black uppercase tracking-[0.16em] text-[#7a4416]">
                                Audited Fare Split
                              </span>
                              <span className="text-[10px] font-bold text-[#6b3a12] console-readout">
                                Gross: {formatPaise(totalTripFare || breakdownData.totalPaise)}
                              </span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-xs">
                              <div className="rounded-lg bg-[#fffaf0] p-2 border border-[#7a4416]/10">
                                <span className="text-[9px] uppercase font-bold text-[#7a4416]">
                                  Base + Dist
                                </span>
                                <p className="console-readout font-bold text-[#2e1808] mt-0.5">
                                  {formatPaise(
                                    (breakdownData.baseFarePaise || 0) +
                                      (breakdownData.distanceFarePaise || 0)
                                  )}
                                </p>
                              </div>
                              <div className="rounded-lg bg-[#fffaf0] p-2 border border-[#7a4416]/10">
                                <span className="text-[9px] uppercase font-bold text-[#7a4416]">
                                  Platform Fee
                                </span>
                                <p className="console-readout font-bold text-rose-800 mt-0.5">
                                  -{formatPaise(breakdownData.platformCommissionPaise)}
                                </p>
                              </div>
                              <div className="rounded-lg bg-emerald-950/10 p-2 border border-emerald-600/25">
                                <span className="text-[9px] uppercase font-bold text-emerald-900">
                                  Net Payout
                                </span>
                                <p className="console-readout font-black text-emerald-950 mt-0.5">
                                  {formatPaise(breakdownData.driverEarningPaise)}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}

                        {currentRide.status === "CANCELLED" && (
                          <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-500/35 bg-rose-950/15 p-3.5 text-xs font-semibold text-rose-950">
                            <span>
                              Cancelled
                              {currentRide.cancelledBy
                                ? ` by ${currentRide.cancelledBy.toLowerCase()}`
                                : ""}
                              .
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setCurrentRide(null)}
                              className="border-[#7a4416]/30 bg-[#fffaf0] text-[#3a1f0a] rounded-xl font-bold"
                            >
                              Back to Radar
                            </Button>
                          </div>
                        )}

                        {currentRide.status === "COMPLETED" && (
                          <div className="rounded-2xl border border-emerald-600/35 bg-emerald-950/15 p-5 text-center">
                            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-900">
                              Trip Settled & Credited
                            </p>
                            <p className="mt-1 text-2xl font-black text-emerald-950 console-readout">
                              {breakdownData
                                ? formatPaise(breakdownData.driverEarningPaise)
                                : fare != null
                                  ? formatPaise(fare)
                                  : "₹0.00"}
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setCurrentRide(null)}
                              className="mt-3 border-emerald-600/35 bg-[#fffaf0] text-emerald-950 rounded-xl font-bold px-5"
                            >
                              Return to Radar
                            </Button>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </section>

              {/* RIGHT COLUMN (7 Cols): Expansive Telemetry Map Canvas */}
              <section className="xl:col-span-7 flex flex-col overflow-hidden rounded-[2rem] border border-[#fff4dc]/85 bg-[#fffaf0] shadow-2xl relative min-h-[380px] sm:min-h-[520px] xl:min-h-[600px]">
                {/* Floating Top Map HUD */}
                <div className="pointer-events-none absolute top-4 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 rounded-2xl border border-[#fff4dc]/80 bg-[#2e1808]/90 px-4 py-2 text-xs font-bold text-[#ffe9be] shadow-lg backdrop-blur-md">
                    <span className={`h-2 w-2 rounded-full ${statusDotColor}`} />
                    <span>Live Vector Telemetry</span>
                  </div>

                  {driverLocation && (
                    <div className="rounded-2xl border border-[#fff4dc]/80 bg-[#fffdf9]/90 px-3.5 py-2 text-[11px] console-readout font-bold text-[#2e1808] shadow-lg backdrop-blur-md">
                      {driverLocation.latitude.toFixed(4)}° N,{" "}
                      {driverLocation.longitude.toFixed(4)}° E
                    </div>
                  )}
                </div>

                {/* Map Instance */}
                <div className="relative flex-1 w-full h-full min-h-[380px]">
                  <MapView
                    center={mapCenter}
                    zoom={13}
                    markers={mapMarkers}
                    path={
                      currentRide && routePolyline?.rideId === currentRide.id
                        ? routePolyline.points
                        : []
                    }
                  />
                </div>

                {/* Floating Bottom Map Legend HUD */}
                <div className="pointer-events-none absolute bottom-4 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#fff4dc]/70 bg-[#2e1808]/90 px-4 py-2 text-[11px] font-semibold text-[#ffe9be] shadow-lg backdrop-blur-md">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-sky-400" /> DR: Captain
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-emerald-400" /> P: Pickup
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-rose-400" /> D: Drop-Off
                    </span>
                  </div>
                </div>
              </section>
            </div>
          </div>

          {/* -------------------------------------------------------------------
              TAB 2: AUDITED TRIP LEDGER & RIDE HISTORY
             ------------------------------------------------------------------- */}
          {activeTab === "history" && (
            <motion.div
              key="tab-history"
              variants={tabPanelVariants}
              initial="hidden"
              animate="visible"
              className="w-full space-y-5"
            >
              {historyLoading ? (
                <TabTelemetryLoader
                  title="Synchronizing Driver Trip Ledger…"
                  subtitle="Fetching audited dispatches, route metrics, and settled payouts."
                  cardCount={3}
                />
              ) : (
                <div className="rounded-[2rem] border border-[#fff4dc]/85 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-5 sm:p-8 shadow-xl backdrop-blur-2xl relative">
                  <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

                  {/* Header & Filter Bar */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 border-b border-[#7a4416]/15 pb-5 mb-6">
                    <div>
                      <h2 className="console-display text-xl sm:text-2xl font-black text-[#2e1808]">
                        Audited Trip Ledger & Dispatch Log
                      </h2>
                      <p className="text-xs text-[#7a4416] mt-0.5">
                        Complete record of passenger dispatches, route distances, and net 80%
                        driver settlements.
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      {(["ALL", "COMPLETED", "CANCELLED"] as const).map((filter) => (
                        <button
                          key={filter}
                          type="button"
                          onClick={() => setHistoryFilter(filter)}
                          className={`flex-1 sm:flex-initial px-3.5 py-2 rounded-xl text-xs font-bold transition-all shadow-2xs ${
                            historyFilter === filter
                              ? "bg-gradient-to-br from-[#3a1f0a] to-[#6b3a12] text-[#ffd88a]"
                              : "border border-[#7a4416]/20 bg-[#fffaf0] text-[#6b3a12] hover:bg-[#fff4dc]"
                          }`}
                        >
                          {filter === "ALL"
                            ? `All (${rideHistory.length})`
                            : filter === "COMPLETED"
                              ? `Completed (${completedRides.length})`
                              : "Cancelled"}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => void loadDriverHistory()}
                        disabled={historyLoading}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#7a4416]/20 bg-[#fffaf0] text-[#3a1f0a] hover:bg-[#fff4dc] active:scale-95 transition-all"
                        title="Refresh Ledger"
                      >
                        <RefreshCw
                          className={`h-4 w-4 text-[#b8722c] ${
                            historyLoading ? "animate-spin" : ""
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Filtered List */}
                  {rideHistory.filter(
                    (r) => historyFilter === "ALL" || r.status === historyFilter
                  ).length === 0 ? (
                    <div className="py-14 text-center rounded-2xl border border-dashed border-[#7a4416]/25 bg-[#fffaf0]/60 p-6">
                      <History className="mx-auto h-10 w-10 text-[#7a4416]/70" />
                      <h3 className="console-display mt-3 text-base font-bold text-[#2e1808]">
                        No matching dispatches found
                      </h3>
                      <p className="mt-1 text-xs text-[#7a4416] max-w-md mx-auto">
                        Switch to the Radar tab and go online to receive live passenger ride
                        requests.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3.5">
                      {rideHistory
                        .filter((r) => historyFilter === "ALL" || r.status === historyFilter)
                        .map((ride) => {
                          const isCompleted = ride.status === "COMPLETED";
                          const isCancelled = ride.status === "CANCELLED";
                          const earningPaise =
                            ride.fare?.breakdown?.driverEarningPaise ??
                            (ride.fare?.final
                              ? Math.round(ride.fare.final * 0.8)
                              : ride.fare?.estimated
                                ? Math.round(ride.fare.estimated * 0.8)
                                : 0);
                          const tripDate = new Date(ride.createdAt).toLocaleString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          });

                          return (
                            <motion.div
                              key={ride.id}
                              variants={cardAppearVariants}
                              className="relative overflow-hidden rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9] p-4 sm:p-5 shadow-xs hover:border-[#b8722c]/60 transition-all"
                            >
                              {/* Left Status Spine */}
                              <div
                                className={`absolute left-0 top-0 bottom-0 w-1.5 ${
                                  isCompleted
                                    ? "bg-emerald-600"
                                    : isCancelled
                                      ? "bg-rose-600"
                                      : "bg-amber-500"
                                }`}
                              />

                              <div className="pl-2 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div className="space-y-2.5 min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="console-readout text-xs font-bold text-[#3a1f0a] bg-[#3a1f0a]/10 px-2 py-0.5 rounded-md">
                                      #{ride.id.slice(0, 8)}
                                    </span>
                                    <span
                                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                        isCompleted
                                          ? "bg-emerald-950/15 text-emerald-900 border border-emerald-500/30"
                                          : isCancelled
                                            ? "bg-rose-950/15 text-rose-900 border border-rose-500/30"
                                            : "bg-amber-950/15 text-amber-900 border border-amber-500/30"
                                      }`}
                                    >
                                      {ride.status}
                                    </span>
                                    <span className="text-xs font-medium text-[#7a4416]">
                                      • {tripDate}
                                    </span>
                                  </div>

                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                                    <div className="flex items-start gap-2 min-w-0">
                                      <span className="mt-1 h-2 w-2 rounded-full bg-emerald-600 shrink-0" />
                                      <div className="min-w-0">
                                        <p className="text-[9.5px] font-bold uppercase tracking-wider text-[#7a4416]">
                                          Pickup
                                        </p>
                                        <p className="text-xs font-semibold text-[#2e1808] truncate">
                                          {ride.pickup.address}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="flex items-start gap-2 min-w-0">
                                      <span className="mt-1 h-2 w-2 rounded-full bg-rose-600 shrink-0" />
                                      <div className="min-w-0">
                                        <p className="text-[9.5px] font-bold uppercase tracking-wider text-[#7a4416]">
                                          Destination
                                        </p>
                                        <p className="text-xs font-semibold text-[#2e1808] truncate">
                                          {ride.destination.address}
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* Right Payout & Telemetry Box */}
                                <div className="flex md:flex-col items-center md:items-end justify-between gap-2 border-t md:border-t-0 md:border-l border-[#7a4416]/15 pt-3 md:pt-0 md:pl-5 shrink-0">
                                  <div className="text-left md:text-right">
                                    <span className="text-[9.5px] font-bold uppercase tracking-wider text-[#7a4416]">
                                      Net Payout
                                    </span>
                                    <p className="text-lg font-black text-emerald-900 console-readout">
                                      {formatFare(earningPaise)}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-1.5 text-[11px] console-readout font-semibold text-[#6b3a12]">
                                    <span>{formatDistance(ride.distance)}</span>
                                    <span>•</span>
                                    <span>{formatDuration(ride.duration)}</span>
                                  </div>
                                </div>
                              </div>

                              {ride.ratings && ride.ratings.length > 0 && (
                                <div className="mt-3 ml-2 pt-2.5 border-t border-[#7a4416]/10 flex items-center gap-2.5 text-xs">
                                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 font-black text-amber-900 console-readout">
                                    <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                                    {ride.ratings[0].score}.0
                                  </span>
                                  {ride.ratings[0].feedback && (
                                    <span className="italic text-[#3a1f0a] truncate">
                                      "{ride.ratings[0].feedback}"
                                    </span>
                                  )}
                                </div>
                              )}
                            </motion.div>
                          );
                        })}
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {/* -------------------------------------------------------------------
              TAB 3: RATINGS & PASSENGER FEEDBACK BENTO
             ------------------------------------------------------------------- */}
          {activeTab === "ratings" && (
            <motion.div
              key="tab-ratings"
              variants={tabPanelVariants}
              initial="hidden"
              animate="visible"
              className="w-full space-y-5"
            >
              {ratingsLoading && !hasLoadedRatings ? (
                <TabTelemetryLoader
                  title="Synchronizing Captain Ratings…"
                  subtitle="Retrieving verified passenger star ratings and compliments."
                  cardCount={3}
                />
              ) : (
                <>
                  {/* Top 12-Col Bento: Score Medallion (4 Cols) + Distribution (8 Cols) */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                    <div className="lg:col-span-4 rounded-[2rem] border border-[#fff4dc]/85 bg-gradient-to-br from-[#3a1f0a] via-[#59300e] to-[#241205] p-6 sm:p-8 text-[#ffe9be] shadow-xl flex flex-col justify-between">
                      <div>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#ffd88a]/30 bg-white/10 px-3 py-1 text-[11px] font-bold text-[#ffd88a]">
                          <Award className="h-3.5 w-3.5" />
                          {effectiveTotalRatings > 0
                            ? effectiveAverage >= 4.8
                              ? "Top Tier Fleet Captain"
                              : "Verified Captain"
                            : "Newly Onboarded"}
                        </span>
                        <div className="mt-5 flex items-baseline gap-2.5">
                          <span className="console-display text-5xl sm:text-6xl font-black text-[#ffd88a] console-readout">
                            {effectiveTotalRatings > 0 ? effectiveAverage.toFixed(2) : "—"}
                          </span>
                          <span className="text-lg font-bold text-[#ffe9be]/70">/ 5.0</span>
                        </div>
                        <div className="mt-3 flex items-center gap-1">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              className={`h-5 w-5 ${
                                effectiveTotalRatings > 0 && star <= Math.round(effectiveAverage)
                                  ? "fill-amber-400 text-amber-400"
                                  : "text-white/25"
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                      <p className="mt-6 text-xs text-[#ffe9be]/80 leading-relaxed">
                        Calculated from {effectiveTotalRatings} audited passenger{" "}
                        {effectiveTotalRatings === 1 ? "review" : "reviews"} across{" "}
                        {effectiveCompletedTrips} completed trips.
                      </p>
                    </div>

                    <div className="lg:col-span-8 rounded-[2rem] border border-[#fff4dc]/85 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-6 sm:p-8 shadow-xl backdrop-blur-2xl flex flex-col justify-between">
                      <div className="flex items-center justify-between border-b border-[#7a4416]/15 pb-4 mb-4">
                        <div>
                          <h3 className="console-display text-lg font-black text-[#2e1808]">
                            Star Rating Distribution
                          </h3>
                          <p className="text-xs text-[#7a4416]">
                            Breakdown of passenger satisfaction scores
                          </p>
                        </div>
                        <Button
                          onClick={() => void loadDriverRatings()}
                          disabled={ratingsLoading}
                          variant="outline"
                          size="sm"
                          className="h-9 border-[#7a4416]/25 bg-[#fffaf0] text-[#3a1f0a] text-xs font-bold rounded-xl"
                        >
                          <RefreshCw
                            className={`mr-1.5 h-3.5 w-3.5 text-[#b8722c] ${
                              ratingsLoading ? "animate-spin" : ""
                            }`}
                          />
                          Sync
                        </Button>
                      </div>

                      <div className="space-y-3 my-auto">
                        {[5, 4, 3, 2, 1].map((stars) => {
                          const item = effectiveDistribution[stars] || { count: 0, pct: 0 };
                          return (
                            <div key={stars} className="flex items-center gap-3 text-xs">
                              <span className="w-12 font-bold text-[#3a1f0a] flex items-center gap-1 console-readout">
                                {stars} <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                              </span>
                              <div className="flex-1 h-3 rounded-full bg-[#3a1f0a]/10 overflow-hidden border border-[#7a4416]/15">
                                <motion.div
                                  initial={{ width: 0 }}
                                  animate={{ width: `${item.pct}%` }}
                                  transition={{ duration: 0.6, ease: "easeOut" }}
                                  className="h-full bg-gradient-to-r from-[#3a1f0a] via-[#b8722c] to-amber-500 rounded-full"
                                />
                              </div>
                              <span className="w-20 text-right console-readout font-bold text-[#6b3a12]">
                                {item.count} ({item.pct}%)
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Verified Rider Compliments List */}
                  <div className="rounded-[2rem] border border-[#fff4dc]/85 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-5 sm:p-8 shadow-xl backdrop-blur-2xl">
                    <div className="flex items-center justify-between border-b border-[#7a4416]/15 pb-4 mb-5">
                      <div className="flex items-center gap-2.5">
                        <MessageSquare className="h-5 w-5 text-[#b8722c]" />
                        <h3 className="console-display text-lg font-black text-[#2e1808]">
                          Passenger Compliments & Notes
                        </h3>
                      </div>
                      <span className="rounded-full bg-[#3a1f0a]/10 px-3 py-1 text-xs font-bold text-[#3a1f0a] console-readout">
                        {effectiveReviews.length} Entries
                      </span>
                    </div>

                    {effectiveReviews.length === 0 ? (
                      <div className="py-12 text-center rounded-2xl border border-dashed border-[#7a4416]/25 bg-[#fffdf9]/60">
                        <Sparkles className="mx-auto h-8 w-8 text-[#b8722c] mb-2" />
                        <p className="text-sm font-bold text-[#2e1808]">No written reviews yet</p>
                        <p className="text-xs text-[#7a4416] mt-1">
                          Passenger compliments will appear here automatically after completed
                          trips.
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {effectiveReviews.map((review, idx) => (
                          <div
                            key={review.id || idx}
                            className="rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9] p-5 shadow-xs flex flex-col justify-between"
                          >
                            <div>
                              <div className="flex items-center justify-between gap-2 mb-2.5">
                                <div className="flex items-center gap-2.5">
                                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#3a1f0a] text-[#ffd88a] font-bold text-xs">
                                    {review.passengerLabel?.[0] || "P"}
                                  </div>
                                  <div>
                                    <p className="text-xs font-bold text-[#2e1808]">
                                      {review.passengerLabel || "Verified Passenger"}
                                    </p>
                                    <p className="text-[10px] text-[#7a4416]">
                                      {review.createdAt
                                        ? new Date(review.createdAt).toLocaleDateString("en-IN", {
                                            day: "numeric",
                                            month: "short",
                                            year: "numeric",
                                          })
                                        : "Recent Trip"}
                                    </p>
                                  </div>
                                </div>
                                <span className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 px-2.5 py-1 text-xs font-black text-amber-900 console-readout">
                                  <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                                  {review.score.toFixed(1)}
                                </span>
                              </div>
                              <p className="text-xs text-[#3a1f0a] italic leading-relaxed mt-2">
                                {review.comment
                                  ? `"${review.comment}"`
                                  : `Rated ${review.score} stars for a smooth journey.`}
                              </p>
                            </div>
                            {review.destinationAddress && (
                              <p className="mt-3 pt-2.5 border-t border-[#7a4416]/10 text-[10px] font-semibold text-[#7a4416] truncate">
                                Drop-off: {review.destinationAddress}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </motion.div>
          )}

          {/* -------------------------------------------------------------------
              TAB 4: FLEET SPECS, 5-ANGLE GALLERY & RTO COMPLIANCE
             ------------------------------------------------------------------- */}
          {activeTab === "vehicle" && (
            <motion.div
              key="tab-vehicle"
              variants={tabPanelVariants}
              initial="hidden"
              animate="visible"
              className="space-y-5"
            >
              {/* Vehicle Specs + 5-Angle Inspection Studio */}
              <section className="rounded-[2rem] border border-[#fff4dc]/85 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-5 sm:p-8 shadow-xl backdrop-blur-2xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#7a4416]/15 pb-5 mb-6">
                  <div className="flex items-center gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#3a1f0a] text-[#ffd88a] shadow-md">
                      <VehicleIcon className="h-5 w-5" />
                    </span>
                    <div>
                      <h2 className="console-display text-xl font-black text-[#2e1808]">
                        {profile?.vehicle
                          ? `${profile.vehicle.brand} ${profile.vehicle.model}`
                          : "Registered Fleet Vehicle"}
                      </h2>
                      <p className="text-xs text-[#7a4416]">
                        {VEHICLE_TYPE_LABEL[vehicleType]} Class •{" "}
                        {profile?.vehicle?.color || "Standard Finish"} • Mfg{" "}
                        {profile?.vehicle?.registrationYear || "Verified"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    <span className="inline-flex items-center gap-1.5 rounded-xl border-2 border-[#3a1f0a] bg-[#ffd88a] px-3 py-1 console-readout text-xs font-black tracking-wider text-[#2e1808] shadow-xs">
                      <span className="text-[9px] text-[#7a4416]">IND</span>
                      {profile?.vehicle?.registrationNumber || "N/A"}
                    </span>
                  </div>
                </div>

                {/* 5-Angle Inspection Photo Grid */}
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#7a4416] flex items-center gap-1.5">
                    <Camera className="h-3.5 w-3.5 text-[#b8722c]" /> 5-Angle Safety Inspection
                    Gallery
                  </span>
                  <span className="text-[11px] font-medium text-[#7a4416]">
                    Tap any angle to enlarge
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
                  {[
                    {
                      key: "front",
                      label: "Front Elevation",
                      url: profile?.vehicleImages?.front,
                    },
                    {
                      key: "back",
                      label: "Rear & Plate",
                      url: profile?.vehicleImages?.back,
                    },
                    {
                      key: "left",
                      label: "Left Profile",
                      url: profile?.vehicleImages?.left,
                    },
                    {
                      key: "right",
                      label: "Right Profile",
                      url: profile?.vehicleImages?.right,
                    },
                    {
                      key: "interior",
                      label: "Cabin Interior",
                      url: profile?.vehicleImages?.interior,
                    },
                  ].map((imgItem, idx) => (
                    <div
                      key={imgItem.key}
                      onClick={() =>
                        imgItem.url &&
                        setPreviewImage({
                          url: imgItem.url,
                          title: `Vehicle ${imgItem.label}`,
                        })
                      }
                      className={`group overflow-hidden rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9] p-2.5 shadow-2xs transition-all hover:border-[#b8722c] hover:shadow-md ${
                        imgItem.url ? "cursor-pointer" : "opacity-75"
                      } ${idx === 4 ? "col-span-2 sm:col-span-1" : ""}`}
                    >
                      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-[#2e1808]/5 flex items-center justify-center">
                        {imgItem.url ? (
                          <img
                            src={imgItem.url}
                            alt={imgItem.label}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        ) : (
                          <Camera className="h-6 w-6 text-[#7a4416]/40" />
                        )}
                        {imgItem.url && (
                          <div className="absolute inset-0 grid place-items-center bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#3a1f0a]/90 px-2.5 py-1 text-[10px] font-bold text-[#ffd88a]">
                              <Eye className="h-3 w-3" /> Inspect
                            </span>
                          </div>
                        )}
                      </div>
                      <p className="mt-2 text-xs font-bold text-[#2e1808] text-center truncate">
                        {imgItem.label}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              {/* RTO & Regulatory Compliance Vault */}
              <section className="rounded-[2rem] border border-[#fff4dc]/85 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-5 sm:p-8 shadow-xl backdrop-blur-2xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#7a4416]/15 pb-4 mb-5">
                  <div className="flex items-center gap-2.5">
                    <Shield className="h-5 w-5 text-[#b8722c]" />
                    <h3 className="console-display text-lg font-black text-[#2e1808]">
                      RTO & Regulatory Compliance Vault
                    </h3>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-950/15 border border-emerald-600/30 px-3 py-1 text-xs font-bold text-emerald-900">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" /> 4/4 Credentials Active
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Driving License */}
                  {(() => {
                    const dl = profile?.documents?.drivingLicense;
                    const dlExpiry = dl?.expiryDate
                      ? new Date(dl.expiryDate)
                      : new Date(currentTime + 365 * 24 * 3600 * 1000);
                    return (
                      <div className="flex flex-col justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9] p-4 shadow-2xs">
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[#7a4416]">
                              Driving License
                            </span>
                            <FileText className="h-4 w-4 text-[#b8722c]" />
                          </div>
                          <p className="mt-2 text-sm font-black console-readout text-[#2e1808] truncate">
                            {dl?.number || "Verified on file"}
                          </p>
                          <p className="mt-1 text-[11px] text-[#6b3a12]">
                            Valid till {dlExpiry.toLocaleDateString()}
                          </p>
                        </div>
                        <div className="mt-4 flex gap-2">
                          {dl?.frontImage && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setPreviewImage({
                                  url: dl.frontImage,
                                  title: "Driving License (Front)",
                                })
                              }
                              className="flex-1 h-8 text-[11px] border-[#7a4416]/25 bg-[#fffaf0]"
                            >
                              <Eye className="mr-1 h-3 w-3 text-[#b8722c]" /> Front
                            </Button>
                          )}
                          {dl?.backImage && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setPreviewImage({
                                  url: dl.backImage,
                                  title: "Driving License (Back)",
                                })
                              }
                              className="flex-1 h-8 text-[11px] border-[#7a4416]/25 bg-[#fffaf0]"
                            >
                              <Eye className="mr-1 h-3 w-3 text-[#b8722c]" /> Back
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* RC Smart Card */}
                  {(() => {
                    const rc = profile?.documents?.registrationCertificate;
                    return (
                      <div className="flex flex-col justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9] p-4 shadow-2xs">
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[#7a4416]">
                              RC Smart Card
                            </span>
                            <Car className="h-4 w-4 text-[#b8722c]" />
                          </div>
                          <p className="mt-2 text-sm font-black console-readout text-[#2e1808] truncate">
                            {rc?.number || profile?.vehicle?.registrationNumber || "Verified"}
                          </p>
                          <p className="mt-1 text-[11px] text-[#6b3a12]">
                            State RTO • Commercial Permit
                          </p>
                        </div>
                        <div className="mt-4">
                          {rc?.image && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setPreviewImage({
                                  url: rc.image,
                                  title: "Registration Certificate (RC)",
                                })
                              }
                              className="w-full h-8 text-[11px] border-[#7a4416]/25 bg-[#fffaf0]"
                            >
                              <Eye className="mr-1 h-3 w-3 text-[#b8722c]" /> Inspect RC
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Commercial Insurance */}
                  {(() => {
                    const ins = profile?.documents?.insurance;
                    const insExpiry = ins?.expiryDate
                      ? new Date(ins.expiryDate)
                      : new Date(currentTime + 365 * 24 * 3600 * 1000);
                    return (
                      <div className="flex flex-col justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9] p-4 shadow-2xs">
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[#7a4416]">
                              Insurance Policy
                            </span>
                            <ShieldCheck className="h-4 w-4 text-[#b8722c]" />
                          </div>
                          <p className="mt-2 text-sm font-black console-readout text-[#2e1808] truncate">
                            {ins?.number || "Comprehensive Cover"}
                          </p>
                          <p className="mt-1 text-[11px] text-[#6b3a12]">
                            Expires {insExpiry.toLocaleDateString()}
                          </p>
                        </div>
                        <div className="mt-4">
                          {ins?.image && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setPreviewImage({
                                  url: ins.image,
                                  title: "Commercial Insurance Policy",
                                })
                              }
                              className="w-full h-8 text-[11px] border-[#7a4416]/25 bg-[#fffaf0]"
                            >
                              <Eye className="mr-1 h-3 w-3 text-[#b8722c]" /> Inspect Policy
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* PUC Certificate */}
                  {(() => {
                    const puc = profile?.documents?.pollutionCertificate;
                    const pucExpiry = puc?.expiryDate
                      ? new Date(puc.expiryDate)
                      : new Date(currentTime + 180 * 24 * 3600 * 1000);
                    return (
                      <div className="flex flex-col justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9] p-4 shadow-2xs">
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[#7a4416]">
                              Pollution (PUC)
                            </span>
                            <Calendar className="h-4 w-4 text-[#b8722c]" />
                          </div>
                          <p className="mt-2 text-sm font-black console-readout text-[#2e1808]">
                            Emission Compliant
                          </p>
                          <p className="mt-1 text-[11px] text-[#6b3a12]">
                            Valid till {pucExpiry.toLocaleDateString()}
                          </p>
                        </div>
                        <div className="mt-4">
                          {puc?.image && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setPreviewImage({
                                  url: puc.image,
                                  title: "Pollution Under Control (PUC)",
                                })
                              }
                              className="w-full h-8 text-[11px] border-[#7a4416]/25 bg-[#fffaf0]"
                            >
                              <Eye className="mr-1 h-3 w-3 text-[#b8722c]" /> Inspect PUC
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </section>
            </motion.div>
          )}

          {/* -------------------------------------------------------------------
              TAB 5: ACTIVE SESSIONS & DEVICE SECURITY
             ------------------------------------------------------------------- */}
          {activeTab === "sessions" && (
            <motion.div
              key="tab-sessions"
              variants={tabPanelVariants}
              initial="hidden"
              animate="visible"
              className="w-full"
            >
              {sessionsLoading ? (
                <TabTelemetryLoader
                  title="Inspecting Authorized Console Endpoints…"
                  subtitle="Verifying active device tokens and session signatures."
                  cardCount={2}
                />
              ) : (
                <div className="rounded-[2rem] border border-[#fff4dc]/85 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-5 sm:p-8 shadow-xl backdrop-blur-2xl">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 border-b border-[#7a4416]/15 pb-5 mb-6">
                    <div className="flex items-center gap-3.5">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#3a1f0a] text-[#ffd88a] shadow-md">
                        <ShieldCheck className="h-5 w-5" />
                      </span>
                      <div>
                        <h2 className="console-display text-xl font-black text-[#2e1808]">
                          Device Security & Active Sessions
                        </h2>
                        <p className="text-xs text-[#7a4416]">
                          Manage browsers and mobile devices signed in to your Captain account.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => void loadDriverSessions()}
                        disabled={sessionsLoading}
                        variant="outline"
                        size="sm"
                        className="h-10 border-[#7a4416]/25 bg-[#fffaf0] text-[#3a1f0a] text-xs font-bold rounded-xl"
                      >
                        <RefreshCw
                          className={`mr-1.5 h-3.5 w-3.5 text-[#b8722c] ${
                            sessionsLoading ? "animate-spin" : ""
                          }`}
                        />
                        Refresh
                      </Button>
                      <Button
                        onClick={() => void handleRevokeAllOtherSessions()}
                        disabled={isRevokingAllSessions || sessions.length <= 1}
                        className="h-10 rounded-xl bg-gradient-to-br from-rose-900 to-rose-950 text-rose-100 text-xs font-bold px-4 shadow-md"
                      >
                        {isRevokingAllSessions ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Revoke Other Devices
                      </Button>
                    </div>
                  </div>

                  {sessionSuccessMsg && (
                    <div className="mb-5 flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-950/15 p-3.5 text-xs font-semibold text-emerald-950">
                      <span className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                        {sessionSuccessMsg}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSessionSuccessMsg(null)}
                        className="text-emerald-800 hover:text-emerald-950"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {sessions.map((session) => {
                      const isCurrent = session.isCurrent;
                      const DeviceIcon =
                        session.deviceType === "Mobile"
                          ? Smartphone
                          : session.deviceType === "Tablet"
                            ? Tablet
                            : Laptop;
                      const isRevoking = revokingSessionId === session.id;

                      return (
                        <div
                          key={session.id}
                          className={`rounded-2xl border p-5 shadow-2xs transition-all ${
                            isCurrent
                              ? "border-emerald-600/40 bg-emerald-950/10"
                              : "border-[#7a4416]/20 bg-[#fffdf9]"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div
                                className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${
                                  isCurrent
                                    ? "bg-emerald-900 text-[#ffd88a]"
                                    : "bg-[#3a1f0a] text-[#ffd88a]"
                                }`}
                              >
                                <DeviceIcon className="h-5 w-5" />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h4 className="text-sm font-bold text-[#2e1808] truncate">
                                    {session.browser || "Browser"} • {session.os || "OS"}
                                  </h4>
                                  {isCurrent && (
                                    <span className="rounded-full bg-emerald-950/20 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-900">
                                      This Device
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-[#7a4416] console-readout mt-0.5">
                                  IP: {session.ipAddress || "127.0.0.1"}
                                </p>
                              </div>
                            </div>

                            {!isCurrent && (
                              <button
                                type="button"
                                onClick={() => void handleRevokeSession(session.id)}
                                disabled={isRevoking}
                                className="rounded-xl border border-rose-500/30 bg-rose-950/15 p-2 text-rose-800 hover:bg-rose-950/30 transition-all"
                                title="Revoke Session"
                              >
                                {isRevoking ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </button>
                            )}
                          </div>

                          <div className="mt-4 pt-3 border-t border-[#7a4416]/10 flex items-center justify-between text-[11px] text-[#6b3a12]">
                            <span>
                              Last active:{" "}
                              {session.lastActiveAt
                                ? new Date(session.lastActiveAt).toLocaleTimeString()
                                : "Just now"}
                            </span>
                            <span>
                              Signed in: {new Date(session.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </div>

        {/* High-Resolution Document & Photo Lightbox Modal */}
        <AnimatePresence>
          {previewImage && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
              onClick={() => setPreviewImage(null)}
            >
              <motion.div
                initial={{ scale: 0.95, y: 12 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.95, y: 12 }}
                transition={{ type: "spring", stiffness: 360, damping: 28 }}
                className="relative max-w-3xl w-full rounded-3xl border border-[#fff4dc]/40 bg-gradient-to-b from-[#2e1808] to-[#1a0c04] p-5 sm:p-6 shadow-2xl text-white overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-[#7a4416]/40 pb-4 mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#ffd88a] text-[#3a1f0a]">
                      <Eye className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="console-display truncate text-base font-bold text-[#ffd88a]">
                        {previewImage.title}
                      </h3>
                      <p className="text-xs text-[#ffd88a]/70">
                        Verified UrbanFleet credential inspection
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewImage(null)}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
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
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Modals */}
      <DriverWalletModal
        isOpen={isWalletOpen}
        onClose={() => {
          setIsWalletOpen(false);
          void syncWalletBalance();
          void fetchDriverProfile().then((fresh) => {
            if (fresh) setProfile(fresh);
          });
        }}
        onOpenBankDetails={() => setIsBankDetailsOpen(true)}
      />
      <DriverBankDetailsModal
        isOpen={isBankDetailsOpen}
        onClose={() => setIsBankDetailsOpen(false)}
        onUpdated={async () => {
          try {
            const updated = await fetchDriverProfile();
            setProfile(updated);
          } catch (e) {
            console.error("Failed to refresh profile", e);
          }
        }}
        initialData={{
          accountHolderName: profile?.accountHolderName,
          accountNumber: profile?.accountNumber,
          ifscCode: profile?.ifscCode,
          bankName: profile?.bankName,
          upiId: profile?.upiId,
          passbookPhoto: profile?.passbookPhoto,
        }}
      />
    </div>
  );
}