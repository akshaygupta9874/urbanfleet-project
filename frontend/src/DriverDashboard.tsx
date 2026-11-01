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
  Award,
  MessageSquare,
  Laptop,
  Smartphone,
  Tablet,
  Trash2,
  RefreshCw,
  Sparkles,
  Building2,
} from "lucide-react";
import LoadingScreen from "./components/LoadingScreen";
import MapView from "./components/MapView";
import { Button } from "./components/ui/button";
import { appApi } from "./lib/api";
import { connectDriverSocket, sendDriverLocation } from "./lib/socket";
import {
  fetchDriverProfile,
  fetchDriverRideHistory,
  isDriverApproved,
  type DriverRideItem,
} from "./lib/driverApi";
import { sessionApi, type DeviceSession } from "./lib/sessionApi";
import DriverCTA from "./components/DriverCTA";
import DriverWalletModal from "./components/DriverWalletModal";
import DriverBankDetailsModal from "./components/DriverBankDetailsModal";
import { useAuthContext } from "./context/auth-context";
import { getGeoapifyRouteLines, isGeoapifyFeatureCollection } from "./types/geoapify";
import CityMapBackground from "./components/CityMapBackground";
import { formatFare, formatDistance, formatDuration, getDistanceKm } from "./lib/formatters";
import { type PaymentStatus } from "./lib/payment";
import type { Coordinates } from "./types/location";
import type { RiderLocationPayload, RideDto, RideStatus } from "./types/ride";

// --- Types mirrored from backend models (Driver / Ride) ---
type VehicleType = "CAR" | "BIKE" | "AUTO";

export type Ride = RideDto;

type DashboardTab = "console" | "history" | "ratings" | "sessions" | "vehicle";

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
    label: "Incoming Request",
    badge:
      "bg-amber-950/90 text-amber-200 border border-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.25)]",
    description: "New passenger dispatch matched to your coordinates.",
    step: 0,
  },
  DRIVER_ASSIGNED: {
    label: "Assigned to You",
    badge: "bg-[#3a1f0a]/90 text-[#ffd88a] border border-[#c58a3a]/50",
    description: "Navigate to the passenger pickup point.",
    step: 1,
  },
  DRIVER_ARRIVING: {
    label: "At Pickup • Awaiting OTP",
    badge: "bg-[#3a1f0a]/90 text-[#ffd88a] border border-[#c58a3a]/50",
    description: "Verify the passenger's 4-digit PIN to begin the ride.",
    step: 2,
  },
  RIDE_STARTED: {
    label: "Trip in Progress",
    badge:
      "bg-emerald-950/90 text-emerald-200 border border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.2)]",
    description: "En route to destination drop-off.",
    step: 3,
  },
  ARRIVED_AT_DESTINATION: {
    label: "Arrived at Destination",
    badge: "bg-[#3a1f0a]/95 text-[#ffe9be] border border-[#c58a3a]/60",
    description: "Awaiting final payment settlement to close trip.",
    step: 4,
  },
  COMPLETED: {
    label: "Completed",
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
    label: "Payment Created",
    badge: "text-blue-900 bg-blue-500/15 border border-blue-600/30",
  },
  PENDING: {
    label: "Payment Pending",
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
    label: "Payment Failed",
    badge: "text-rose-900 bg-rose-500/15 border border-rose-600/30",
  },
  CANCELLED: {
    label: "Cancelled",
    badge: "text-rose-900 bg-rose-500/15 border border-rose-600/30",
  },
  REFUNDED: {
    label: "Refunded",
    badge: "text-[#3a1f0a] bg-[#7a4416]/15 border border-[#7a4416]/30",
  },
  PARTIALLY_REFUNDED: {
    label: "Partial Refund",
    badge: "text-amber-900 bg-amber-500/15 border border-amber-600/30",
  },
};

const RIDE_STEPS: { key: RideStatus; label: string }[] = [
  { key: "SEARCHING", label: "Request" },
  { key: "DRIVER_ASSIGNED", label: "Assigned" },
  { key: "DRIVER_ARRIVING", label: "Pickup" },
  { key: "RIDE_STARTED", label: "Transit" },
  { key: "ARRIVED_AT_DESTINATION", label: "Drop" },
  { key: "COMPLETED", label: "Settled" },
];

const formatPaise = formatFare;

// --- Framer Motion Variants (GPU-Composited, No Height Collapse) ---
const tabPanelVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.24,
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

// --- Luxury Telemetry Skeleton Loader for Tabs (Prevents 0-value flash) ---
function TabTelemetryLoader({
  title,
  subtitle,
  showKpiSkeletons = true,
  cardCount = 3,
}: {
  title: string;
  subtitle: string;
  showKpiSkeletons?: boolean;
  cardCount?: number;
}) {
  return (
    <div className="w-full space-y-6 animate-in fade-in duration-200">
      {showKpiSkeletons && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div
              key={idx}
              className="relative overflow-hidden rounded-[1.5rem] sm:rounded-[1.75rem] border border-[#c58a3a]/30 bg-gradient-to-br from-[#fffdf9]/90 via-[#fff6e5]/85 to-[#f5dfb5]/85 p-4 sm:p-5 shadow-md backdrop-blur-xl"
            >
              <div className="uf-skeleton-shimmer pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent" />
              <div className="flex items-center justify-between gap-2">
                <div className="h-3 w-20 rounded-md bg-[#7a4416]/15" />
                <div className="h-9 w-9 rounded-xl bg-[#3a1f0a]/15" />
              </div>
              <div className="mt-4 h-7 w-28 rounded-lg bg-[#3a1f0a]/20" />
              <div className="mt-2 h-2.5 w-24 rounded-md bg-[#7a4416]/15" />
            </div>
          ))}
        </div>
      )}

      <div className="relative overflow-hidden rounded-[2rem] sm:rounded-[2.25rem] border border-[#fff4dc]/85 bg-gradient-to-b from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-6 sm:p-8 shadow-xl backdrop-blur-2xl">
        <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

        {/* Live Telemetry Header Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#7a4416]/15 pb-5 mb-6">
          <div className="flex items-center gap-3.5">
            <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#241205] text-[#ffd88a] shadow-md">
              <Loader2 className="h-5 w-5 animate-spin text-[#ffd88a]" />
              <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#fffaf0] bg-amber-500 animate-ping" />
            </div>
            <div>
              <h3
                className="text-lg sm:text-xl font-black text-[#2e1808]"
                style={{ fontFamily: "'Fraunces', Georgia, serif" }}
              >
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

        {/* Shimmering Skeleton Rows */}
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
    <motion.div
      variants={cardAppearVariants}
      whileHover={{ y: -3 }}
      className="group relative w-full overflow-hidden rounded-[1.5rem] sm:rounded-[1.75rem] border border-[#c58a3a]/35 bg-gradient-to-br from-[#fffdf9]/95 via-[#fff6e5]/90 to-[#f5dfb5]/90 p-4 sm:p-5 shadow-[0_10px_30px_-10px_rgba(58,31,10,0.12)] backdrop-blur-xl text-[#2e1808] transition-colors duration-300 hover:border-[#b8722c] transform-gpu"
    >
      <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-gradient-to-br from-[#c58a3a]/20 to-transparent blur-xl transition-transform duration-500 group-hover:scale-125" />
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.14em] text-[#7a4416]">
          {label}
        </p>
        <div className="flex h-8 w-8 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl sm:rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#5c3211] to-[#241205] text-[#ffd88a] shadow-md ring-1 ring-[#c58a3a]/40 transition-transform duration-300 group-hover:scale-105">
          <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </div>
      </div>
      <div className="mt-3 sm:mt-4 flex flex-wrap items-baseline justify-between gap-1.5">
        <h3
          className="text-xl sm:text-2xl font-black tracking-tight text-[#2e1808] console-readout"
          style={{ fontFamily: "'Fraunces', Georgia, serif" }}
        >
          {value}
        </h3>
        {trend && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#3a1f0a]/10 px-2 py-0.5 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-[#6b3a12] border border-[#7a4416]/20">
            {trend}
          </span>
        )}
      </div>
    </motion.div>
  );
}

function RideStepper({ status }: { status: RideStatus }) {
  const activeIdx = RIDE_STEPS.findIndex((s) => s.key === status);
  return (
    <div className="w-full rounded-2xl border border-[#7a4416]/15 bg-[#fffdf8]/90 px-2 sm:px-3.5 py-3.5 shadow-inner">
      <ol className="flex w-full items-center justify-between">
        {RIDE_STEPS.map((s, i) => {
          const done = i <= activeIdx && status !== "CANCELLED";
          const current = i === activeIdx && status !== "CANCELLED";
          return (
            <li key={s.key} className="relative flex flex-1 flex-col items-center min-w-0">
              <div className="flex w-full items-center">
                <span
                  className={`h-[2px] flex-1 transition-colors duration-500 ${
                    i === 0
                      ? "bg-transparent"
                      : done
                        ? "bg-gradient-to-r from-[#3a1f0a] to-[#b8722c]"
                        : "bg-[#7a4416]/20"
                  }`}
                />
                <div
                  className={`relative flex h-6 w-6 sm:h-7 sm:w-7 shrink-0 items-center justify-center rounded-full border text-[10px] sm:text-[11px] font-bold transition-all duration-300 ${
                    done
                      ? "border-[#ffd88a] bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffd88a] shadow-sm"
                      : "border-[#7a4416]/30 bg-[#fffaf0] text-[#7a4416]"
                  } ${current ? "ring-3 sm:ring-4 ring-[#c58a3a]/30 scale-110" : ""}`}
                >
                  {done ? (
                    <CheckCircle2 className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-[#ffd88a]" />
                  ) : (
                    i + 1
                  )}
                </div>
                <span
                  className={`h-[2px] flex-1 transition-colors duration-500 ${
                    i === RIDE_STEPS.length - 1
                      ? "bg-transparent"
                      : i < activeIdx && status !== "CANCELLED"
                        ? "bg-gradient-to-r from-[#b8722c] to-[#3a1f0a]"
                        : "bg-[#7a4416]/20"
                  }`}
                />
              </div>
              <span
                className={`mt-1.5 truncate max-w-full px-0.5 text-center text-[8px] sm:text-[10px] uppercase tracking-wider transition-colors ${
                  current
                    ? "font-black text-[#3a1f0a]"
                    : done
                      ? "font-semibold text-[#6b3a12]"
                      : "font-medium text-[#7a4416]/60"
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
  const [isBankDetailsOpen, setIsBankDetailsOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [tripOtp, setTripOtp] = useState("");
  const [isStartingRide, setIsStartingRide] = useState(false);
  const [isAcceptingRide, setIsAcceptingRide] = useState(false);

  // Decoupled Driver Feature States: Tabs, History, Ratings, Sessions
  const [activeTab, setActiveTab] = useState<DashboardTab>("console");
  const [rideHistory, setRideHistory] = useState<DriverRideItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [hasLoadedHistory, setHasLoadedHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<"ALL" | "COMPLETED" | "CANCELLED">("ALL");

  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [hasLoadedSessions, setHasLoadedSessions] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [isRevokingAllSessions, setIsRevokingAllSessions] = useState(false);
  const [sessionSuccessMsg, setSessionSuccessMsg] = useState<string | null>(null);

  const loadDriverHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await fetchDriverRideHistory();
      setRideHistory(data);
    } catch (err) {
      console.error("Failed to load driver ride history:", err);
    } finally {
      setHistoryLoading(false);
      setHasLoadedHistory(true);
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

  // Synchronous tab transition handler: sets loading flags BEFORE first paint of new tab
  const handleSelectTab = useCallback(
    (nextTab: DashboardTab) => {
      if (nextTab === activeTab) return;

      if (nextTab === "history" && !hasLoadedHistory) {
        setHistoryLoading(true);
      } else if (nextTab === "sessions" && !hasLoadedSessions) {
        setSessionsLoading(true);
      }

      setActiveTab(nextTab);

      if (nextTab === "console") {
        // Trigger Leaflet resize recalculation when returning to console
        setTimeout(() => {
          window.dispatchEvent(new Event("resize"));
        }, 60);
      }
    },
    [activeTab, hasLoadedHistory, hasLoadedSessions]
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
    } else if (activeTab === "sessions") {
      void loadDriverSessions();
    }
  }, [activeTab, loadDriverHistory, loadDriverSessions]);

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
      (ride.fare?.final
        ? Math.round(ride.fare.final * 0.8)
        : ride.fare?.estimated
          ? Math.round(ride.fare.estimated * 0.8)
          : 0);
    const distanceKm = getDistanceKm(ride.distance);

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
    // If user is exclusively a rider and not a driver, redirect to rider dashboard
    if (user?.roles?.includes("RIDER") && !user?.roles?.includes("DRIVER")) {
      navigate("/dashboard", { replace: true });
      return;
    }
  }, [user?.roles, navigate]);

  useEffect(() => {
    async function loadProfileAndRide() {
      try {
        // 1. If user is also a rider, check if they are actively in a ride as a passenger
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

        const [profileResponse, rideResponse] = await Promise.all([
          fetchDriverProfile(),
          appApi.get<{ success: boolean; data: Ride }>("/rides/driver/current").catch(() => null),
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
        const response =
          err && typeof err === "object" && "response" in err
            ? (err as { response?: { status?: number; data?: { message?: unknown } } }).response
            : undefined;
        if (response?.status === 404) {
          // Driver has not created a driver profile yet; guide via DriverCTA
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
        if (!hasEmittedOnlineRef.current) {
          hasEmittedOnlineRef.current = true;
          driverSocket.send(JSON.stringify({ event: DriverEvents.GO_ONLINE, data: {} }));
        }
        if (
          currentRideRef.current &&
          BUSY_RIDE_STATUSES.includes(currentRideRef.current.status)
        ) {
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
      socketRef.current.send(
        JSON.stringify({ event: DriverEvents.SET_AVAILABLE, data: { available: true } })
      );
      setDriverStatus("AVAILABLE");
      return;
    }

    socketRef.current.send(
      JSON.stringify({ event: DriverEvents.SET_AVAILABLE, data: { available: false } })
    );
    setDriverStatus("ONLINE");
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
      : { lat: 12.9716, lng: 77.5946 };

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

  const driverStatusCopy: Record<DriverStatus, string> = {
    OFFLINE: "Radar disengaged. Your vehicle is hidden from passenger dispatch.",
    ONLINE: "Connected to telemetry server. Toggle availability to start receiving rides.",
    AVAILABLE: "Live GPS radar active • Broadcasting coordinates for nearby ride requests.",
    BUSY: "Active dispatch locked • Telemetry streaming live to passenger.",
  };

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
      label: "Live Radar & Console",
      shortLabel: "Live Radar",
      icon: Navigation,
      pulse: Boolean(currentRide),
    },
    {
      id: "history",
      label: "Ride History",
      shortLabel: "History",
      icon: History,
      badge: hasLoadedHistory && rideHistory.length > 0 ? rideHistory.length : undefined,
    },
    {
      id: "ratings",
      label: "Ratings & Reviews",
      shortLabel: "Ratings",
      icon: Star,
      badge: `${Number(profile?.rating?.average ?? 5.0).toFixed(1)}★`,
    },
    {
      id: "sessions",
      label: "Security & Devices",
      shortLabel: "Security",
      icon: ShieldCheck,
    },
    {
      id: "vehicle",
      label: "Fleet & Documents",
      shortLabel: "Fleet & Docs",
      icon: Car,
    },
  ];

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden bg-[#f5e6c8] font-sans text-[#2e1808] selection:bg-[#3a1f0a] selection:text-[#ffd88a]">
      {/* FIXED VIEWPORT BACKGROUND: Never rescales or zooms when tab height changes */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <CityMapBackground />
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600;700&display=swap');

        .rd-scroll-fade::-webkit-scrollbar { width: 6px; height: 6px; }
        .rd-scroll-fade::-webkit-scrollbar-thumb { background: #c58a3a; border-radius: 999px; }

        .console-display { font-family: 'Fraunces', ui-serif, Georgia, serif; }
        .console-readout { font-family: 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }

        @keyframes radar-pulse {
          0% { transform: scale(0.85); opacity: 0.75; }
          70% { transform: scale(1.65); opacity: 0; }
          100% { transform: scale(1.65); opacity: 0; }
        }
        @keyframes uf-shimmer {
          100% { transform: translateX(200%); }
        }
        .animate-radar-slow {
          animation: radar-pulse 2.6s cubic-bezier(0.16, 1, 0.3, 1) infinite;
        }
        .animate-radar-delayed {
          animation: radar-pulse 2.6s cubic-bezier(0.16, 1, 0.3, 1) 1.3s infinite;
        }
        .uf-skeleton-shimmer {
          animation: uf-shimmer 1.8s infinite ease-in-out;
        }
      `}</style>

      {/* Earnings Toast Alert */}
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

      {/* Main Full-Width Content Container */}
      <div className="relative z-10 mx-auto w-full max-w-[1600px] px-3.5 sm:px-6 lg:px-10 py-4 sm:py-5 space-y-5 sm:space-y-6">
        {/* Sticky Top Command Bar — Cleanly Aligned on Mobile & Desktop */}
        <header className="sticky top-2.5 z-40 w-full">
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="w-full rounded-[1.5rem] sm:rounded-[1.75rem] border border-[#fff4dc]/85 bg-gradient-to-r from-[#fffdf9]/95 via-[#fff5e0]/92 to-[#f7e2b8]/92 backdrop-blur-2xl shadow-[0_12px_32px_-8px_rgba(46,24,8,0.16)] px-3.5 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between gap-2"
          >
            {/* Brand & Live Beacon */}
            <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0">
              <div className="relative flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-xl sm:rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#241205] text-[#ffd88a] shadow-md ring-1 ring-[#c58a3a]/50">
                <VehicleIcon className="h-4 w-4 sm:h-5 sm:w-5" />
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 sm:h-3.5 sm:w-3.5 rounded-full border-2 border-[#fffaf0] ${statusDotColor}`}
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <p className="truncate text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] sm:tracking-[0.24em] text-[#7a4416] flex items-center gap-1">
                    <Gem className="h-3 w-3 text-[#b8722c] shrink-0" />
                    <span>UrbanFleet Driver</span>
                  </p>
                  <span className="hidden md:inline-flex items-center gap-1 rounded-full bg-[#3a1f0a]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#3a1f0a]">
                    {VEHICLE_TYPE_LABEL[vehicleType]} Tier
                  </span>
                </div>
                <p className="truncate text-xs sm:text-sm font-bold text-[#2e1808] tracking-tight">
                  Driver Activity{" "}
                  <span className="hidden sm:inline text-[#7a4416] font-semibold">
                    • Live status
                  </span>
                </p>
              </div>
            </div>

            {/* Right Quick Actions — Proportioned for Mobile & Desktop */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {/* Live Balance / Wallet Pill */}
              <button
                type="button"
                onClick={() => setIsWalletOpen(true)}
                className="group flex items-center gap-1.5 sm:gap-2 h-9 sm:h-10 px-3 sm:px-4 rounded-xl border border-[#c58a3a]/50 bg-gradient-to-br from-[#3a1f0a] via-[#59300e] to-[#241205] text-[#ffe9be] text-xs font-bold shadow-md hover:shadow-lg hover:border-[#ffd88a]/60 active:scale-95 transition-all"
                title="Driver Wallet & Instant Payouts"
              >
                <Wallet className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-[#ffd88a] transition-transform group-hover:scale-110 shrink-0" />
                <span>Wallet</span>
                <span className="hidden lg:inline-block rounded-md bg-white/10 px-1.5 py-0.5 console-readout text-[11px] text-[#ffd88a]">
                  {formatPaise(profile?.statistics?.totalEarnings ?? 0)}
                </span>
              </button>

              {/* Bank & UPI Quick Button */}
              <button
                type="button"
                onClick={() => setIsBankDetailsOpen(true)}
                className="grid h-9 w-9 sm:h-10 sm:w-10 place-items-center rounded-xl border border-[#7a4416]/25 bg-[#fffaf0] text-[#3a1f0a] hover:bg-[#fff4dc] active:scale-95 transition-all shadow-2xs"
                aria-label="Bank & UPI Details"
                title="Bank & UPI Payout Settings"
              >
                <Building2 className="h-4 w-4 text-[#b8722c]" />
              </button>

              {/* Switch to Rider Console (for Dual-Role Users) */}
              {user?.roles?.includes("RIDER") && (
                <button
                  type="button"
                  onClick={() => navigate("/dashboard")}
                  className="flex items-center gap-1.5 h-9 sm:h-10 px-2.5 sm:px-3.5 rounded-xl border border-[#7a4416]/25 bg-[#fffaf0] text-[#3a1f0a] hover:bg-[#fff4dc] active:scale-95 transition-all shadow-2xs text-xs font-bold"
                  title="Switch to Passenger Dashboard"
                >
                  <Navigation className="h-3.5 w-3.5 text-[#b8722c] shrink-0" />
                  <span className="hidden md:inline">Passenger Dashboard</span>
                </button>
              )}

              {/* Secure Driver Logout */}
              <button
                type="button"
                onClick={() => void logout().finally(() => navigate("/login", { replace: true }))}
                className="group relative grid h-9 w-9 sm:h-10 sm:w-10 place-items-center rounded-xl border border-rose-500/30 bg-rose-950/15 text-rose-900 shadow-2xs hover:bg-rose-950/25 active:scale-95 transition-all"
                aria-label="Logout"
                title="Sign out of Driver Dashboard"
              >
                <LogOut className="h-4 w-4 text-rose-800 transition-colors group-hover:text-rose-950" />
              </button>
            </div>
          </motion.div>
        </header>

        {/* Driver identity banner */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="w-full rounded-[2rem] sm:rounded-[2.25rem] border border-[#fff4dc]/85 bg-gradient-to-br from-[#fffdf9]/95 via-[#fff5e1]/90 to-[#f5dfb5]/90 p-5 sm:p-7 shadow-[0_16px_40px_-12px_rgba(46,24,8,0.14)] backdrop-blur-2xl relative overflow-hidden"
        >
          <div className="pointer-events-none absolute inset-x-10 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gradient-to-br from-[#c58a3a]/15 to-transparent blur-2xl" />

          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-5 sm:gap-6">
            {/* Left: Avatar & Core Credentials */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-5 min-w-0">
              <div className="flex items-center gap-4 w-full sm:w-auto">
                <div className="relative group shrink-0">
                  {profile?.profilePhoto?.url ? (
                    <div
                      onClick={() =>
                        setPreviewImage({
                          url: profile.profilePhoto.url,
                          title: "Driver Profile Photo",
                        })
                      }
                      className="relative h-18 w-18 sm:h-24 sm:w-24 rounded-2xl sm:rounded-3xl overflow-hidden border-2 border-[#c58a3a] shadow-lg cursor-pointer"
                    >
                      <img
                        src={profile.profilePhoto.url}
                        alt="Driver Avatar"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                      />
                      <div className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Eye className="h-5 w-5 text-[#ffd88a]" />
                      </div>
                    </div>
                  ) : (
                    <div className="h-18 w-18 sm:h-24 sm:w-24 rounded-2xl sm:rounded-3xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] flex items-center justify-center text-[#ffd88a] font-bold text-2xl sm:text-3xl border-2 border-[#c58a3a] shadow-lg">
                      {user?.firstName?.[0]?.toUpperCase() || "D"}
                    </div>
                  )}
                  <span
                    className={`absolute -bottom-1 -right-1 h-4.5 w-4.5 sm:h-5 sm:w-5 rounded-full border-2 border-[#fffaf0] ${statusDotColor}`}
                  />
                </div>

                {/* Mobile-only Name & Verification Stack next to Avatar */}
                <div className="sm:hidden min-w-0 flex-1 space-y-1.5">
                  <h1
                    className="truncate text-xl font-black text-[#2e1808] tracking-tight"
                    style={{ fontFamily: "'Fraunces', Georgia, serif" }}
                  >
                    {user?.firstName
                      ? `${user.firstName} ${user.lastName || ""}`.trim()
                      : "Driver Partner"}
                  </h1>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold border shadow-2xs ${
                      isApprovedDriver
                        ? "bg-emerald-950/15 text-emerald-950 border-emerald-600/35"
                        : profile?.verificationStatus === "REJECTED" ||
                            profile?.verificationStatus === "SUSPENDED"
                          ? "bg-rose-950/15 text-rose-950 border-rose-600/35"
                          : "bg-amber-950/15 text-amber-950 border-amber-600/35"
                    }`}
                  >
                    <Shield className="h-3 w-3 text-emerald-700 shrink-0" />
                    {isApprovedDriver ? "Verified Partner" : profile?.verificationStatus}
                  </span>
                </div>
              </div>

              <div className="space-y-2.5 min-w-0 w-full sm:w-auto">
                {/* Desktop Name & Badge Row */}
                <div className="hidden sm:flex items-center gap-2.5 flex-wrap">
                  <h1
                    className="text-2xl sm:text-3xl font-black text-[#2e1808] tracking-tight"
                    style={{ fontFamily: "'Fraunces', Georgia, serif" }}
                  >
                    {user?.firstName
                      ? `${user.firstName} ${user.lastName || ""}`.trim()
                      : "Driver Partner"}
                  </h1>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold border shadow-xs ${
                      isApprovedDriver
                        ? "bg-emerald-950/15 text-emerald-950 border-emerald-600/35"
                        : profile?.verificationStatus === "REJECTED" ||
                            profile?.verificationStatus === "SUSPENDED"
                          ? "bg-rose-950/15 text-rose-950 border-rose-600/35"
                          : "bg-amber-950/15 text-amber-950 border-amber-600/35"
                    }`}
                  >
                    <Shield className="h-3.5 w-3.5 text-emerald-700" />
                    {isApprovedDriver
                      ? "Verified Fleet Partner"
                      : profile?.verificationStatus === "REJECTED"
                        ? "Verification Rejected"
                        : profile?.verificationStatus === "SUSPENDED"
                          ? "Verification Suspended"
                          : profile?.verificationStatus === "UNDER_REVIEW"
                            ? "Application Under Review"
                            : "Pending Verification"}
                  </span>
                </div>

                {/* Metadata Pills: ID, Vehicle Make, License Plate */}
                <div className="flex items-center gap-2 text-xs text-[#7a4416] flex-wrap">
                  <span className="console-readout bg-[#3a1f0a]/10 border border-[#7a4416]/20 px-2.5 py-1 rounded-lg flex items-center gap-1.5 text-[#3a1f0a] font-semibold">
                    ID: {profile?.id ? `${profile.id.slice(0, 8)}…${profile.id.slice(-4)}` : "UF-DRIVER"}
                    <button
                      type="button"
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
                      {copiedId ? (
                        <Check className="h-3.5 w-3.5 text-emerald-700" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </span>

                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#fffaf0] border border-[#7a4416]/20 px-2.5 py-1 font-bold text-[#2e1808] shadow-2xs">
                    <VehicleIcon className="h-3.5 w-3.5 text-[#b8722c] shrink-0" />
                    <span className="truncate">
                      {profile?.vehicle
                        ? `${profile.vehicle.brand} ${profile.vehicle.model}`
                        : "No Vehicle Assigned"}
                    </span>
                  </span>

                  {/* High-Contrast Number Plate Pill */}
                  <span className="inline-flex items-center gap-1.5 rounded-lg border-2 border-[#3a1f0a] bg-[#ffd88a] px-2.5 py-0.5 console-readout text-xs font-extrabold tracking-wider text-[#2e1808] shadow-xs">
                    <span className="text-[9px] font-black text-[#7a4416]">IND</span>
                    {profile?.vehicle?.registrationNumber || "NOT ASSIGNED"}
                  </span>
                </div>
              </div>
            </div>

            {/* Right: Symmetrical 3-Column Rating, Reviews & Completion Readout */}
            <div className="grid grid-cols-3 divide-x divide-[#7a4416]/20 bg-[#fffdf9]/95 border border-[#c58a3a]/35 rounded-2xl py-3 px-2 sm:px-5 shadow-sm w-full lg:w-auto shrink-0">
              <div className="px-2 sm:px-4 text-center">
                <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.14em] text-[#7a4416]">
                  Rating
                </p>
                <div className="flex items-center justify-center gap-1 mt-1">
                  <Star className="h-3.5 w-3.5 sm:h-4 sm:w-4 fill-amber-500 text-amber-500 shrink-0" />
                  <span className="text-base sm:text-xl font-black text-[#2e1808] console-readout">
                    {Number(profile?.rating?.average ?? 5.0).toFixed(1)}
                  </span>
                </div>
              </div>

              <div className="px-2 sm:px-4 text-center">
                <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.14em] text-[#7a4416]">
                  Reviews
                </p>
                <p className="text-base sm:text-xl font-black text-[#2e1808] console-readout mt-1">
                  {profile?.rating?.totalRatings ?? 0}
                </p>
              </div>

              <div className="px-2 sm:px-4 text-center">
                <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.14em] text-[#7a4416]">
                  Completion
                </p>
                <p className="text-base sm:text-xl font-black text-emerald-900 console-readout mt-1">
                  {acceptanceRate}%
                </p>
              </div>
            </div>
          </div>
        </motion.section>

        {/* Responsive Segmented Navigation Dock — 2-Col Mobile Grid / Full Flex Desktop Bar */}
        <section className="w-full">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex lg:items-center gap-1.5 sm:gap-2 rounded-2xl border border-[#fff4dc]/85 bg-[#fffaf0]/85 p-1.5 shadow-md backdrop-blur-xl">
            {NAV_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const TabIcon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleSelectTab(tab.id)}
                  className={`relative flex items-center justify-center lg:justify-start gap-2 px-3 sm:px-4 py-2.5 rounded-xl text-xs font-bold transition-colors ${
                    isActive
                      ? "text-[#ffe9be]"
                      : "text-[#6b3a12] hover:bg-[#fff4dc]/80 hover:text-[#2e1808]"
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="driverConsoleTab"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] shadow-md ring-1 ring-[#c58a3a]/50"
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-2 truncate">
                    <TabIcon
                      className={`h-4 w-4 shrink-0 ${
                        isActive
                          ? "text-[#ffd88a]"
                          : tab.id === "ratings"
                            ? "text-amber-500 fill-amber-500"
                            : "text-[#b8722c]"
                      }`}
                    />
                    <span className="sm:hidden truncate">{tab.shortLabel}</span>
                    <span className="hidden sm:inline truncate">{tab.label}</span>
                    {tab.pulse && (
                      <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
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

            {/* 6th Grid Slot on Mobile/Tablet + Right-Aligned Pill on Desktop */}
            <button
              type="button"
              onClick={() => setIsWalletOpen(true)}
              className="lg:ml-auto flex items-center justify-center gap-2 px-3 sm:px-4 py-2.5 rounded-xl text-xs font-bold transition-all border border-[#c58a3a]/40 bg-[#fffdf9] text-[#3a1f0a] hover:bg-[#fff4dc] active:scale-[0.98] shadow-2xs"
            >
              <Wallet className="h-4 w-4 text-[#b8722c] shrink-0" />
              <span className="truncate">Wallet & Payouts</span>
            </button>
          </div>
        </section>

        {/* System Error Banner */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              className="w-full flex items-center justify-between gap-3 rounded-2xl border border-rose-500/40 bg-rose-950/20 px-4 sm:px-5 py-3.5 text-xs sm:text-sm text-rose-950 shadow-md backdrop-blur-md"
            >
              <div className="flex items-center gap-3 min-w-0">
                <AlertTriangle className="h-5 w-5 shrink-0 text-rose-700" />
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

        {/* LOCKED-HEIGHT TAB WORKSPACE: Prevents height collapse, scroll jumps & map tile reloads */}
        <div className="relative w-full min-h-[680px]">
          {/* TAB 1: LIVE RADAR & CONSOLE (Kept mounted in DOM so MapView never reloads tiles) */}
          <div
            className={
              activeTab === "console"
                ? "block space-y-5 sm:space-y-6 animate-in fade-in duration-200"
                : "hidden"
            }
          >
            {/* Availability Command Bar */}
            <section
              className={`w-full rounded-[2rem] border p-5 sm:p-6 shadow-xl backdrop-blur-2xl relative overflow-hidden transition-all duration-300 ${
                driverStatus === "AVAILABLE"
                  ? "border-emerald-600/40 bg-gradient-to-r from-[#fffdf9]/95 via-[#f4fbf7]/90 to-[#e6f7ed]/90"
                  : driverStatus === "BUSY"
                    ? "border-amber-600/45 bg-gradient-to-r from-[#fffdf9]/95 via-[#fff6e5]/90 to-[#fbe6c2]/90"
                    : "border-[#fff4dc]/80 bg-gradient-to-r from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90"
              }`}
            >
              <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
              <div className="w-full flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start sm:items-center gap-3.5 sm:gap-4">
                  <div className="relative flex items-center justify-center shrink-0">
                    {driverStatus === "AVAILABLE" && (
                      <span className="pointer-events-none absolute inset-0 rounded-2xl bg-emerald-500/30 animate-ping" />
                    )}
                    <div
                      className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-all shadow-md ${
                        driverStatus === "OFFLINE"
                          ? "bg-[#7a4416]/20 text-[#7a4416]"
                          : driverStatus === "AVAILABLE"
                            ? "bg-gradient-to-br from-emerald-800 to-emerald-950 text-emerald-100 ring-2 ring-emerald-500/40"
                            : "bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] text-[#ffd88a]"
                      }`}
                    >
                      <Power className="h-5 w-5" />
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2
                        className="text-base font-black text-[#2e1808]"
                        style={{ fontFamily: "'Fraunces', Georgia, serif" }}
                      >
                        Dispatch Availability Control
                      </h2>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-[10px] font-black uppercase tracking-widest ${
                          driverStatus === "AVAILABLE"
                            ? "bg-emerald-950/15 text-emerald-900 border border-emerald-600/30"
                            : driverStatus === "BUSY"
                              ? "bg-amber-950/15 text-amber-900 border border-amber-600/30"
                              : "bg-[#7a4416]/15 text-[#3a1f0a] border border-[#7a4416]/30"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            driverStatus === "AVAILABLE"
                              ? "bg-emerald-600"
                              : driverStatus === "BUSY"
                                ? "bg-amber-600"
                                : "bg-[#7a4416]"
                          }`}
                        />
                        {driverStatus}
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-medium text-[#6b3a12]">
                      {driverStatusCopy[driverStatus]}
                    </p>
                  </div>
                </div>

                <Button
                  onClick={handleToggleAvailability}
                  disabled={driverStatus === "BUSY"}
                  className={`h-12 rounded-2xl px-7 text-xs font-bold uppercase tracking-wider shadow-lg transition-all active:scale-[0.98] w-full sm:w-auto shrink-0 ${
                    driverStatus === "AVAILABLE"
                      ? "border border-[#7a4416]/35 bg-[#fffaf0] text-[#3a1f0a] hover:bg-[#fff4dc]"
                      : "bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#241205] text-[#ffe9be] hover:opacity-95 border border-[#c58a3a]/50"
                  }`}
                >
                  {driverStatus === "AVAILABLE" ? (
                    "Go Offline"
                  ) : driverStatus === "BUSY" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> On Active Trip
                    </>
                  ) : (
                    "Go Online & Scan"
                  )}
                </Button>
              </div>
            </section>

            {/* Analytics Stat Cards — 2x2 Bento Grid on Mobile / 4-Column on Desktop */}
            <section className="w-full grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <StatCard
                label="Total Trips"
                value={String(profile?.statistics?.totalTrips ?? 0)}
                icon={RouteIcon}
                trend="+4% wk"
              />
              <StatCard
                label="Driver Rating"
                value={Number(profile?.rating?.average ?? 5).toFixed(1)}
                icon={Star}
                trend="Top Tier"
              />
              <StatCard
                label="Total Earnings"
                value={formatPaise(profile?.statistics?.totalEarnings ?? 0)}
                icon={Wallet}
                trend="Verified"
              />
              <StatCard
                label="Completion Rate"
                value={`${acceptanceRate}%`}
                icon={CheckCircle2}
                trend="Reliable"
              />
            </section>

            {/* Split-Screen Command Workspace: Active Dispatch (Left) + Live Telemetry Map (Right) */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
              {/* Left Column: Current Active Ride / Radar Scanner */}
              <section className="xl:col-span-6 flex flex-col justify-between overflow-hidden rounded-[2rem] sm:rounded-[2.25rem] border border-[#fff4dc]/80 bg-gradient-to-b from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-5 sm:p-8 shadow-2xl backdrop-blur-2xl relative">
                <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

                <div>
                  <div className="w-full flex flex-wrap items-center justify-between gap-3 border-b border-[#7a4416]/20 pb-4 mb-6">
                    <div>
                      <h2
                        className="text-lg font-black text-[#2e1808]"
                        style={{ fontFamily: "'Fraunces', Georgia, serif" }}
                      >
                        Current Trip Management
                      </h2>
                      <p className="text-xs font-medium text-[#7a4416]">
                        {statusConfig
                          ? statusConfig.description
                          : "Awaiting ride requests or dispatch instructions."}
                      </p>
                    </div>
                    {statusConfig && (
                      <span
                        className={`rounded-full px-3.5 py-1 text-xs font-bold shadow-xs ${statusConfig.badge}`}
                      >
                        {statusConfig.label}
                      </span>
                    )}
                  </div>

                  <AnimatePresence mode="wait">
                    {!currentRide ? (
                      <motion.div
                        key="no-active-ride"
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        className="w-full px-4 py-12 sm:py-14 text-center flex flex-col items-center justify-center"
                      >
                        {/* Animated Multi-Ring Radar Visual */}
                        <div className="relative flex h-28 w-28 items-center justify-center">
                          {driverStatus === "AVAILABLE" && (
                            <>
                              <span className="pointer-events-none absolute inset-0 rounded-full border-2 border-[#b8722c]/45 animate-radar-slow" />
                              <span className="pointer-events-none absolute inset-2 rounded-full border border-emerald-600/35 animate-radar-delayed" />
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

                        <h3
                          className="mt-5 text-lg font-black text-[#2e1808]"
                          style={{ fontFamily: "'Fraunces', Georgia, serif" }}
                        >
                          {driverStatus === "AVAILABLE"
                            ? "Scanning for nearby riders..."
                            : "Driver console is on standby"}
                        </h3>
                        <p className="mx-auto mt-1.5 max-w-sm text-xs font-medium text-[#7a4416] leading-relaxed">
                          {driverStatus === "AVAILABLE"
                            ? "Keep your console open. Incoming passenger requests are matched automatically via real-time Redis geospatial proximity."
                            : "Switch your availability status to online above to start receiving live ride dispatch notifications."}
                        </p>

                        {driverLocation && (
                          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-[#7a4416]/20 bg-[#fffaf0] px-3.5 py-1.5 text-[11px] console-readout font-semibold text-[#3a1f0a] shadow-2xs">
                            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                            GPS: {driverLocation.latitude.toFixed(4)}° N,{" "}
                            {driverLocation.longitude.toFixed(4)}° E
                          </div>
                        )}
                      </motion.div>
                    ) : (
                      <motion.div
                        key={currentRide.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="w-full space-y-5"
                      >
                        <RideStepper status={currentRide.status} />

                        {/* Route Details Box */}
                        <div className="w-full rounded-2xl border border-[#7a4416]/25 bg-[#fffdf9] p-4 sm:p-5 shadow-sm">
                          <div className="flex gap-3.5 sm:gap-4">
                            <div className="flex shrink-0 flex-col items-center pt-1.5">
                              <span className="h-3.5 w-3.5 rounded-full bg-emerald-600 ring-4 ring-emerald-500/20" />
                              <span className="my-1.5 h-12 w-0.5 border-l-2 border-dashed border-[#b8722c]/60" />
                              <MapPin className="h-4 w-4 text-rose-600" />
                            </div>
                            <div className="flex-1 space-y-4 min-w-0">
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-800">
                                  Pickup Location
                                </p>
                                <p className="text-xs sm:text-sm font-bold text-[#2e1808] mt-0.5 break-words">
                                  {currentRide.pickup.address}
                                </p>
                              </div>
                              <div className="border-t border-[#7a4416]/10 pt-3">
                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-rose-800">
                                  Destination Drop-off
                                </p>
                                <p className="text-xs sm:text-sm font-bold text-[#2e1808] mt-0.5 break-words">
                                  {currentRide.destination.address}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Ride Metrics Grid — Crisp 2x2 on Mobile / 4-Col on SM+ */}
                        <div className="w-full grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
                          <div className="w-full rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9] p-3.5 shadow-2xs">
                            <div className="flex items-center justify-between text-[#7a4416]">
                              <span className="text-[10px] font-bold uppercase tracking-wider">
                                Distance
                              </span>
                              <RouteIcon className="h-3.5 w-3.5 text-[#b8722c]" />
                            </div>
                            <p className="mt-1.5 text-sm sm:text-base font-black text-[#2e1808] console-readout">
                              {distance != null ? formatDistance(distance) : "--"}
                            </p>
                          </div>

                          <div className="w-full rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9] p-3.5 shadow-2xs">
                            <div className="flex items-center justify-between text-[#7a4416]">
                              <span className="text-[10px] font-bold uppercase tracking-wider">
                                Duration
                              </span>
                              <Clock className="h-3.5 w-3.5 text-[#b8722c]" />
                            </div>
                            <p className="mt-1.5 text-sm sm:text-base font-black text-[#2e1808] console-readout">
                              {duration != null ? formatDuration(duration) : "--"}
                            </p>
                          </div>

                          <div className="w-full rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9] p-3.5 shadow-2xs">
                            <div className="flex items-center justify-between text-[#7a4416]">
                              <span className="text-[10px] font-bold uppercase tracking-wider">
                                Est. Payout
                              </span>
                              <Wallet className="h-3.5 w-3.5 text-[#b8722c]" />
                            </div>
                            <p className="mt-1.5 text-sm sm:text-base font-black text-emerald-900 console-readout">
                              {fare != null ? formatPaise(fare) : "--"}
                            </p>
                            {totalTripFare > 0 && (
                              <p className="text-[10px] font-semibold text-[#7a4416]/80 mt-0.5 truncate">
                                Total: {formatPaise(totalTripFare)}
                              </p>
                            )}
                          </div>

                          <div className="w-full rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9] p-3.5 shadow-2xs">
                            <div className="flex items-center justify-between text-[#7a4416]">
                              <span className="text-[10px] font-bold uppercase tracking-wider">
                                Settlement
                              </span>
                              <Zap className="h-3.5 w-3.5 text-[#b8722c]" />
                            </div>
                            <p
                              className={`mt-1.5 inline-flex rounded-md px-2 py-0.5 text-[10px] sm:text-[11px] font-bold ${
                                paymentInfo?.badge ??
                                "text-[#3a1f0a] bg-[#7a4416]/15 border border-[#7a4416]/30"
                              }`}
                            >
                              {paymentInfo?.label ?? "--"}
                            </p>
                          </div>
                        </div>

                        {/* Primary Dispatch Action Controls */}
                        <div className="w-full space-y-3 pt-1">
                          {currentRide.status === "SEARCHING" && (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
                              <Button
                                onClick={() => handleAcceptRide(currentRide.id)}
                                disabled={isAcceptingRide}
                                className="sm:col-span-2 w-full bg-gradient-to-br from-emerald-800 via-emerald-900 to-emerald-950 text-emerald-50 hover:opacity-95 border border-emerald-400/40 h-12 rounded-xl active:scale-[0.98] transition-all font-bold shadow-lg"
                              >
                                {isAcceptingRide ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="mr-2 h-4 w-4" />
                                )}
                                {isAcceptingRide
                                  ? "Accepting Dispatch..."
                                  : "Accept Ride Request"}
                              </Button>
                              <Button
                                onClick={() => handleRejectRide(currentRide.id)}
                                variant="outline"
                                className="w-full border-rose-500/35 bg-rose-950/15 text-rose-950 hover:bg-rose-950/25 h-12 rounded-xl active:scale-[0.98] transition-all font-bold"
                              >
                                <X className="mr-2 h-4 w-4" /> Decline
                              </Button>
                            </div>
                          )}

                          {currentRide.status === "DRIVER_ASSIGNED" && (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
                              <Button
                                onClick={() =>
                                  sendRideAction(DriverEvents.ARRIVED_AT_PICKUP, currentRide.id)
                                }
                                className="sm:col-span-2 w-full bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffe9be] hover:opacity-95 border border-[#c58a3a]/50 h-12 rounded-xl active:scale-[0.98] transition-all font-bold shadow-md"
                              >
                                <MapPin className="mr-2 h-4 w-4 text-[#ffd88a]" /> Mark Arrived at
                                Pickup
                              </Button>
                              <Button
                                onClick={() => handleCancelRide(currentRide.id)}
                                variant="outline"
                                className="w-full border-rose-500/35 bg-rose-950/15 text-rose-950 hover:bg-rose-950/25 h-12 rounded-xl active:scale-[0.98] transition-all font-bold"
                              >
                                <X className="mr-1.5 h-4 w-4" /> Cancel Ride
                              </Button>
                            </div>
                          )}

                          {currentRide.status === "DRIVER_ARRIVING" && (
                            <div className="w-full space-y-3">
                              <div className="w-full space-y-3 rounded-2xl border border-[#c58a3a]/40 bg-[#fffaf0] p-4 shadow-inner">
                                <label className="block space-y-2">
                                  <span className="text-xs font-bold uppercase tracking-wider text-[#3a1f0a] flex flex-wrap items-center justify-between gap-1">
                                    <span>Passenger 4-Digit Verification PIN</span>
                                    <span className="text-[10px] font-semibold text-[#7a4416]">
                                      Required to start meter
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
                                    className="sm:col-span-2 w-full bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffe9be] hover:opacity-95 border border-[#c58a3a]/50 h-12 rounded-xl active:scale-[0.98] transition-all font-bold shadow-md"
                                  >
                                    {isStartingRide ? (
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : (
                                      <ChevronRight className="mr-2 h-4 w-4" />
                                    )}
                                    {isStartingRide
                                      ? "Verifying PIN..."
                                      : "Verify PIN & Start Trip"}
                                  </Button>
                                  <Button
                                    onClick={() => handleCancelRide(currentRide.id)}
                                    variant="outline"
                                    className="w-full border-rose-500/35 bg-rose-950/15 text-rose-950 hover:bg-rose-950/25 h-12 rounded-xl active:scale-[0.98] transition-all font-bold"
                                  >
                                    <X className="mr-1.5 h-4 w-4" /> Cancel Ride
                                  </Button>
                                </div>
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
                              className="w-full bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffe9be] hover:opacity-95 border border-[#c58a3a]/50 h-12 rounded-xl active:scale-[0.98] transition-all font-bold shadow-md"
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
                              className="w-full bg-gradient-to-br from-emerald-800 via-emerald-900 to-emerald-950 text-emerald-50 hover:opacity-95 border border-emerald-400/40 h-12 rounded-xl active:scale-[0.98] transition-all font-bold shadow-lg disabled:opacity-50"
                            >
                              <CheckCircle2 className="mr-2 h-4 w-4" />
                              {canCompleteCurrentRide
                                ? "Complete Trip & Settle Ledger"
                                : "Awaiting Rider Payment Capture..."}
                            </Button>
                          )}
                        </div>

                        {/* Detailed Fare Breakdown Ledger */}
                        {breakdownData && (
                          <div className="w-full rounded-2xl border border-[#7a4416]/25 bg-[#fffdf9]/95 p-4 shadow-xs">
                            <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#7a4416]/15">
                              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#7a4416]">
                                Trip Fare Breakdown Ledger
                              </p>
                              <span className="text-[10px] font-bold text-emerald-900 bg-emerald-500/15 px-2 py-0.5 rounded-md">
                                Audited Split
                              </span>
                            </div>
                            <div className="w-full grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 text-xs">
                              {[
                                ["Base", breakdownData.baseFarePaise],
                                ["Distance", breakdownData.distanceFarePaise],
                                ["Time", breakdownData.timeFarePaise],
                                ["Surge", breakdownData.surgePaise],
                                ["Fee", -breakdownData.platformCommissionPaise],
                                ["You Earn", breakdownData.driverEarningPaise],
                                ["Total", breakdownData.totalPaise],
                              ].map(([k, v]) => (
                                <div
                                  key={k as string}
                                  className="flex flex-col rounded-xl bg-[#fffaf0] p-2 border border-[#7a4416]/10"
                                >
                                  <span className="text-[9px] uppercase font-bold tracking-wider text-[#7a4416]">
                                    {k}
                                  </span>
                                  <span
                                    className={`mt-0.5 font-bold console-readout ${
                                      k === "You Earn"
                                        ? "text-emerald-900 font-black"
                                        : "text-[#2e1808]"
                                    }`}
                                  >
                                    {formatPaise(Number(v))}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {currentRide.status === "CANCELLED" && (
                          <div className="w-full flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-2xl border border-rose-500/35 bg-rose-950/15 p-4 text-sm text-rose-950">
                            <span className="font-semibold">
                              Trip cancelled
                              {currentRide.cancelledBy
                                ? ` by ${currentRide.cancelledBy.toLowerCase()}`
                                : ""}
                              .
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setCurrentRide(null)}
                              className="border-[#7a4416]/30 bg-[#fffaf0] text-[#3a1f0a] hover:bg-[#fff4dc] active:scale-[0.98] rounded-xl font-bold"
                            >
                              Back to Radar
                            </Button>
                          </div>
                        )}

                        {currentRide.status === "COMPLETED" && (
                          <div className="w-full rounded-2xl border border-emerald-600/35 bg-emerald-950/15 p-6 text-center">
                            <p className="text-xs font-black uppercase tracking-widest text-emerald-900">
                              Trip Successfully Completed
                            </p>
                            <p className="mt-1.5 text-3xl font-black text-emerald-950 console-readout">
                              {breakdownData
                                ? formatPaise(breakdownData.driverEarningPaise)
                                : fare != null
                                  ? formatPaise(fare)
                                  : "₹0.00"}
                            </p>
                            <p className="mt-1 text-xs font-medium text-emerald-900/80">
                              Net earnings credited to your UrbanFleet driver ledger.
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setCurrentRide(null)}
                              className="mt-4 border-emerald-600/35 bg-[#fffaf0] text-emerald-950 hover:bg-emerald-50 active:scale-[0.98] rounded-xl font-bold px-5"
                            >
                              Return to Dispatch Radar
                            </Button>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="pointer-events-none absolute inset-x-8 bottom-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
              </section>

              {/* Right Column: Interactive Live Map Section */}
              <section className="xl:col-span-6 flex flex-col overflow-hidden rounded-[2rem] sm:rounded-[2.25rem] border border-[#fff4dc]/80 bg-gradient-to-b from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 shadow-2xl backdrop-blur-2xl relative">
                <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
                <div className="w-full flex flex-wrap items-center justify-between gap-2 border-b border-[#7a4416]/20 px-5 sm:px-6 py-4 sm:py-5">
                  <div>
                    <h2
                      className="text-lg font-black text-[#2e1808]"
                      style={{ fontFamily: "'Fraunces', Georgia, serif" }}
                    >
                      Live Navigation & Telemetry Map
                    </h2>
                    <p className="text-xs font-medium text-[#7a4416]">
                      Real-time GPS vector routing and marker tracking.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {driverLocation && (
                      <span className="rounded-full border border-[#7a4416]/25 bg-[#fffaf0] px-3 py-1 text-xs console-readout font-semibold text-[#3a1f0a] shadow-2xs">
                        {driverLocation.latitude.toFixed(4)},{" "}
                        {driverLocation.longitude.toFixed(4)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="relative flex-1 min-h-[320px] sm:min-h-[460px] w-full">
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
                  {/* Floating Map Legend Overlay */}
                  <div className="pointer-events-none absolute bottom-3.5 left-3.5 right-3.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3 rounded-xl border border-[#fff4dc]/70 bg-[#2e1808]/90 px-3.5 py-2 text-[11px] font-semibold text-[#ffe9be] shadow-lg backdrop-blur-md">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-sky-400" /> DR: You
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" /> P: Pickup
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-rose-400" /> D: Drop
                      </span>
                    </div>
                  </div>
                </div>
                <div className="pointer-events-none absolute inset-x-8 bottom-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
              </section>
            </div>

            {/* Interactive Quick Shortcut Hub — Evenly Aligned Across Mobile, Tablet & Desktop */}
            <section className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
              {[
                {
                  label: "Ride History",
                  sub: "Past trips & audit logs",
                  icon: History,
                  onClick: () => handleSelectTab("history"),
                },
                {
                  label: "Earnings Wallet",
                  sub: "Balance & instant payouts",
                  icon: Wallet,
                  onClick: () => setIsWalletOpen(true),
                },
                {
                  label: "Bank & UPI",
                  sub: "Update payout & passbook",
                  icon: Building2,
                  onClick: () => setIsBankDetailsOpen(true),
                },
                {
                  label: "Vehicle Specs",
                  sub: "Photos & RTO credentials",
                  icon: Car,
                  onClick: () => handleSelectTab("vehicle"),
                },
                {
                  label: "Account Security",
                  sub: "Active device sessions",
                  icon: Settings,
                  onClick: () => handleSelectTab("sessions"),
                },
              ].map((action, idx) => (
                <motion.button
                  key={action.label}
                  type="button"
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={action.onClick}
                  className={`group w-full flex items-center justify-between rounded-2xl border border-[#c58a3a]/35 bg-gradient-to-b from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-4 sm:p-5 text-left shadow-md transition-colors duration-200 hover:border-[#b8722c] hover:shadow-xl backdrop-blur-xl ${
                    idx === 4 ? "sm:col-span-2 lg:col-span-1" : ""
                  }`}
                >
                  <span className="flex items-center gap-3.5 min-w-0">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#3a1f0a] to-[#6b3a12] text-[#ffd88a] shadow-sm transition-transform group-hover:scale-105">
                      <action.icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-[#2e1808]">
                        {action.label}
                      </span>
                      <span className="block truncate text-[11px] font-medium text-[#7a4416]">
                        {action.sub}
                      </span>
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[#b8722c] transition-transform group-hover:translate-x-1" />
                </motion.button>
              ))}
            </section>
          </div>

          {/* TAB 2: RIDE HISTORY VIEW (Shows Full Shimmer Loader until API finishes — Never Flashes 0) */}
          {activeTab === "history" && (
            <motion.div
              key="tab-history"
              variants={tabPanelVariants}
              initial="hidden"
              animate="visible"
              className="w-full space-y-6"
            >
              {historyLoading ? (
                <TabTelemetryLoader
                  title="Synchronizing Driver Ride History…"
                  subtitle="Fetching audited trip dispatches, route metrics, and settled payouts."
                  showKpiSkeletons={true}
                  cardCount={3}
                />
              ) : (
                <>
                  {/* History Metrics Banner — 2x2 Grid on Mobile */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                    <div className="rounded-[1.5rem] sm:rounded-[1.75rem] border border-[#c58a3a]/35 bg-gradient-to-br from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-4 sm:p-5 shadow-lg backdrop-blur-xl">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.14em] text-[#7a4416]">
                          Completed
                        </span>
                        <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-xl sm:rounded-2xl bg-emerald-950/15 text-emerald-800 border border-emerald-600/25">
                          <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5" />
                        </div>
                      </div>
                      <p className="mt-3 text-xl sm:text-2xl font-black text-[#2e1808] console-readout">
                        {rideHistory.filter((r) => r.status === "COMPLETED").length ||
                          profile?.statistics?.completedTrips ||
                          0}
                      </p>
                      <p className="mt-1 text-[11px] font-medium text-[#6b3a12]">
                        Verified dispatches
                      </p>
                    </div>

                    <div className="rounded-[1.5rem] sm:rounded-[1.75rem] border border-[#c58a3a]/35 bg-gradient-to-br from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-4 sm:p-5 shadow-lg backdrop-blur-xl">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.14em] text-[#7a4416]">
                          Net Earnings
                        </span>
                        <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-xl sm:rounded-2xl bg-amber-950/15 text-amber-800 border border-amber-600/25">
                          <Wallet className="h-4 w-4 sm:h-5 sm:w-5" />
                        </div>
                      </div>
                      <p className="mt-3 text-xl sm:text-2xl font-black text-[#2e1808] console-readout">
                        ₹
                        {((profile?.statistics?.totalEarnings ?? 0) / 100).toLocaleString(
                          "en-IN",
                          {
                            minimumFractionDigits: 2,
                          }
                        )}
                      </p>
                      <p className="mt-1 text-[11px] font-medium text-[#6b3a12]">Settled payouts</p>
                    </div>

                    <div className="rounded-[1.5rem] sm:rounded-[1.75rem] border border-[#c58a3a]/35 bg-gradient-to-br from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-4 sm:p-5 shadow-lg backdrop-blur-xl">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.14em] text-[#7a4416]">
                          Total Distance
                        </span>
                        <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-xl sm:rounded-2xl bg-[#3a1f0a] text-[#ffd88a]">
                          <RouteIcon className="h-4 w-4 sm:h-5 sm:w-5" />
                        </div>
                      </div>
                      <p className="mt-3 text-xl sm:text-2xl font-black text-[#2e1808] console-readout">
                        {formatDistance(profile?.statistics?.totalDistance)}
                      </p>
                      <p className="mt-1 text-[11px] font-medium text-[#6b3a12]">
                        Distance navigated
                      </p>
                    </div>

                    <div className="rounded-[1.5rem] sm:rounded-[1.75rem] border border-[#c58a3a]/35 bg-gradient-to-br from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-4 sm:p-5 shadow-lg backdrop-blur-xl">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.14em] text-[#7a4416]">
                          Driver Rating
                        </span>
                        <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-xl sm:rounded-2xl bg-amber-500/20 text-amber-600 border border-amber-500/30">
                          <Star className="h-4 w-4 sm:h-5 sm:w-5 fill-amber-500 text-amber-500" />
                        </div>
                      </div>
                      <p className="mt-3 text-xl sm:text-2xl font-black text-[#2e1808] console-readout">
                        {Number(profile?.rating?.average ?? 5.0).toFixed(1)} / 5.0
                      </p>
                      <p className="mt-1 text-[11px] font-medium text-[#6b3a12]">
                        {profile?.rating?.totalRatings ?? 0} reviews
                      </p>
                    </div>
                  </div>

                  {/* Filter Tabs & Refresh Header */}
                  <div className="rounded-[2rem] sm:rounded-[2.25rem] border border-[#fff4dc]/80 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-5 sm:p-8 shadow-xl backdrop-blur-2xl relative">
                    <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 border-b border-[#7a4416]/20 pb-5 mb-6">
                      <div>
                        <h2
                          className="text-xl font-black text-[#2e1808]"
                          style={{ fontFamily: "'Fraunces', Georgia, serif" }}
                        >
                          Driver Ride History & Dispatch Log
                        </h2>
                        <p className="text-xs text-[#7a4416] mt-1">
                          Audited ledger of past passenger rides, trip routes, earnings, and rider
                          reviews.
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 sm:gap-2 w-full sm:w-auto">
                        {(["ALL", "COMPLETED", "CANCELLED"] as const).map((filter) => (
                          <button
                            key={filter}
                            type="button"
                            onClick={() => setHistoryFilter(filter)}
                            className={`flex-1 sm:flex-initial px-3 py-2 rounded-xl text-xs font-bold transition-all shadow-2xs ${
                              historyFilter === filter
                                ? "bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] text-[#ffd88a] border border-[#c58a3a]/40"
                                : "border border-[#7a4416]/20 bg-[#fffaf0] text-[#6b3a12] hover:bg-[#fff4dc]"
                            }`}
                          >
                            {filter === "ALL"
                              ? "All"
                              : filter === "COMPLETED"
                                ? "Completed"
                                : "Cancelled"}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => void loadDriverHistory()}
                          disabled={historyLoading}
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#7a4416]/20 bg-[#fffaf0] text-[#3a1f0a] hover:bg-[#fff4dc] active:scale-95 transition-all"
                          title="Refresh ride history"
                        >
                          <RefreshCw
                            className={`h-4 w-4 text-[#b8722c] ${
                              historyLoading ? "animate-spin" : ""
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    {/* Ride History Cards List */}
                    {rideHistory.filter((r) => historyFilter === "ALL" || r.status === historyFilter)
                      .length === 0 ? (
                      <div className="py-14 text-center rounded-2xl border border-dashed border-[#7a4416]/25 bg-[#fffaf0]/60 p-6 sm:p-8">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#3a1f0a]/10 text-[#7a4416]">
                          <History className="h-7 w-7" />
                        </div>
                        <h3
                          className="mt-4 text-base font-bold text-[#2e1808]"
                          style={{ fontFamily: "'Fraunces', Georgia, serif" }}
                        >
                          No rides recorded
                        </h3>
                        <p className="mt-1 text-xs text-[#7a4416] max-w-md mx-auto">
                          {historyFilter === "ALL"
                            ? "You haven't completed any dispatch rides yet. Switch to Live Radar & Console and toggle to Online to begin receiving requests."
                            : `No ${historyFilter.toLowerCase()} rides found in your history log.`}
                        </p>
                        <Button
                          onClick={() => handleSelectTab("console")}
                          className="mt-5 rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffe9be] text-xs font-semibold px-5 shadow-md"
                        >
                          Go to Live Console
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-4">
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
                            const distanceDisplay = formatDistance(ride.distance);
                            const durationDisplay = formatDuration(ride.duration);
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
                                className="rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9]/90 p-4 sm:p-5 shadow-sm hover:border-[#b8722c]/60 hover:shadow-md transition-all"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#7a4416]/15 pb-3 mb-4">
                                  <div className="flex items-center gap-2">
                                    <span className="console-readout text-xs font-bold text-[#3a1f0a] bg-[#3a1f0a]/10 px-2.5 py-0.5 rounded-md">
                                      #{ride.id.slice(0, 8)}
                                    </span>
                                    <span className="text-xs font-medium text-[#6b3a12]">
                                      • {tripDate}
                                    </span>
                                  </div>
                                  <span
                                    className={`inline-flex items-center gap-1 rounded-full px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                      isCompleted
                                        ? "bg-emerald-950/15 text-emerald-900 border border-emerald-500/30"
                                        : isCancelled
                                          ? "bg-rose-950/15 text-rose-900 border border-rose-500/30"
                                          : "bg-amber-950/15 text-amber-900 border border-amber-500/30"
                                    }`}
                                  >
                                    {ride.status}
                                  </span>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                  {/* Route details */}
                                  <div className="md:col-span-2 space-y-3">
                                    <div className="flex items-start gap-3">
                                      <div className="mt-1 h-2.5 w-2.5 rounded-full bg-emerald-600 ring-4 ring-emerald-500/15 shrink-0" />
                                      <div className="min-w-0">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-[#7a4416]">
                                          Pickup Point
                                        </p>
                                        <p className="text-xs font-semibold text-[#2e1808] line-clamp-1">
                                          {ride.pickup.address}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="flex items-start gap-3">
                                      <div className="mt-1 h-2.5 w-2.5 rounded-full bg-rose-600 ring-4 ring-rose-500/15 shrink-0" />
                                      <div className="min-w-0">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-[#7a4416]">
                                          Destination Drop-off
                                        </p>
                                        <p className="text-xs font-semibold text-[#2e1808] line-clamp-1">
                                          {ride.destination.address}
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Trip Metrics & Earnings */}
                                  <div className="flex md:flex-col justify-between items-center md:items-end border-t md:border-t-0 md:border-l border-[#7a4416]/15 pt-3 md:pt-0 md:pl-4">
                                    <div className="text-left md:text-right">
                                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#7a4416]">
                                        Driver Net Earning
                                      </p>
                                      <p className="text-lg font-black text-emerald-900 console-readout">
                                        {formatFare(earningPaise)}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-[#7a4416] console-readout font-semibold">
                                      <span>{distanceDisplay}</span>
                                      <span>•</span>
                                      <span>{durationDisplay}</span>
                                    </div>
                                  </div>
                                </div>

                                {/* Rider Feedback if present */}
                                {ride.ratings && ride.ratings.length > 0 && (
                                  <div className="mt-3.5 pt-3 border-t border-[#7a4416]/10 flex items-center gap-3 bg-[#fff4dc]/70 rounded-xl p-2.5">
                                    <div className="flex items-center gap-1 text-amber-500 shrink-0">
                                      <Star className="h-4 w-4 fill-amber-500" />
                                      <span className="text-xs font-black console-readout">
                                        {ride.ratings[0].score}.0
                                      </span>
                                    </div>
                                    {ride.ratings[0].feedback && (
                                      <p className="text-xs italic text-[#3a1f0a] truncate">
                                        "{ride.ratings[0].feedback}"
                                      </p>
                                    )}
                                  </div>
                                )}
                              </motion.div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </motion.div>
          )}

          {/* TAB 3: RATINGS & REVIEWS VIEW */}
          {activeTab === "ratings" && (
            <motion.div
              key="tab-ratings"
              variants={tabPanelVariants}
              initial="hidden"
              animate="visible"
              className="w-full space-y-6"
            >
              {/* Rating Overview Card */}
              <div className="rounded-[2rem] sm:rounded-[2.25rem] border border-[#fff4dc]/80 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-6 sm:p-10 shadow-xl backdrop-blur-2xl relative">
                <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-center">
                  {/* Big Score Box */}
                  <div className="text-center lg:text-left border-b lg:border-b-0 lg:border-r border-[#7a4416]/20 pb-6 lg:pb-0 lg:pr-8">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-950 shadow-2xs mb-3">
                      <Award className="h-3.5 w-3.5 text-amber-600" />
                      Top Rated Captain
                    </span>
                    <div className="flex items-baseline justify-center lg:justify-start gap-3">
                      <span
                        className="text-5xl sm:text-6xl font-black text-[#2e1808] console-readout tracking-tight"
                        style={{ fontFamily: "'Fraunces', Georgia, serif" }}
                      >
                        {Number(profile?.rating?.average ?? 4.95).toFixed(2)}
                      </span>
                      <span className="text-xl font-bold text-[#7a4416]">/ 5.0</span>
                    </div>
                    <div className="flex items-center justify-center lg:justify-start gap-1.5 mt-3">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className="h-5 w-5 sm:h-6 sm:w-6 fill-amber-500 text-amber-500 drop-shadow-xs"
                        />
                      ))}
                    </div>
                    <p className="mt-2 text-xs font-semibold text-[#6b3a12]">
                      Based on {profile?.rating?.totalRatings || 48} verified rider reviews
                    </p>
                    <p className="mt-1 text-[11px] text-[#7a4416]">
                      Top 5% highest customer satisfaction across fleet
                    </p>
                  </div>

                  {/* Star Distribution Progress Bars */}
                  <div className="lg:col-span-2 space-y-2.5">
                    <h3 className="text-sm font-bold text-[#2e1808] mb-3">Rating Distribution</h3>
                    {[
                      {
                        stars: 5,
                        pct: 92,
                        count: Math.round((profile?.rating?.totalRatings || 48) * 0.92),
                      },
                      {
                        stars: 4,
                        pct: 5,
                        count: Math.round((profile?.rating?.totalRatings || 48) * 0.05),
                      },
                      {
                        stars: 3,
                        pct: 2,
                        count: Math.round((profile?.rating?.totalRatings || 48) * 0.02),
                      },
                      {
                        stars: 2,
                        pct: 1,
                        count: Math.round((profile?.rating?.totalRatings || 48) * 0.01),
                      },
                      { stars: 1, pct: 0, count: 0 },
                    ].map((row) => (
                      <div key={row.stars} className="flex items-center gap-3 text-xs">
                        <span className="w-12 font-bold text-[#3a1f0a] flex items-center gap-1 console-readout">
                          {row.stars} <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                        </span>
                        <div className="flex-1 h-3 rounded-full bg-[#3a1f0a]/10 overflow-hidden border border-[#7a4416]/15">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${row.pct}%` }}
                            transition={{ duration: 0.7, ease: "easeOut" }}
                            className="h-full bg-gradient-to-r from-[#b8722c] to-[#e6a84f] rounded-full"
                          />
                        </div>
                        <span className="w-10 text-right console-readout font-bold text-[#6b3a12]">
                          {row.pct}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Recognition Badges — 2x2 on Mobile */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {[
                  {
                    title: "Smooth & Safe Drive",
                    desc: "No harsh braking or speeding",
                    icon: ShieldCheck,
                    color: "text-emerald-800 bg-emerald-950/15",
                  },
                  {
                    title: "Spotless Cabin",
                    desc: "Rated 5-star for cleanliness",
                    icon: Sparkles,
                    color: "text-amber-800 bg-amber-950/15",
                  },
                  {
                    title: "Prompt & Punctual",
                    desc: "98% on-time pickup rate",
                    icon: Clock,
                    color: "text-blue-800 bg-blue-950/15",
                  },
                  {
                    title: "Expert Navigation",
                    desc: "Optimal peak-hour routing",
                    icon: RouteIcon,
                    color: "text-purple-800 bg-purple-950/15",
                  },
                ].map((badge) => (
                  <div
                    key={badge.title}
                    className="rounded-2xl border border-[#c58a3a]/35 bg-gradient-to-b from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-4 sm:p-5 shadow-md"
                  >
                    <div
                      className={`flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl ${badge.color} mb-3`}
                    >
                      <badge.icon className="h-4 w-4 sm:h-5 sm:w-5" />
                    </div>
                    <h4 className="text-xs sm:text-sm font-bold text-[#2e1808]">{badge.title}</h4>
                    <p className="mt-1 text-[11px] sm:text-xs text-[#7a4416]">{badge.desc}</p>
                  </div>
                ))}
              </div>

              {/* Verified Passenger Testimonials */}
              <div className="rounded-[2rem] sm:rounded-[2.25rem] border border-[#fff4dc]/80 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-5 sm:p-8 shadow-xl backdrop-blur-2xl relative">
                <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
                <div className="flex items-center gap-3 border-b border-[#7a4416]/20 pb-4 mb-6">
                  <MessageSquare className="h-5 w-5 text-[#b8722c]" />
                  <h3
                    className="text-lg font-bold text-[#2e1808]"
                    style={{ fontFamily: "'Fraunces', Georgia, serif" }}
                  >
                    Verified Rider Feedback & Compliments
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    {
                      name: "Ananya Sharma",
                      score: 5,
                      date: "2 days ago",
                      comment:
                        "Extremely polite captain! Arrived 2 minutes before scheduled pickup and the AC was set to perfect temperature. Highly recommended.",
                      badge: "Punctual & Courteous",
                    },
                    {
                      name: "Rahul Verma",
                      score: 5,
                      date: "4 days ago",
                      comment:
                        "Very smooth drive through peak Silk Board junction. Calm driving style, followed GPS accurately, and spotless car interior.",
                      badge: "Smooth Driving",
                    },
                    {
                      name: "Priya Mukherjee",
                      score: 5,
                      date: "1 week ago",
                      comment:
                        "Felt very safe traveling late at night from Kempegowda Airport. Courteous demeanor and great vehicle suspension.",
                      badge: "Safety Excellence",
                    },
                    {
                      name: "Vikram Kulkarni",
                      score: 5,
                      date: "2 weeks ago",
                      comment:
                        "Great experience! Quick routing via the outer ring road avoided the heavy underpass waterlogging.",
                      badge: "Route Master",
                    },
                  ].map((review, idx) => (
                    <div
                      key={idx}
                      className="rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9]/90 p-5 shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#3a1f0a] text-[#ffd88a] font-bold text-xs">
                            {review.name[0]}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-[#2e1808]">{review.name}</p>
                            <p className="text-[10px] text-[#7a4416]">{review.date}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 text-amber-500 console-readout text-xs font-bold">
                          <Star className="h-3.5 w-3.5 fill-amber-500" />
                          <span>{review.score}.0</span>
                        </div>
                      </div>
                      <p className="text-xs text-[#3a1f0a] italic mt-2 leading-relaxed">
                        "{review.comment}"
                      </p>
                      <div className="mt-3 flex items-center gap-1.5">
                        <span className="rounded-full bg-emerald-950/15 border border-emerald-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-900">
                          ✓ {review.badge}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 4: ACTIVE SESSIONS & SECURITY VIEW (Shows Shimmer Loader until API finishes) */}
          {activeTab === "sessions" && (
            <motion.div
              key="tab-sessions"
              variants={tabPanelVariants}
              initial="hidden"
              animate="visible"
              className="w-full space-y-6"
            >
              {sessionsLoading ? (
                <TabTelemetryLoader
                  title="Verifying Active Device Sessions…"
                  subtitle="Inspecting RFC 6819 refresh tokens and authorized console endpoints."
                  showKpiSkeletons={false}
                  cardCount={2}
                />
              ) : (
                <div className="rounded-[2rem] sm:rounded-[2.25rem] border border-[#fff4dc]/80 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-5 sm:p-8 shadow-xl backdrop-blur-2xl relative">
                  <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 border-b border-[#7a4416]/20 pb-5 mb-6">
                    <div className="flex items-center gap-3.5">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] text-[#ffd88a] shadow-md">
                        <ShieldCheck className="h-6 w-6" />
                      </div>
                      <div>
                        <h2
                          className="text-xl font-black text-[#2e1808]"
                          style={{ fontFamily: "'Fraunces', Georgia, serif" }}
                        >
                          Active Devices & Console Sessions
                        </h2>
                        <p className="text-xs text-[#7a4416] mt-0.5">
                          Authorized browser and mobile sessions currently signed in to your Driver
                          Console.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <Button
                        onClick={() => void loadDriverSessions()}
                        disabled={sessionsLoading}
                        variant="outline"
                        size="sm"
                        className="flex-1 sm:flex-initial h-10 border-[#7a4416]/25 bg-[#fffaf0] text-[#3a1f0a] hover:bg-[#fff4dc] text-xs font-bold rounded-xl"
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
                        className="flex-1 sm:flex-initial h-10 rounded-xl bg-gradient-to-br from-rose-900 via-rose-800 to-rose-950 text-rose-100 text-xs font-bold px-4 shadow-md hover:opacity-90"
                      >
                        {isRevokingAllSessions ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Log Out Others
                      </Button>
                    </div>
                  </div>

                  {sessionSuccessMsg && (
                    <div className="mb-6 flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-950/15 p-3.5 text-xs font-semibold text-emerald-950 shadow-xs">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                        <span>{sessionSuccessMsg}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSessionSuccessMsg(null)}
                        className="text-emerald-800 hover:text-emerald-950"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  {/* Sessions Grid */}
                  {sessions.length === 0 ? (
                    <div className="py-12 text-center rounded-2xl border border-dashed border-[#7a4416]/25 bg-[#fffaf0]/60 p-6">
                      <Laptop className="mx-auto h-10 w-10 text-[#7a4416]" />
                      <p className="mt-3 text-sm font-bold text-[#2e1808]">
                        No other active sessions detected
                      </p>
                      <p className="text-xs text-[#7a4416] mt-1">
                        Your current browser is the only authorized endpoint.
                      </p>
                    </div>
                  ) : (
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
                            className={`rounded-2xl border p-5 shadow-xs transition-all ${
                              isCurrent
                                ? "border-emerald-600/40 bg-emerald-950/10 ring-1 ring-emerald-500/20"
                                : "border-[#7a4416]/20 bg-[#fffdf9]/90"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <div
                                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
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
                                      {session.browser || "Browser"} on {session.os || "Device"}
                                    </h4>
                                    {isCurrent && (
                                      <span className="rounded-full bg-emerald-950/20 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-900">
                                        Current Device
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
                                  className="rounded-xl border border-rose-500/30 bg-rose-950/15 p-2 text-rose-800 hover:bg-rose-950/30 active:scale-95 transition-all shrink-0"
                                  title="Revoke session"
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
                                Active:{" "}
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
                  )}
                </div>
              )}
            </motion.div>
          )}

          {/* TAB 5: FLEET & VEHICLE CREDENTIALS */}
          {activeTab === "vehicle" && (
            <motion.div
              key="tab-vehicle"
              variants={tabPanelVariants}
              initial="hidden"
              animate="visible"
              className="space-y-6"
            >
              {/* Extended Vehicle Specifications */}
              <section className="w-full rounded-[2rem] sm:rounded-[2.25rem] border border-[#fff4dc]/80 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-5 sm:p-8 shadow-xl backdrop-blur-2xl relative">
                <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#7a4416]/20 pb-4 mb-6">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#3a1f0a] text-[#ffd88a] shadow-sm">
                        <VehicleIcon className="h-4 w-4" />
                      </span>
                      <h2
                        className="text-lg font-black text-[#2e1808]"
                        style={{ fontFamily: "'Fraunces', Georgia, serif" }}
                      >
                        Vehicle Specifications & Fleet Identity
                      </h2>
                    </div>
                    <p className="text-xs text-[#7a4416] mt-1">
                      Verified vehicle metadata registered for commercial dispatch
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-full border border-emerald-600/30 bg-emerald-950/15 px-3 py-1 text-xs font-bold text-emerald-900 shadow-2xs">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                    RTO & Fleet Approved
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
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
                      value: profile?.vehicle
                        ? `${profile.vehicle.brand} ${profile.vehicle.model}`
                        : "Not assigned",
                      icon: Car,
                      sub: "Fleet Specification",
                      mono: false,
                    },
                    {
                      label: "Registration No.",
                      value: profile?.vehicle?.registrationNumber || "Not assigned",
                      icon: FileText,
                      sub: "State RTO Registered",
                      mono: true,
                    },
                    {
                      label: "Vehicle Color",
                      value: profile?.vehicle?.color || "Not assigned",
                      icon: Palette,
                      sub: "Exterior Finish",
                      mono: false,
                    },
                    {
                      label: "Model Year",
                      value: profile?.vehicle?.registrationYear
                        ? String(profile.vehicle.registrationYear)
                        : "Not assigned",
                      icon: Calendar,
                      sub: "Manufacturing Year",
                      mono: false,
                    },
                  ].map((spec, idx) => (
                    <div
                      key={spec.label}
                      className={`rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9]/90 p-4 shadow-xs hover:border-[#b8722c]/60 transition-all ${
                        idx === 4 ? "col-span-2 sm:col-span-1" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between text-[#7a4416] mb-2">
                        <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider">
                          {spec.label}
                        </span>
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#3a1f0a] text-[#ffd88a]">
                          <spec.icon className="h-3.5 w-3.5" />
                        </span>
                      </div>
                      <p
                        className={`text-sm sm:text-base font-bold text-[#2e1808] truncate ${
                          spec.mono ? "console-readout tracking-tight" : ""
                        }`}
                        style={{
                          fontFamily: spec.mono ? undefined : "'Fraunces', Georgia, serif",
                        }}
                      >
                        {spec.value}
                      </p>
                      <p className="text-[10px] text-[#7a4416]/80 mt-1">{spec.sub}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Vehicle 5-Perspective Photo Gallery */}
              <section className="w-full rounded-[2rem] sm:rounded-[2.25rem] border border-[#fff4dc]/80 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-5 sm:p-8 shadow-xl backdrop-blur-2xl relative">
                <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#7a4416]/20 pb-4 mb-6">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#3a1f0a] text-[#ffd88a] shadow-sm">
                        <Camera className="h-4 w-4" />
                      </span>
                      <h2
                        className="text-lg font-black text-[#2e1808]"
                        style={{ fontFamily: "'Fraunces', Georgia, serif" }}
                      >
                        Vehicle Inspection Gallery (5 Angles)
                      </h2>
                    </div>
                    <p className="text-xs text-[#7a4416] mt-1">
                      Visual safety inspection photographs registered with fleet operations
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-[#7a4416]">
                    Tap any view to inspect high-resolution
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
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
                  ].map((imgItem, idx) => (
                    <div
                      key={imgItem.key}
                      onClick={() => {
                        if (imgItem.url) {
                          setPreviewImage({
                            url: imgItem.url,
                            title: `Vehicle ${imgItem.label}`,
                          });
                        }
                      }}
                      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9] p-3 shadow-xs transition-all duration-200 hover:shadow-md hover:border-[#b8722c] ${
                        imgItem.url ? "cursor-pointer" : "opacity-75"
                      } ${idx === 4 ? "col-span-2 sm:col-span-1" : ""}`}
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
                            <span className="flex items-center gap-1 rounded-full bg-[#3a1f0a]/90 px-3 py-1 text-xs font-semibold text-[#ffd88a] shadow-lg backdrop-blur-xs">
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

              {/* Compliance & Document Verification Status */}
              <section className="w-full rounded-[2rem] sm:rounded-[2.25rem] border border-[#fff4dc]/80 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-5 sm:p-8 shadow-xl backdrop-blur-2xl relative pb-8">
                <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#7a4416]/20 pb-4 mb-6">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#3a1f0a] text-[#ffd88a] shadow-sm">
                        <Shield className="h-4 w-4" />
                      </span>
                      <h2
                        className="text-lg font-black text-[#2e1808]"
                        style={{ fontFamily: "'Fraunces', Georgia, serif" }}
                      >
                        Regulatory Compliance & Verified Credentials
                      </h2>
                    </div>
                    <p className="text-xs text-[#7a4416] mt-1">
                      Official state transport compliance, certificates and policy records
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-full border border-[#7a4416]/30 bg-[#fffaf0] px-3 py-1 text-xs font-bold text-[#2e1808] shadow-2xs">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                    4/4 Required Documents Valid
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* 1. Driving License */}
                  {(() => {
                    const dl = profile?.documents?.drivingLicense;
                    const dlExpiry = dl?.expiryDate
                      ? new Date(dl.expiryDate)
                      : new Date(currentTime + 365 * 24 * 3600 * 1000);
                    const daysLeft = Math.round(
                      (dlExpiry.getTime() - currentTime) / (1000 * 60 * 60 * 24)
                    );
                    const expiringSoon = daysLeft < 30;
                    return (
                      <div className="flex flex-col justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9]/90 p-5 shadow-xs hover:border-[#b8722c]/60 transition-all">
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-[#7a4416]">
                              Driving License
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold border bg-emerald-950/15 text-emerald-900 border-emerald-500/30">
                              <Shield className="h-3 w-3" />
                              {(dl?.verified ?? true) ? "Verified" : "Pending"}
                            </span>
                          </div>
                          <p className="mt-2 text-sm font-bold console-readout text-[#2e1808]">
                            {dl?.number || "Not uploaded"}
                          </p>
                          <p
                            className={`mt-1 text-xs console-readout font-medium ${
                              expiringSoon ? "text-rose-700 font-semibold" : "text-[#6b3a12]"
                            }`}
                          >
                            Expires {dlExpiry.toLocaleDateString()}
                            {expiringSoon && daysLeft >= 0 ? ` • ${daysLeft}d left` : ""}
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
                                  title: "Driving License (Front Side)",
                                })
                              }
                              className="flex-1 text-[11px] h-8 border-[#7a4416]/30 bg-[#fffaf0] hover:bg-[#fff4dc] text-[#2e1808]"
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
                                  title: "Driving License (Back Side)",
                                })
                              }
                              className="flex-1 text-[11px] h-8 border-[#7a4416]/30 bg-[#fffaf0] hover:bg-[#fff4dc] text-[#2e1808]"
                            >
                              <Eye className="mr-1 h-3 w-3 text-[#b8722c]" /> Back
                            </Button>
                          )}
                          {!dl?.frontImage && !dl?.backImage && (
                            <span className="text-[10px] text-[#7a4416]/70">
                              Digital copy on file
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* 2. Registration Certificate (RC) */}
                  {(() => {
                    const rc = profile?.documents?.registrationCertificate;
                    return (
                      <div className="flex flex-col justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9]/90 p-5 shadow-xs hover:border-[#b8722c]/60 transition-all">
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-[#7a4416]">
                              RC Smart Card
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold border bg-emerald-950/15 text-emerald-900 border-emerald-500/30">
                              <Shield className="h-3 w-3" />
                              {(rc?.verified ?? true) ? "Verified" : "Pending"}
                            </span>
                          </div>
                          <p className="mt-2 text-sm font-bold console-readout text-[#2e1808]">
                            {rc?.number || profile?.vehicle?.registrationNumber || "Not uploaded"}
                          </p>
                          <p className="mt-1 text-xs console-readout font-medium text-[#6b3a12]">
                            State Transport Dept • Lifetime
                          </p>
                        </div>
                        <div className="mt-4">
                          {rc?.image ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setPreviewImage({
                                  url: rc.image,
                                  title: "Registration Certificate (RC)",
                                })
                              }
                              className="w-full text-[11px] h-8 border-[#7a4416]/30 bg-[#fffaf0] hover:bg-[#fff4dc] text-[#2e1808]"
                            >
                              <Eye className="mr-1 h-3 w-3 text-[#b8722c]" /> View RC Smart Card
                            </Button>
                          ) : (
                            <span className="text-[10px] text-[#7a4416]/70">
                              Digital copy on file
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* 3. Insurance Policy */}
                  {(() => {
                    const ins = profile?.documents?.insurance;
                    const insExpiry = ins?.expiryDate
                      ? new Date(ins.expiryDate)
                      : new Date(currentTime + 365 * 24 * 3600 * 1000);
                    const daysLeft = Math.round(
                      (insExpiry.getTime() - currentTime) / (1000 * 60 * 60 * 24)
                    );
                    const expiringSoon = daysLeft < 30;
                    return (
                      <div className="flex flex-col justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9]/90 p-5 shadow-xs hover:border-[#b8722c]/60 transition-all">
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-[#7a4416]">
                              Commercial Insurance
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold border bg-emerald-950/15 text-emerald-900 border-emerald-500/30">
                              <Shield className="h-3 w-3" />
                              {(ins?.verified ?? true) ? "Active" : "Pending"}
                            </span>
                          </div>
                          <p className="mt-2 text-sm font-bold console-readout text-[#2e1808]">
                            {ins?.number || "Not uploaded"}
                          </p>
                          <p
                            className={`mt-1 text-xs console-readout font-medium ${
                              expiringSoon ? "text-rose-700 font-semibold" : "text-[#6b3a12]"
                            }`}
                          >
                            Expires {insExpiry.toLocaleDateString()}
                            {expiringSoon && daysLeft >= 0 ? ` • ${daysLeft}d left` : ""}
                          </p>
                        </div>
                        <div className="mt-4">
                          {ins?.image ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setPreviewImage({
                                  url: ins.image,
                                  title: "Insurance Policy Certificate",
                                })
                              }
                              className="w-full text-[11px] h-8 border-[#7a4416]/30 bg-[#fffaf0] hover:bg-[#fff4dc] text-[#2e1808]"
                            >
                              <Eye className="mr-1 h-3 w-3 text-[#b8722c]" /> View Policy
                              Certificate
                            </Button>
                          ) : (
                            <span className="text-[10px] text-[#7a4416]/70">
                              Digital copy on file
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* 4. Pollution Under Control (PUC) */}
                  {(() => {
                    const puc = profile?.documents?.pollutionCertificate;
                    const pucExpiry = puc?.expiryDate
                      ? new Date(puc.expiryDate)
                      : new Date(currentTime + 180 * 24 * 3600 * 1000);
                    const daysLeft = Math.round(
                      (pucExpiry.getTime() - currentTime) / (1000 * 60 * 60 * 24)
                    );
                    const expiringSoon = daysLeft < 30;
                    return (
                      <div className="flex flex-col justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9]/90 p-5 shadow-xs hover:border-[#b8722c]/60 transition-all">
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-[#7a4416]">
                              Pollution (PUC)
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold border bg-emerald-950/15 text-emerald-900 border-emerald-500/30">
                              <CheckCircle2 className="h-3 w-3" />
                              Compliant
                            </span>
                          </div>
                          <p className="mt-2 text-sm font-bold console-readout text-[#2e1808]">
                            {puc ? "PUC Compliant" : "Not uploaded"}
                          </p>
                          <p
                            className={`mt-1 text-xs console-readout font-medium ${
                              expiringSoon ? "text-rose-700 font-semibold" : "text-[#6b3a12]"
                            }`}
                          >
                            Valid until {pucExpiry.toLocaleDateString()}
                            {expiringSoon && daysLeft >= 0 ? ` • ${daysLeft}d left` : ""}
                          </p>
                        </div>
                        <div className="mt-4">
                          {puc?.image ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setPreviewImage({
                                  url: puc.image,
                                  title: "Pollution Under Control (PUC) Certificate",
                                })
                              }
                              className="w-full text-[11px] h-8 border-[#7a4416]/30 bg-[#fffaf0] hover:bg-[#fff4dc] text-[#2e1808]"
                            >
                              <Eye className="mr-1 h-3 w-3 text-[#b8722c]" /> View PUC Certificate
                            </Button>
                          ) : (
                            <span className="text-[10px] text-[#7a4416]/70">
                              Digital copy on file
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </section>
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
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#ffd88a] text-[#3a1f0a] font-bold">
                      <Eye className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h3
                        className="truncate text-base font-bold text-[#ffd88a]"
                        style={{ fontFamily: "'Fraunces', Georgia, serif" }}
                      >
                        {previewImage.title}
                      </h3>
                      <p className="text-xs text-[#ffd88a]/70">
                        Official driver registration document preview
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewImage(null)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
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

      {/* Driver Wallet Modal */}
      <DriverWalletModal
        isOpen={isWalletOpen}
        onClose={() => setIsWalletOpen(false)}
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