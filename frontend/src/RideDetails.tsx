import { useEffect, useRef, useState, useMemo, useId } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Mail,
  Shield,
  Star,
  Car,
  Clock,
  Route as RouteIcon,
  IndianRupee,
  X,
  Loader2,
  CheckCircle2,
  Navigation2,
  Sparkles,
  AlertTriangle,
  Copy,
  Check,
} from "lucide-react";
import LoadingScreen from "./components/LoadingScreen";
import MapView from "./components/MapView";
import { appApi } from "./lib/api";
import { connectRiderSocket } from "./lib/socket";
import type { DriverLocationPayload, RideCancelledPayload } from "./lib/socket";
import {
  createPaymentOrder,
  loadRazorpayCheckout,
  verifyPaymentSignature,
  type PaymentStatus,
} from "./lib/payment";
import { useAuthContext } from "./context/auth-context";
import CityMapBackground from "./components/CityMapBackground";
import { formatFare, formatDistance, formatDuration, calculateHaversineDistanceKm } from "./lib/formatters";
import type { Coordinates } from "./types/location";
import type { RideDto as Ride, RideStatus } from "./types/ride";

const payableStatuses: PaymentStatus[] = ["CREATED", "PENDING", "AUTHORIZED"];

const DISPLAY_FONT = "'Fraunces', Georgia, serif";
const BODY_FONT = "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif";
const MONO_FONT = "'JetBrains Mono', ui-monospace, 'SF Mono', monospace";

const ANIMATION_STYLES = `
  @keyframes ufStampSlam {
    0% {
      opacity: 0;
      transform: scale(1.85) rotate(-18deg) translateZ(0);
      filter: blur(3px);
    }
    55% {
      opacity: 1;
      transform: scale(0.92) rotate(-4deg) translateZ(0);
      filter: blur(0px);
    }
    78% {
      transform: scale(1.04) rotate(-7.5deg) translateZ(0);
    }
    100% {
      opacity: 1;
      transform: scale(1) rotate(-6deg) translateZ(0);
    }
  }

  @keyframes ufInkShockwave {
    0% {
      transform: scale(0.75);
      opacity: 0.75;
    }
    100% {
      transform: scale(1.38);
      opacity: 0;
    }
  }

  @keyframes ufSpinSlow {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes ufDrawStroke {
    from {
      stroke-dashoffset: 100;
    }
    to {
      stroke-dashoffset: 0;
    }
  }

  @keyframes ufFloatPulse {
    0%, 100% {
      transform: translate(-50%, -50%) scale(1);
    }
    50% {
      transform: translate(-50%, -50%) scale(1.1);
    }
  }

  .uf-stamp-enter {
    animation: ufStampSlam 0.65s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    will-change: transform, opacity;
  }

  .uf-ink-wave {
    animation: ufInkShockwave 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.22s forwards;
    opacity: 0;
  }

  .uf-spin-slow {
    transform-origin: 80px 80px;
    animation: ufSpinSlow 28s linear infinite;
  }

  .uf-draw-icon {
    stroke-dasharray: 100;
    stroke-dashoffset: 100;
    animation: ufDrawStroke 0.55s cubic-bezier(0.65, 0, 0.35, 1) 0.3s forwards;
  }

  .uf-car-marker {
    animation: ufFloatPulse 2.4s ease-in-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .uf-stamp-enter,
    .uf-ink-wave,
    .uf-spin-slow,
    .uf-draw-icon,
    .uf-car-marker {
      animation: none !important;
      stroke-dashoffset: 0 !important;
      opacity: 1 !important;
      transform: none !important;
    }
  }
`;

const STATUS_STEPS: { key: RideStatus; label: string }[] = [
  { key: "SEARCHING", label: "Searching" },
  { key: "DRIVER_ASSIGNED", label: "Assigned" },
  { key: "DRIVER_ARRIVING", label: "Arriving" },
  { key: "RIDE_STARTED", label: "On Trip" },
  { key: "ARRIVED_AT_DESTINATION", label: "Arrived" },
  { key: "COMPLETED", label: "Settled" },
];

const STATUS_META: Record<RideStatus, { title: string; subtitle: string; accent: string }> = {
  SEARCHING: {
    title: "Finding your captain…",
    subtitle: "Matching you with the nearest verified luxury vehicle",
    accent: "#b8722c",
  },
  DRIVER_ASSIGNED: {
    title: "Captain assigned",
    subtitle: "Your driver is preparing to navigate to your pickup point",
    accent: "#c58a3a",
  },
  DRIVER_ARRIVING: {
    title: "Captain is arriving",
    subtitle: "Keep your 4-digit verification PIN ready for boarding",
    accent: "#d4a359",
  },
  RIDE_STARTED: {
    title: "In route to destination",
    subtitle: "Sit back and enjoy a tracked, secure journey",
    accent: "#047857",
  },
  ARRIVED_AT_DESTINATION: {
    title: "Arrived at destination",
    subtitle: "Complete your digital fare settlement below to close the trip",
    accent: "#c58a3a",
  },
  COMPLETED: {
    title: "Trip complete",
    subtitle: "Thank you for riding with UrbanFleet",
    accent: "#10b981",
  },
  CANCELLED: {
    title: "Ride cancelled",
    subtitle: "This dispatch is no longer active",
    accent: "#e11d48",
  },
};

function mergeRideLifecycle(current: Ride | null, payload: { ride: Ride }): Ride | null {
  if (current && current.id !== payload.ride.id) return current;
  return {
    ...current,
    ...payload.ride,
    otp: payload.ride.status === "RIDE_STARTED" ? null : current?.otp ?? payload.ride.otp,
  };
}

function TicketButton({
  children,
  onClick,
  disabled,
  variant = "primary",
  className = "",
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "success" | "danger" | "ghost";
  className?: string;
  type?: "button" | "submit";
}) {
  const styles: Record<string, string> = {
    primary:
      "bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffe9be] border border-[#c58a3a]/40 shadow-[0_12px_30px_-10px_rgba(58,31,10,0.6)]",
    success:
      "bg-gradient-to-br from-emerald-800 to-emerald-950 text-emerald-50 border border-emerald-500/40 shadow-[0_12px_30px_-10px_rgba(16,185,129,0.4)]",
    danger:
      "bg-gradient-to-br from-rose-800 to-rose-950 text-white border border-rose-500/40 shadow-[0_12px_30px_-10px_rgba(225,29,72,0.4)]",
    ghost: "bg-[#fffaf0] text-[#3a1f0a] border border-[#7a4416]/25 hover:bg-[#fff4dc]",
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`relative overflow-hidden rounded-2xl px-6 py-3.5 text-sm font-bold transition-all shadow-sm hover:opacity-95 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b8722c] focus-visible:ring-offset-2 ${styles[variant]} ${className}`}
    >
      <span className="relative z-10 inline-flex items-center justify-center gap-2">
        {children}
      </span>
    </button>
  );
}

function TicketStamp({
  label,
  sublabel,
  tone,
}: {
  label: string;
  sublabel: string;
  tone: "complete" | "void";
}) {
  const uid = useId().replace(/:/g, "");
  const topArcId = `ufStampTop_${uid}`;
  const bottomArcId = `ufStampBottom_${uid}`;

  const isComplete = tone === "complete";
  const primaryColor = isComplete ? "#047857" : "#be123c";
  const secondaryColor = isComplete ? "#10b981" : "#f43f5e";
  const tintBg = isComplete
    ? "radial-gradient(circle, rgba(16,185,129,0.14) 0%, rgba(4,120,87,0.04) 65%, transparent 100%)"
    : "radial-gradient(circle, rgba(244,63,94,0.14) 0%, rgba(190,18,60,0.04) 65%, transparent 100%)";
  const bottomText = isComplete ? "URBANFLEET • VERIFIED" : "DISPATCH • VOIDED";

  return (
    <div
      role="img"
      aria-label={`${label} — ${sublabel}`}
      className="relative mx-auto grid h-32 w-32 sm:h-36 sm:w-36 place-items-center select-none"
      style={{ color: primaryColor }}
    >
      {/* Expanding Ink Shockwave on Stamp Impact */}
      <span
        aria-hidden="true"
        className="uf-ink-wave pointer-events-none absolute inset-3 rounded-full border-2"
        style={{ borderColor: secondaryColor }}
      />

      {/* Main Stamp Body */}
      <div
        className="uf-stamp-enter relative grid h-full w-full place-items-center rounded-full"
        style={{ background: tintBg }}
      >
        <svg
          viewBox="0 0 160 160"
          className="absolute inset-0 h-full w-full overflow-visible"
          style={{
            filter: "drop-shadow(0 6px 14px rgba(46, 24, 8, 0.14))",
          }}
        >
          <defs>
            {/* Top clockwise arc at radius 55.5 (dead-center between r=44 and r=67) */}
            <path id={topArcId} d="M 24.5 80 A 55.5 55.5 0 1 1 135.5 80" fill="none" />
            {/* Bottom counter-clockwise arc at radius 55.5 so bottom text reads upright */}
            <path id={bottomArcId} d="M 24.5 80 A 55.5 55.5 0 1 0 135.5 80" fill="none" />
          </defs>

          {/* Outer Perforated Rotating Bezel (r = 73) */}
          <circle
            cx="80"
            cy="80"
            r="73"
            fill="none"
            stroke={primaryColor}
            strokeWidth="2.2"
            strokeDasharray="3 5"
            strokeLinecap="round"
            opacity="0.75"
            className="uf-spin-slow"
          />

          {/* Outer Solid Rim (r = 67) */}
          <circle
            cx="80"
            cy="80"
            r="67"
            fill="none"
            stroke={primaryColor}
            strokeWidth="2"
            opacity="0.9"
          />

          {/* Inner Vault Ring (r = 44) */}
          <circle
            cx="80"
            cy="80"
            r="44"
            fill="none"
            stroke={primaryColor}
            strokeWidth="1.6"
            opacity="0.8"
          />

          {/* Inner Micro-Stitched Ring (r = 39) */}
          <circle
            cx="80"
            cy="80"
            r="39"
            fill="none"
            stroke={primaryColor}
            strokeWidth="1"
            strokeDasharray="2 3"
            opacity="0.55"
          />

          {/* Left & Right Rosette Stars separating top and bottom arcs */}
          <circle cx="24.5" cy="80" r="2.2" fill={primaryColor} opacity="0.85" />
          <circle cx="135.5" cy="80" r="2.2" fill={primaryColor} opacity="0.85" />

          {/* Top Arc Label */}
          <text
            fontSize="9.5"
            fontWeight="900"
            letterSpacing="2.2"
            fill={primaryColor}
            dominantBaseline="central"
            style={{ fontFamily: MONO_FONT }}
          >
            <textPath href={`#${topArcId}`} startOffset="50%" textAnchor="middle">
              ★ {label.toUpperCase()} ★
            </textPath>
          </text>

          {/* Bottom Arc Seal */}
          <text
            fontSize="7.5"
            fontWeight="800"
            letterSpacing="1.8"
            fill={primaryColor}
            opacity="0.8"
            dominantBaseline="central"
            style={{ fontFamily: MONO_FONT }}
          >
            <textPath href={`#${bottomArcId}`} startOffset="50%" textAnchor="middle">
              {bottomText}
            </textPath>
          </text>
        </svg>

        {/* Center Medallion */}
        <div
          className="relative z-10 grid h-14 w-14 sm:h-16 sm:w-16 place-items-center rounded-full border-2 shadow-inner"
          style={{
            borderColor: primaryColor,
            backgroundColor: isComplete ? "rgba(236, 253, 245, 0.9)" : "rgba(255, 241, 242, 0.9)",
          }}
        >
          <svg viewBox="0 0 36 36" className="h-8 w-8 overflow-visible">
            {isComplete ? (
              <path
                d="M9 18.5L15.2 24.5L27.5 12"
                fill="none"
                stroke={primaryColor}
                strokeWidth="3.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="uf-draw-icon"
              />
            ) : (
              <>
                <path
                  d="M11 11L25 25"
                  fill="none"
                  stroke={primaryColor}
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  className="uf-draw-icon"
                />
                <path
                  d="M25 11L11 25"
                  fill="none"
                  stroke={primaryColor}
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  className="uf-draw-icon"
                />
              </>
            )}
          </svg>
        </div>
      </div>

      <span className="sr-only">{sublabel}</span>
    </div>
  );
}

function JourneyStepper({ status }: { status: RideStatus }) {
  const idx = STATUS_STEPS.findIndex((s) => s.key === status);
  const activeIdx = idx === -1 ? 0 : idx;
  const progress = STATUS_STEPS.length > 1 ? activeIdx / (STATUS_STEPS.length - 1) : 0;

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9]/95 px-2 sm:px-3 py-4 shadow-inner">
      {/* Track spans from center of first column (8.333%) to center of 6th column (8.333% from right) */}
      <div className="pointer-events-none absolute left-[8.333%] right-[8.333%] top-[29px] h-[2.5px] rounded-full bg-[#7a4416]/15">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#3a1f0a] via-[#b8722c] to-emerald-600 transition-all duration-500 ease-out"
          style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }}
        />
      </div>

      <div className="relative z-10 grid grid-cols-6 items-start w-full">
        {STATUS_STEPS.map((s, i) => {
          const done = i <= activeIdx && status !== "CANCELLED";
          const current = i === activeIdx && status !== "CANCELLED";
          return (
            <div key={s.key} className="flex flex-col items-center gap-1.5 min-w-0 px-0.5">
              <div
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 text-[10px] font-bold transition-all duration-300 ${
                  done
                    ? "border-[#ffd88a] bg-gradient-to-br from-[#3a1f0a] to-[#2e1808] text-[#ffd88a] shadow-sm"
                    : "border-[#7a4416]/30 bg-[#fffaf0] text-[#7a4416]"
                } ${current ? "ring-4 ring-[#c58a3a]/30 scale-110" : ""}`}
              >
                {done ? <CheckCircle2 className="h-3.5 w-3.5 text-[#ffd88a]" /> : i + 1}
              </div>
              <span
                className={`w-full truncate text-center text-[8.5px] sm:text-[9.5px] font-bold uppercase tracking-tight sm:tracking-wider transition-colors ${
                  current ? "text-[#2e1808] font-black" : "text-[#7a4416]/75"
                }`}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DriverCard({
  firstName,
  lastName,
  vehicleNo,
  email,
  profilePhoto,
  rating = 4.9,
  vehicleBrand,
  vehicleModel,
  vehicleColor,
  vehicleType = "Car",
  driverLocation,
  liveMetrics,
  rideStatus,
}: {
  firstName: string;
  lastName: string;
  vehicleNo: string;
  email: string;
  profilePhoto?: string | null;
  rating?: number;
  vehicleBrand?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  vehicleType?: string;
  driverLocation?: Coordinates | null;
  liveMetrics?: { etaLabel: string; etaValue: string; distanceLabel: string; distanceValue: string } | null;
  rideStatus?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const fullName = `${firstName} ${lastName}`.trim() || "Captain";
  const vehicleName =
    [vehicleBrand, vehicleModel].filter(Boolean).join(" ") || vehicleType || "UrbanFleet Comfort";
  const vehicleColorDisplay = vehicleColor ? ` • ${vehicleColor}` : "";

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#c58a3a]/45 bg-gradient-to-br from-[#fffdf9] via-[#fff4dc] to-[#f7e2b8] p-4 sm:p-4.5 shadow-md w-full">
      <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-[#b8722c]/20 blur-2xl" />
      <div className="relative flex items-center justify-between gap-3 w-full">
        {/* Left: Driver Avatar + Info */}
        <div className="flex items-center gap-3 sm:gap-3.5 min-w-0 flex-1">
          {/* Driver Portrait Image */}
          <div className="relative shrink-0">
            <div className="h-14 w-14 overflow-hidden rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] shadow-md border-2 border-[#c58a3a]/60">
              {profilePhoto && !imgFailed ? (
                <img
                  src={profilePhoto}
                  alt={fullName}
                  className="h-full w-full object-cover"
                  onError={() => setImgFailed(true)}
                />
              ) : (
                <div
                  className="grid h-full w-full place-items-center text-xl font-black text-[#ffd88a]"
                  style={{ fontFamily: DISPLAY_FONT }}
                >
                  {firstName?.[0]?.toUpperCase() || "D"}
                </div>
              )}
            </div>
            <span
              className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full border-2 border-[#fffaf0] bg-emerald-600 text-white shadow"
              title="Verified UrbanFleet Captain"
            >
              <Shield className="h-3 w-3" />
            </span>
          </div>

          {/* Driver & Car Details */}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 min-w-0">
              <p
                className="truncate text-base font-black text-[#2e1808]"
                style={{ fontFamily: DISPLAY_FONT }}
              >
                {fullName}
              </p>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[#fffaf0] px-1.5 py-0.5 text-[10px] font-black text-[#3a1f0a] border border-[#7a4416]/20 shadow-2xs">
                <Star className="h-2.5 w-2.5 fill-amber-500 text-amber-500" />
                {Number(rating || 4.9).toFixed(1)}
              </span>
            </div>

            {/* Vehicle make, model and color */}
            <p className="truncate text-xs font-semibold text-[#6b3a12] flex items-center gap-1.5">
              <Car className="h-3.5 w-3.5 text-[#b8722c] shrink-0" />
              <span className="truncate">
                {vehicleName}
                {vehicleColorDisplay}
              </span>
            </p>

            {/* Indian High-Security Plate Badge */}
            <div className="pt-0.5">
              <span
                className="inline-flex items-center gap-1.5 rounded-md border border-[#3a1f0a] bg-[#ffd88a] px-2 py-0.5 text-[11px] font-black tracking-wider text-[#2e1808] shadow-2xs"
                style={{ fontFamily: MONO_FONT }}
              >
                <span className="text-[8px] font-black text-[#7a4416] tracking-normal">IND</span>
                <span>{vehicleNo || "MH02UF2026"}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Right: Quick Action Contact Buttons */}
        {email && (
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={`mailto:${email}`}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffd88a] shadow-md hover:opacity-95 active:scale-95 transition-all"
              aria-label="Email driver"
              title="Contact driver via email"
            >
              <Mail className="h-4 w-4" />
            </a>
          </div>
        )}
      </div>

      {/* Live GPS Telemetry Status Strip */}
      {rideStatus &&
        ["DRIVER_ASSIGNED", "DRIVER_ARRIVING", "RIDE_STARTED", "ARRIVED_AT_DESTINATION"].includes(
          rideStatus
        ) && (
          <div className="mt-3 pt-3 border-t border-[#c58a3a]/30 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="relative flex h-3 w-3 shrink-0">
                {driverLocation ? (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-sky-500 shadow-sm"></span>
                  </>
                ) : (
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500 animate-pulse"></span>
                )}
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-wider text-[#7a4416]">
                  {driverLocation ? "Live Captain GPS Active" : "GPS Telemetry Tracking"}
                </p>
                <p className="text-xs font-bold text-[#2e1808] truncate">
                  {driverLocation
                    ? liveMetrics
                      ? `${liveMetrics.distanceValue} away • ${liveMetrics.etaValue}`
                      : "Live coordinates transmitting"
                    : "Connecting to vehicle telemetry…"}
                </p>
              </div>
            </div>

            {driverLocation && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/50 bg-[#0f172a] px-2.5 py-1 text-[10px] font-black text-sky-300 shadow-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-ping" />
                LIVE GPS
              </span>
            )}
          </div>
        )}
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="w-full relative overflow-hidden rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9] p-3 sm:p-3.5 text-center shadow-xs">
      <div className="mx-auto grid h-8 w-8 place-items-center rounded-xl bg-[#3a1f0a] text-[#ffd88a] shadow-2xs">
        {icon}
      </div>
      <p
        className="mt-2 truncate text-xs sm:text-sm font-black text-[#2e1808]"
        style={{ fontFamily: MONO_FONT }}
      >
        {value}
      </p>
      <p className="text-[9.5px] sm:text-[10px] font-bold uppercase tracking-[0.16em] text-[#7a4416] mt-0.5">
        {label}
      </p>
    </div>
  );
}

export default function RideDetails() {
  const { rideId } = useParams<{ rideId: string }>();
  const navigate = useNavigate();

  const [ride, setRide] = useState<Ride | null>(null);
  const [driverLocation, setDriverLocation] = useState<Coordinates | null>(null);
  const [routePolyline, setRoutePolyline] = useState<[number, number][]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [copiedOtp, setCopiedOtp] = useState(false);

  const [ratingScore, setRatingScore] = useState<number>(5);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [ratingFeedback, setRatingFeedback] = useState<string>("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [ratingError, setRatingError] = useState("");

  const handleRateRide = async () => {
    if (!ride) return;
    setIsSubmittingRating(true);
    setRatingError("");
    try {
      const combinedFeedback =
        [selectedTags.join(", "), ratingFeedback.trim()].filter(Boolean).join(" - ") || undefined;
      await appApi.post(`/rides/${ride.id}/rate`, {
        score: ratingScore,
        feedback: combinedFeedback,
      });
      setRatingSubmitted(true);
      setToast("Thank you for your rating!");
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data
        ?.message;
      setRatingError(message || "Failed to submit rating. You may have already rated this trip.");
    } finally {
      setIsSubmittingRating(false);
    }
  };

  const socketRef = useRef<WebSocket | null>(null);
  const { user } = useAuthContext();

  useEffect(() => {
    if (user?.roles?.includes("DRIVER") && !user?.roles?.includes("RIDER")) {
      navigate("/driver-dashboard", { replace: true });
    }
  }, [user, navigate]);

  const fetchRideDetails = async (id?: string) => {
    try {
      const endpoint = id ? `/rides/${id}` : "/rides/current";
      const response = await appApi.get<{ success: boolean; data: Ride }>(endpoint);
      const currentRide = response.data.data;
      if (currentRide) {
        setRide(currentRide);
        const extendedRide = currentRide as Ride & {
          driverLocation?: Coordinates;
          driver?: {
            currentLocation?: Coordinates;
            coordinates?: Coordinates;
          };
        };
        const loc =
          extendedRide.driverLocation ||
          extendedRide.driver?.currentLocation ||
          extendedRide.driver?.coordinates;
        if (loc?.latitude != null && loc?.longitude != null) {
          setDriverLocation({ latitude: loc.latitude, longitude: loc.longitude });
        }
        return currentRide;
      }
    } catch {
      /* ignore */
    }
    return null;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const currentRide = await fetchRideDetails(rideId);
        if (cancelled || !currentRide) {
          if (!cancelled && !currentRide) setError("Unable to load ride details.");
          return;
        }

        // 1. If current user is the driver of this ride, redirect immediately to driver dashboard
        const currentUserId = user?.id;
        const isDriverOfRide = Boolean(
          currentUserId &&
            (currentRide.driverId === currentUserId ||
              currentRide.driver?.id === currentUserId ||
              (currentRide.driver?.user as { id?: string } | undefined)?.id === currentUserId ||
              (currentRide.driver as { userId?: string } | undefined)?.userId === currentUserId)
        );
        if (isDriverOfRide) {
          navigate("/driver-dashboard", { replace: true });
          return;
        }

        // 2. If current user is not the passenger/rider of this ride, block access
        const isRiderOfRide = Boolean(currentUserId && currentRide.riderId === currentUserId);
        if (!isRiderOfRide) {
          setError("You are not authorized to view this trip.");
          navigate("/dashboard", { replace: true });
          return;
        }

        if (currentRide?.pickup && currentRide?.destination) {
          const pLat = currentRide.pickup.coordinates.latitude;
          const pLon = currentRide.pickup.coordinates.longitude;
          const dLat = currentRide.destination.coordinates.latitude;
          const dLon = currentRide.destination.coordinates.longitude;
          const apiKey = import.meta.env.VITE_GEOAPIFY_API_KEY || "";
          const url = `https://api.geoapify.com/v1/routing?waypoints=${pLat},${pLon}|${dLat},${dLon}&mode=drive&apiKey=${apiKey}`;
          const routeRes = await fetch(url);
          const routeData = await routeRes.json();
          if (!cancelled && routeData?.features?.[0]?.geometry?.coordinates) {
            const coords = routeData.features[0].geometry.coordinates;
            const flatCoords: [number, number][] = [];
            coords.forEach((line: [number, number][]) => {
              line.forEach(([lon, lat]) => flatCoords.push([lat, lon]));
            });
            setRoutePolyline(flatCoords);
          }
        }
      } catch {
        if (!cancelled) setError("Unable to load ride details.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rideId, navigate, user?.id]);

  // Trap browser Back navigation while trip is actively underway
  useEffect(() => {
    if (
      ride &&
      [
        "SEARCHING",
        "DRIVER_ASSIGNED",
        "DRIVER_ARRIVING",
        "RIDE_STARTED",
        "ARRIVED_AT_DESTINATION",
      ].includes(ride.status)
    ) {
      window.history.pushState(null, "", window.location.href);
      const handlePopState = () => {
        window.history.pushState(null, "", window.location.href);
      };
      window.addEventListener("popstate", handlePopState);
      return () => {
        window.removeEventListener("popstate", handlePopState);
      };
    }
  }, [ride]);

  useEffect(() => {
    const s = connectRiderSocket({
      onReady: () => setToast("Connected to live telemetry"),
      onError: (m: string) => setToast(m),
      onRideCreated: (payload) => {
        if (payload?.ride?.id !== rideId) return;
        setRide({ ...payload.ride, otp: payload.otp });
      },
      onRideAccepted: (payload) => {
        if (payload?.ride?.id !== rideId) return;
        setRide((current) => mergeRideLifecycle(current, payload));
        setToast("Captain has accepted your ride");
      },
      onDriverLocation: (payload: DriverLocationPayload) => {
        if (payload?.latitude != null && payload?.longitude != null) {
          setDriverLocation({ latitude: payload.latitude, longitude: payload.longitude });
        }
      },
      onDriverArriving: (payload) => {
        if (payload?.ride?.id !== rideId) return;
        setRide((current) => mergeRideLifecycle(current, payload));
        setToast("Captain is arriving at pickup");
      },
      onRideStarted: (payload) => {
        if (payload?.ride?.id !== rideId) return;
        setRide((current) => mergeRideLifecycle(current, payload));
        setToast("Ride started");
      },
      onPaymentCaptured: (payload) => {
        if (payload.ride?.id === rideId) {
          setRide((p) => (p ? { ...p, ...payload.ride } : p));
          setToast("Payment confirmed. Your captain can now complete the ride.");
        }
      },
      onRideArrivedAtDestination: (payload) => {
        if (payload?.ride?.id !== rideId) return;
        setRide((current) => mergeRideLifecycle(current, payload));
        setToast("Arrived at destination");
      },
      onRideCompleted: (payload) => {
        if (payload?.ride?.id !== rideId) return;
        setRide((current) => mergeRideLifecycle(current, payload));
        setToast("Ride completed");
      },
      onRideCancelled: (payload: RideCancelledPayload) => {
        if (payload.rideId !== rideId) return;
        setRide((p) =>
          p
            ? {
                ...p,
                status: "CANCELLED",
                cancelledBy: payload.cancelledBy,
                cancellationReason: payload.reason ?? null,
                otp: null,
              }
            : p
        );
        setToast(`Ride cancelled by ${payload.cancelledBy.toLowerCase()}`);
      },
      onNoDriversAvailable: (payload) => {
        if (payload.rideId === rideId) setToast("Scanning for available captains nearby…");
      },
    });

    socketRef.current = s;
    return () => {
      s?.close();
      socketRef.current = null;
    };
  }, [rideId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleCancel() {
    if (!ride) return;
    setIsCancelling(true);
    try {
      try {
        await appApi.post(`/rides/${ride.id}/cancel`, {
          cancellationReason: "Rider cancelled from ride details",
        });
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 404 || status === 405) {
          await appApi.patch(`/rides/${ride.id}/cancel`, {
            cancellationReason: "Rider cancelled from ride details",
          });
        } else {
          throw err;
        }
      }
      setRide((p) => (p ? { ...p, status: "CANCELLED" } : p));
      setShowCancelConfirm(false);
    } catch {
      setError("Unable to cancel ride. Please try again.");
    } finally {
      setIsCancelling(false);
    }
  }

  async function handlePayNow() {
    if (!ride || !user?.id) {
      setError("Unable to start payment from this ride right now.");
      return;
    }
    if (ride.status !== "ARRIVED_AT_DESTINATION") {
      setError("Payment is only available after your driver arrives at the destination.");
      return;
    }
    if (ride.paymentStatus && !payableStatuses.includes(ride.paymentStatus)) {
      setError("This ride payment has already been processed.");
      return;
    }

    let currentRide = ride;
    try {
      const response = await appApi.get<{ success: boolean; data: Ride }>(
        `/rides/${currentRide.id}/fare-preview`
      );
      currentRide = response.data.data;
      setRide(currentRide);
    } catch (err: unknown) {
      // Resilient fallback: try fetching ride directly via /rides/:id
      try {
        const fallbackRes = await appApi.get<{ success: boolean; data: Ride }>(
          `/rides/${currentRide.id}`
        );
        currentRide = fallbackRes.data.data;
        setRide(currentRide);
      } catch {
        // If currentRide in state already contains a fare breakdown, continue without aborting
        if (!currentRide.fare?.breakdown) {
          const axiosErr = err as { response?: { data?: { message?: string } } };
          const serverMsg = axiosErr?.response?.data?.message;
          setError(serverMsg || "Unable to calculate the final fare. Please try again.");
          return;
        }
      }
    }

    if (!currentRide.fare.breakdown) {
      setError("Ride fare breakdown is not available for payment.");
      return;
    }

    const driverId = currentRide.driver?.id ?? currentRide.driverId ?? "";
    if (!driverId) {
      setError("Driver information is unavailable.");
      return;
    }

    setIsPaying(true);
    setError("");
    setToast("");

    try {
      const paymentOrder = await createPaymentOrder({
        rideId: currentRide.id,
      });

      const Razorpay = await loadRazorpayCheckout();
      const options = {
        key: paymentOrder.razorpayKeyId,
        amount: paymentOrder.amountPaise,
        currency: paymentOrder.currency,
        order_id: paymentOrder.gatewayOrderId,
        name: "UrbanFleet Payment",
        description: "Complete your ride payment",
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) => {
          try {
            const verifyResult = await verifyPaymentSignature(response);
            setRide((current) =>
              current ? { ...current, paymentStatus: verifyResult.status as PaymentStatus } : current
            );
            setToast("Payment verified successfully.");
          } catch {
            setError("Payment succeeded, but verification failed. Please contact support.");
          }
        },
        prefill: {
          name: `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim(),
          email: user?.email,
        },
        theme: { color: "#3a1f0a" },
        modal: {
          ondismiss: () =>
            setToast("Payment window closed. You can retry this ride payment anytime."),
        },
      };

      const razorpayInstance = new Razorpay(options);
      razorpayInstance.open();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      const serverMsg = axiosErr?.response?.data?.message;
      setError(serverMsg || "Unable to launch payment checkout. Please try again later.");
    } finally {
      setIsPaying(false);
    }
  }

  const mapPath = useMemo(
    () =>
      routePolyline.length > 0
        ? routePolyline.map(([lat, lng]) => ({ lat, lng }))
        : ride
          ? [
              { lat: ride.pickup.coordinates.latitude, lng: ride.pickup.coordinates.longitude },
              {
                lat: ride.destination.coordinates.latitude,
                lng: ride.destination.coordinates.longitude,
              },
            ]
          : [],
    [routePolyline, ride]
  );

  if (isLoading) {
    return <LoadingScreen label="Loading ride" sublabel="Fetching your trip details" />;
  }

  if (!ride || error) {
    return (
      <main
        className="relative flex min-h-screen w-full items-center justify-center overflow-hidden px-6 py-10 bg-[#f5e6c8] text-[#2e1808]"
        style={{ fontFamily: BODY_FONT }}
      >
        <CityMapBackground />
        <section className="relative z-10 w-full max-w-md overflow-hidden rounded-[2.5rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-8 text-center shadow-2xl backdrop-blur-2xl">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffd88a]">
            <Car className="h-6 w-6" />
          </div>
          <p
            className="text-xl font-bold tracking-tight text-[#2e1808]"
            style={{ fontFamily: DISPLAY_FONT }}
          >
            {error || "No active ride found"}
          </p>
          <p className="mt-2 text-sm font-medium text-[#6b3a12]">
            Head back to your dashboard to book a new ride.
          </p>
          <TicketButton
            variant="primary"
            className="mt-6 w-full"
            onClick={() => navigate("/dashboard")}
          >
            Back to dashboard
          </TicketButton>
        </section>
      </main>
    );
  }

  const statusMeta = STATUS_META[ride.status];
  const stepIndex = STATUS_STEPS.findIndex((s) => s.key === ride.status);
  const progressFraction =
    STATUS_STEPS.length > 1 ? Math.max(0, stepIndex) / (STATUS_STEPS.length - 1) : 0;
  const isTerminal = ride.status === "COMPLETED" || ride.status === "CANCELLED";
  const paymentPending =
    ride.paymentStatus === undefined ||
    ride.paymentStatus === "CREATED" ||
    ride.paymentStatus === "PENDING" ||
    ride.paymentStatus === "AUTHORIZED";

  const driverFirstName = ride.driver?.firstName || (ride.driver ? "Captain" : "Not Assigned");
  const driverLastName = ride.driver?.lastName || "";
  const vehicleNo =
    ride.driver?.vehicleNumber ||
    ride.driver?.vehicle?.plateNumber ||
    ride.driver?.vehicle?.registrationNumber ||
    "Not Assigned";
  const driverEmail = ride.driver?.user?.email || ride.driver?.email || "";
  const driverPhoto =
    ride.driver?.profilePhoto ||
    ride.driver?.profilePhotoUrl ||
    (ride.driver?.user as { avatarUrl?: string } | undefined)?.avatarUrl ||
    null;
  const driverRating = ride.driver?.rating || 4.9;
  const vehicleBrand = ride.driver?.vehicle?.brand || ride.driver?.vehicle?.make || "";
  const vehicleModel = ride.driver?.vehicle?.model || "";
  const vehicleColor = ride.driver?.vehicle?.color || "";
  const vehicleType = ride.driver?.vehicle?.type || ride.vehicleCategory || "Car";

  const activeFareValue = ride.fare?.final ?? ride.fare?.estimated ?? 0;

  const liveRiderMetrics = (() => {
    const distObj = typeof ride.distance === "object" && ride.distance !== null ? ride.distance : null;
    const durObj = typeof ride.duration === "object" && ride.duration !== null ? ride.duration : null;
    const estTripDist = distObj?.actual ?? distObj?.estimated ?? (typeof ride.distance === "number" ? ride.distance : 0);
    const estTripDur = durObj?.actual ?? durObj?.estimated ?? (typeof ride.duration === "number" ? ride.duration : 0);

    if (ride.status === "DRIVER_ASSIGNED" || ride.status === "DRIVER_ARRIVING") {
      if (driverLocation && ride.pickup?.coordinates) {
        const straightKm = calculateHaversineDistanceKm(driverLocation, ride.pickup.coordinates);
        const roadDistKm = straightKm * 1.3;
        const etaMin = Math.max(1, Math.round(roadDistKm * 2.4));
        return {
          etaLabel: "Captain ETA",
          etaValue: formatDuration(etaMin),
          distanceLabel: "Distance Away",
          distanceValue: formatDistance(roadDistKm),
        };
      }
      return {
        etaLabel: "Captain ETA",
        etaValue: "Locating…",
        distanceLabel: "Distance Away",
        distanceValue: "Locating…",
      };
    }

    if (ride.status === "RIDE_STARTED") {
      if (driverLocation && ride.destination?.coordinates) {
        const straightKm = calculateHaversineDistanceKm(driverLocation, ride.destination.coordinates);
        const roadDistKm = straightKm * 1.3;
        const etaMin = Math.max(1, Math.round(roadDistKm * 2.2));
        return {
          etaLabel: "Trip ETA",
          etaValue: formatDuration(etaMin),
          distanceLabel: "Remaining Dist",
          distanceValue: formatDistance(roadDistKm),
        };
      }
      return {
        etaLabel: "Trip ETA",
        etaValue: formatDuration(estTripDur),
        distanceLabel: "Estimated Dist",
        distanceValue: formatDistance(estTripDist),
      };
    }

    if (ride.status === "ARRIVED_AT_DESTINATION") {
      return {
        etaLabel: "Status",
        etaValue: "Arrived",
        distanceLabel: "Trip Distance",
        distanceValue: formatDistance(estTripDist),
      };
    }

    if (ride.status === "COMPLETED") {
      return {
        etaLabel: "Trip Duration",
        etaValue: formatDuration(estTripDur),
        distanceLabel: "Total Distance",
        distanceValue: formatDistance(estTripDist),
      };
    }

    // SEARCHING / CANCELLED / default
    return {
      etaLabel: "Est. Time",
      etaValue: formatDuration(estTripDur),
      distanceLabel: "Est. Distance",
      distanceValue: formatDistance(estTripDist),
    };
  })();

  const canCancel =
    ride.status === "SEARCHING" ||
    ride.status === "DRIVER_ASSIGNED" ||
    ride.status === "DRIVER_ARRIVING";

  return (
    <main
      className="relative min-h-screen w-full overflow-x-hidden bg-[#f5e6c8] text-[#2e1808]"
      style={{ fontFamily: BODY_FONT }}
    >
      <style>{ANIMATION_STYLES}</style>
      <CityMapBackground />

      {/* Toast Notification */}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-5 z-50 flex justify-center px-4">
          <div className="flex items-center gap-2.5 rounded-full border border-[#c58a3a]/40 bg-[#2e1808]/95 px-5 py-2.5 text-xs font-bold text-[#ffe9be] shadow-2xl backdrop-blur-xl">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
            {toast}
          </div>
        </div>
      )}

      <div className="relative z-10 mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-10 py-4 sm:py-5 space-y-5 sm:space-y-6">
        {/* Header Bar */}
        <header className="sticky top-3 z-40 w-full">
          <div className="w-full rounded-[1.75rem] border border-[#fff4dc]/80 bg-gradient-to-r from-[#fffdf9]/95 via-[#fff5e0]/90 to-[#f7e2b8]/90 backdrop-blur-2xl shadow-xl px-3.5 sm:px-6 py-3 flex items-center justify-between gap-2">
            <button
              onClick={() => navigate("/dashboard")}
              className="flex items-center gap-2 h-11 px-3.5 sm:px-4 rounded-2xl border border-[#7a4416]/25 bg-[#fffaf0] text-xs font-bold text-[#3a1f0a] shadow-xs transition hover:bg-[#fff4dc] active:scale-95"
              aria-label="Back to Dashboard"
            >
              <ArrowLeft className="h-4 w-4 text-[#b8722c]" />
              <span className="hidden sm:inline">Dashboard</span>
            </button>

            <div
              className="flex items-center gap-2 sm:gap-2.5 rounded-full border border-[#c58a3a]/40 bg-[#fffdf9] px-4 sm:px-5 py-2 text-[11px] sm:text-xs font-bold uppercase tracking-[0.18em] sm:tracking-[0.2em] text-[#3a1f0a] shadow-sm"
              style={{ fontFamily: MONO_FONT }}
            >
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Ride #{ride.id.slice(-6)}
            </div>

            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] to-[#6b3a12] text-[#ffd88a] shadow-md">
              <Navigation2 className="h-4 w-4" />
            </div>
          </div>
        </header>

        {/* RESPONSIVE FULL-WIDTH GRID */}
        <div className="grid gap-5 sm:gap-6 lg:grid-cols-12 lg:items-start w-full">
          {/* LEFT COLUMN: Map Hero Panel (Span 7 on Laptop) */}
          <section className="lg:col-span-7 flex flex-col w-full">
            <div className="relative h-[320px] sm:h-[460px] lg:h-[680px] w-full overflow-hidden rounded-[2rem] sm:rounded-[2.5rem] border border-[#fff4dc]/80 shadow-2xl bg-[#fffaf0]">
              <MapView
                center={
                  driverLocation
                    ? {
                        lat: driverLocation.latitude,
                        lng: driverLocation.longitude,
                      }
                    : {
                        lat: ride.pickup.coordinates.latitude,
                        lng: ride.pickup.coordinates.longitude,
                      }
                }
                markers={[
                  {
                    position: {
                      lat: ride.pickup.coordinates.latitude,
                      lng: ride.pickup.coordinates.longitude,
                    },
                    label: "P",
                    type: "pickup",
                    title: ride.pickup.address || "Pickup Location",
                  },
                  {
                    position: {
                      lat: ride.destination.coordinates.latitude,
                      lng: ride.destination.coordinates.longitude,
                    },
                    label: "D",
                    type: "destination",
                    title: ride.destination.address || "Destination Location",
                  },
                  ...(driverLocation
                    ? [
                        {
                          position: {
                            lat: driverLocation.latitude,
                            lng: driverLocation.longitude,
                          },
                          label: "🚗",
                          type: "driver" as const,
                          title: `Captain ${driverFirstName}`,
                          popupHtml: `
                            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-width: 175px; padding: 4px;">
                              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                                <span style="font-weight: 800; font-size: 13px; color: #0f172a;">Captain ${driverFirstName}</span>
                                <span style="font-size: 10px; font-weight: 700; color: #0284c7; background: #e0f2fe; padding: 2px 6px; border-radius: 999px;">★ ${driverRating}</span>
                              </div>
                              <div style="font-size: 11px; color: #475569; margin-bottom: 6px;">
                                ${vehicleColor ? `${vehicleColor} ` : ""}${vehicleBrand} ${vehicleModel} • <b>${vehicleNo || "UrbanFleet"}</b>
                              </div>
                              <div style="display: flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 700; color: #0369a1; background: #f0f9ff; border: 1px solid #bae6fd; padding: 4px 8px; border-radius: 8px;">
                                <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #0284c7; box-shadow: 0 0 6px #0284c7;"></span>
                                Live GPS Telemetry Connected
                              </div>
                            </div>
                          `,
                        },
                      ]
                    : []),
                ]}
                path={mapPath}
              />

              {/* Floating Map Legend Overlay */}
              <div className="pointer-events-none absolute bottom-3.5 left-3.5 right-3.5 sm:bottom-4 sm:left-4 sm:right-4 flex flex-wrap items-center justify-between gap-2 z-20">
                <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 rounded-xl border border-[#fff4dc]/60 bg-[#2e1808]/85 px-3.5 py-2 text-[10.5px] sm:text-[11px] font-semibold text-[#ffe9be] shadow-lg backdrop-blur-md">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-sm" /> P: Pickup
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-500 shadow-sm" /> D: Drop-off
                  </span>
                  {driverLocation ? (
                    <span className="flex items-center gap-1.5 text-sky-300">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-400"></span>
                      </span>
                      Live Captain GPS Active
                    </span>
                  ) : (
                    ride.driver && (
                      <span className="flex items-center gap-1.5 text-amber-300">
                        <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" /> Connecting GPS…
                      </span>
                    )
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* RIGHT COLUMN: Ticket Body & Controls (Span 5 on Laptop) */}
          <section className="lg:col-span-5 relative space-y-5 overflow-hidden rounded-[2rem] sm:rounded-[2.5rem] border border-[#fff4dc]/80 bg-gradient-to-b from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-5 sm:p-8 shadow-2xl backdrop-blur-2xl w-full">
            <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

            {/* Headline */}
            <div className="relative flex items-start justify-between gap-3 w-full">
              <div className="min-w-0 flex-1">
                <p
                  className="text-[10.5px] sm:text-[11px] font-black uppercase tracking-[0.22em]"
                  style={{ color: statusMeta.accent }}
                >
                  {ride.status.replace(/_/g, " ")}
                </p>
                <h1
                  className="mt-1 truncate text-xl sm:text-3xl font-black tracking-tight text-[#2e1808]"
                  style={{ fontFamily: DISPLAY_FONT }}
                >
                  {statusMeta.title}
                </h1>
                <p className="mt-1 text-xs sm:text-sm font-medium text-[#6b3a12]">
                  {statusMeta.subtitle}
                </p>
              </div>
              {isTerminal ? (
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-900 border border-emerald-500/30 shadow-inner">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
              ) : (
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffd88a] shadow-md border border-[#c58a3a]/40">
                  {ride.status === "SEARCHING" ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Sparkles className="h-5 w-5" />
                  )}
                </div>
              )}
            </div>

            {/* Journey Stepper */}
            {ride.status !== "CANCELLED" && <JourneyStepper status={ride.status} />}

            {/* Terminal Stamp */}
            {ride.status === "COMPLETED" && (
              <div className="flex justify-center py-2">
                <TicketStamp
                  label="TRIP COMPLETE"
                  sublabel="Trip completed successfully"
                  tone="complete"
                />
              </div>
            )}
            {ride.status === "CANCELLED" && (
              <div className="flex justify-center py-2">
                <TicketStamp label="RIDE VOID" sublabel="This ride was cancelled" tone="void" />
              </div>
            )}

            {/* Driver Card */}
            {ride.driver && (
              <DriverCard
                firstName={driverFirstName}
                lastName={driverLastName}
                vehicleNo={vehicleNo}
                email={driverEmail}
                profilePhoto={driverPhoto}
                rating={driverRating}
                vehicleBrand={vehicleBrand}
                vehicleModel={vehicleModel}
                vehicleColor={vehicleColor}
                vehicleType={vehicleType}
                driverLocation={driverLocation}
                liveMetrics={liveRiderMetrics}
                rideStatus={ride.status}
              />
            )}

            {/* Copyable OTP Security Vault - strictly for the verified rider */}
            {ride.otp &&
              user?.id === ride.riderId &&
              ["SEARCHING", "DRIVER_ASSIGNED", "DRIVER_ARRIVING"].includes(ride.status) && (
                <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 rounded-2xl border-2 border-[#c58a3a]/50 bg-[#fffdf9] p-4 shadow-sm">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#3a1f0a] text-[#ffd88a] shadow-sm">
                      <Shield className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-black uppercase tracking-wider text-[#3a1f0a]">
                        Boarding Verification PIN
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#6b3a12]">
                        Share this 4-digit PIN with your captain at pickup.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-end sm:justify-start gap-2 shrink-0 self-end sm:self-auto">
                    <span
                      aria-label="Ride verification code"
                      className="rounded-xl bg-[#3a1f0a] px-3.5 py-2 text-lg sm:text-xl font-black tracking-[0.28em] text-[#ffd88a] shadow-inner"
                      style={{ fontFamily: MONO_FONT }}
                    >
                      {ride.otp}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (ride.otp) {
                          navigator.clipboard.writeText(ride.otp);
                          setCopiedOtp(true);
                          setTimeout(() => setCopiedOtp(false), 2000);
                        }
                      }}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#7a4416]/25 bg-[#fffaf0] text-[#3a1f0a] hover:bg-[#fff4dc] active:scale-95 transition-all"
                      title="Copy OTP"
                    >
                      {copiedOtp ? (
                        <Check className="h-4 w-4 text-emerald-700" />
                      ) : (
                        <Copy className="h-4 w-4 text-[#b8722c]" />
                      )}
                    </button>
                  </div>
                </section>
              )}

            {/* Trip Stops with Pixel-Accurate Connector */}
            <div className="relative overflow-hidden rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9] p-4 shadow-xs w-full">
              <div className="relative flex flex-col gap-5 w-full">
                {/* Vertical connector anchored to the exact 14px center of the 28px (w-7) stop badges */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute left-[14px] top-[20px] bottom-[20px] w-[2px] -translate-x-1/2"
                >
                  <svg className="h-full w-full overflow-visible">
                    <line
                      x1="1"
                      y1="0"
                      x2="1"
                      y2="100%"
                      stroke="#b8722c"
                      strokeWidth="2"
                      strokeDasharray="4 4"
                      opacity="0.65"
                    />
                  </svg>
                  {!isTerminal && (
                    <div
                      className="uf-car-marker absolute left-1/2 grid h-6 w-6 place-items-center rounded-full bg-[#3a1f0a] text-[#ffd88a] shadow-md ring-2 ring-[#fffaf0] transition-all duration-500"
                      style={{ top: `${Math.max(15, Math.min(85, progressFraction * 100))}%` }}
                    >
                      <Car className="h-3 w-3" />
                    </div>
                  )}
                </div>

                <Stop color="saddle" label="Pickup Location" value={ride.pickup.address} />
                <Stop
                  color="brass"
                  square
                  label="Destination Drop-Off"
                  value={ride.destination.address}
                />
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-2.5 sm:gap-3 w-full">
              <StatTile
                icon={<IndianRupee className="h-4 w-4" />}
                label="Fare"
                value={formatFare(activeFareValue)}
              />
              <StatTile
                icon={<Clock className="h-4 w-4" />}
                label={liveRiderMetrics.etaLabel}
                value={liveRiderMetrics.etaValue}
              />
              <StatTile
                icon={<RouteIcon className="h-4 w-4" />}
                label={liveRiderMetrics.distanceLabel}
                value={liveRiderMetrics.distanceValue}
              />
            </div>

            {/* Fare Breakdown */}
            {ride.status === "COMPLETED" && ride.fare.breakdown && (
              <div className="overflow-hidden rounded-2xl border border-dashed border-[#7a4416]/35 bg-[#fffdf9]/90 p-4 shadow-xs w-full">
                <p
                  className="mb-3 text-sm font-black text-[#2e1808]"
                  style={{ fontFamily: DISPLAY_FONT }}
                >
                  Audited Fare Receipt
                </p>
                <div className="space-y-2 text-xs font-semibold text-[#6b3a12] w-full">
                  {[
                    ["Base Fare", ride.fare.breakdown.baseFarePaise],
                    ["Distance Fare", ride.fare.breakdown.distanceFarePaise],
                    ["Time Fare", ride.fare.breakdown.timeFarePaise],
                    ...(ride.fare.breakdown.surgePaise
                      ? [["Surge Charge", ride.fare.breakdown.surgePaise]]
                      : []),
                  ].map(([label, amount]) =>
                    amount != null ? (
                      <Row
                        key={label as string}
                        label={label as string}
                        value={formatFare(amount as number)}
                      />
                    ) : null
                  )}
                </div>
              </div>
            )}

            {/* Payment Note */}
            {ride.status === "ARRIVED_AT_DESTINATION" && (
              <div className="flex items-start gap-3 rounded-2xl border border-amber-500/35 bg-amber-500/15 p-4 text-xs font-semibold text-amber-950 shadow-xs w-full">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <div>
                  <p className="font-bold">Payment settlement required to close trip.</p>
                  <p className="mt-0.5 text-amber-900/85">
                    {paymentPending
                      ? "Click Pay Now below to complete your secure Razorpay checkout."
                      : "Payment captured! Your captain can now mark the trip complete."}
                  </p>
                </div>
              </div>
            )}

            {/* Ride Rating Section */}
            {ride.status === "COMPLETED" && (
              <section className="rounded-2xl border border-[#c58a3a]/40 bg-gradient-to-b from-[#fffdf9] via-[#fff4dc] to-[#f7e2b8] p-4 sm:p-5 shadow-md">
                <div className="flex items-center gap-2 mb-3">
                  <Star className="h-5 w-5 fill-amber-500 text-amber-500" />
                  <h3
                    className="text-base font-black text-[#2e1808]"
                    style={{ fontFamily: DISPLAY_FONT }}
                  >
                    {ratingSubmitted || (ride.ratings && ride.ratings.length > 0)
                      ? "Trip Experience Rated"
                      : "Rate Your Journey & Captain"}
                  </h3>
                </div>

                {ratingSubmitted || (ride.ratings && ride.ratings.length > 0) ? (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/10 p-4 text-center">
                    <div className="flex justify-center gap-1 mb-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className={`h-5 w-5 ${
                            star <= (ride.ratings?.[0]?.score || ratingScore)
                              ? "fill-amber-500 text-amber-500"
                              : "text-neutral-300"
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-xs font-bold text-emerald-950">
                      Thank you! Your feedback helps us maintain fleet excellence.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-xs font-medium text-[#6b3a12]">
                      How was your journey with {driverFirstName}?
                    </p>

                    {/* Star Rating Selector */}
                    <div className="flex justify-center items-center gap-1.5 sm:gap-2 py-1">
                      {[1, 2, 3, 4, 5].map((star) => {
                        const filled = (hoverRating ?? ratingScore) >= star;
                        return (
                          <button
                            key={star}
                            type="button"
                            onClick={() => setRatingScore(star)}
                            onMouseEnter={() => setHoverRating(star)}
                            onMouseLeave={() => setHoverRating(null)}
                            className="p-1 transition-transform hover:scale-125 active:scale-95 focus:outline-none"
                            aria-label={`Rate ${star} stars`}
                          >
                            <Star
                              className={`h-7 w-7 transition-colors ${
                                filled
                                  ? "fill-amber-500 text-amber-500 drop-shadow-xs"
                                  : "text-[#7a4416]/30 hover:text-[#b8722c]/50"
                              }`}
                            />
                          </button>
                        );
                      })}
                      <span
                        className="ml-2 text-sm font-black text-[#3a1f0a]"
                        style={{ fontFamily: MONO_FONT }}
                      >
                        {hoverRating ?? ratingScore}.0
                      </span>
                    </div>

                    {/* Quick Tags */}
                    <div className="flex flex-wrap gap-1.5 justify-center">
                      {[
                        "Polite Captain",
                        "Spotless Cabin",
                        "Smooth Drive",
                        "Optimal Route",
                        "Safe Driving",
                      ].map((tag) => {
                        const isSelected = selectedTags.includes(tag);
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() =>
                              setSelectedTags((prev) =>
                                isSelected ? prev.filter((t) => t !== tag) : [...prev, tag]
                              )
                            }
                            className={`rounded-full px-3 py-1 text-[11px] font-bold transition-all ${
                              isSelected
                                ? "bg-gradient-to-r from-[#3a1f0a] to-[#6b3a12] text-[#ffd88a] shadow-2xs"
                                : "border border-[#7a4416]/25 bg-[#fffaf0] text-[#6b3a12] hover:bg-[#fff4dc]"
                            }`}
                          >
                            {tag}
                          </button>
                        );
                      })}
                    </div>

                    {/* Feedback textarea */}
                    <textarea
                      placeholder="Add an optional compliment or note..."
                      value={ratingFeedback}
                      onChange={(e) => setRatingFeedback(e.target.value)}
                      maxLength={500}
                      rows={2}
                      className="w-full resize-none rounded-xl border border-[#7a4416]/25 bg-[#fffdf9] p-3 text-xs text-[#2e1808] placeholder:text-[#7a4416]/45 focus:border-[#b8722c] focus:outline-none focus:ring-2 focus:ring-[#b8722c]/20"
                    />

                    {ratingError && (
                      <p className="text-xs text-rose-700 font-semibold">{ratingError}</p>
                    )}

                    <TicketButton
                      variant="primary"
                      className="w-full h-11 text-xs font-bold uppercase tracking-wider"
                      onClick={handleRateRide}
                      disabled={isSubmittingRating}
                    >
                      {isSubmittingRating && <Loader2 className="h-4 w-4 animate-spin" />}
                      {isSubmittingRating ? "Submitting Rating…" : "Submit Trip Rating"}
                    </TicketButton>
                  </div>
                )}
              </section>
            )}

            {/* Actions */}
            <div className="flex flex-col gap-3 pt-1 w-full">
              {ride.status === "ARRIVED_AT_DESTINATION" && paymentPending && (
                <TicketButton
                  variant="primary"
                  className="w-full h-14 text-base"
                  onClick={handlePayNow}
                  disabled={isPaying}
                >
                  {isPaying && <Loader2 className="h-5 w-5 animate-spin" />}
                  {isPaying
                    ? "Preparing Razorpay Checkout…"
                    : `Pay Now • ${formatFare(activeFareValue)}`}
                </TicketButton>
              )}
              {!canCancel ? (
                <TicketButton
                  variant={ride.status === "COMPLETED" ? "success" : "primary"}
                  className="w-full h-13 text-sm uppercase tracking-wider"
                  onClick={() => navigate("/dashboard")}
                >
                  Back to Passenger Dashboard
                </TicketButton>
              ) : (
                <TicketButton
                  variant="ghost"
                  className="w-full h-12 text-xs uppercase tracking-wider font-bold"
                  onClick={() => setShowCancelConfirm(true)}
                >
                  Cancel Ride Request
                </TicketButton>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Cancel Modal */}
      {showCancelConfirm && (
        <div
          onClick={() => setShowCancelConfirm(false)}
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-xs"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm overflow-hidden rounded-[2.25rem] border border-[#fff4dc]/80 bg-gradient-to-b from-[#fffaf0] via-[#fff4dc] to-[#f7e2b8] p-6 shadow-2xl"
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-rose-950/15 text-rose-700 border border-rose-500/30">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <p
                    className="text-xl font-black tracking-tight text-[#2e1808]"
                    style={{ fontFamily: DISPLAY_FONT }}
                  >
                    Cancel this ride?
                  </p>
                  <p className="mt-1 text-xs font-medium text-[#6b3a12]">
                    Frequent cancellations may affect your rider priority score.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#fffaf0] text-[#3a1f0a] border border-[#7a4416]/20 transition hover:bg-[#fff4dc]"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-center gap-3 w-full">
              <TicketButton
                variant="ghost"
                className="flex-1 !px-4 !py-3 text-xs font-bold"
                onClick={() => setShowCancelConfirm(false)}
              >
                Keep Ride
              </TicketButton>
              <TicketButton
                variant="danger"
                className="flex-1 !px-4 !py-3 text-xs font-bold"
                onClick={handleCancel}
                disabled={isCancelling}
              >
                {isCancelling ? "Cancelling…" : "Yes, Cancel"}
              </TicketButton>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Stop({
  color,
  square,
  label,
  value,
}: {
  color: "saddle" | "brass";
  square?: boolean;
  label: string;
  value: string;
}) {
  const dotBase =
    color === "saddle"
      ? "bg-[#3a1f0a] shadow-[0_0_10px_rgba(58,31,10,0.45)]"
      : "bg-[#b8722c] shadow-[0_0_10px_rgba(184,114,44,0.45)]";

  return (
    <div className="relative z-10 flex items-center gap-3.5 w-full">
      <div className="relative grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#fffdf9]">
        {color === "saddle" && <span className="absolute h-6 w-6 rounded-full bg-[#3a1f0a]/15" />}
        <span
          className={`relative h-3 w-3 ${dotBase} ${
            square ? "rotate-45 rounded-[2px]" : "rounded-full"
          }`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#7a4416]">{label}</p>
        <p
          className="mt-0.5 truncate text-sm font-bold text-[#2e1808]"
          style={{ fontFamily: DISPLAY_FONT }}
          title={value}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between w-full">
      <span className="text-[#6b3a12]">{label}</span>
      <span className="font-black text-[#2e1808]" style={{ fontFamily: MONO_FONT }}>
        {value}
      </span>
    </div>
  );
}