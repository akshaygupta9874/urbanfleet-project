import { useEffect, useRef, useState, useMemo } from "react";
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
import { formatFare, formatDistance, formatDuration } from "./lib/formatters";
import type { Coordinates } from "./types/location";
import type { RideDto as Ride, RideStatus } from "./types/ride";

const payableStatuses: PaymentStatus[] = ["CREATED", "PENDING", "AUTHORIZED"];

const DISPLAY_FONT = "'Fraunces', Georgia, serif";
const BODY_FONT = "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif";
const MONO_FONT = "'JetBrains Mono', ui-monospace, 'SF Mono', monospace";

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
    title: "En route to destination",
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
  const color = tone === "complete" ? "#047857" : "#be123c";
  const pathId = tone === "complete" ? "stampArcComplete" : "stampArcVoid";
  return (
    <div className="relative mx-auto grid h-28 w-28 place-items-center" style={{ color }}>
      <svg
        viewBox="0 0 140 140"
        className="absolute inset-0 h-full w-full"
        style={{ filter: "drop-shadow(0 2px 1px rgba(0,0,0,0.08))" }}
      >
        <defs>
          <path id={pathId} d="M 15 70 A 55 55 0 1 1 125 70" fill="none" />
        </defs>
        <circle
          cx="70"
          cy="70"
          r="62"
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeDasharray="3 4"
          opacity="0.85"
        />
        <circle cx="70" cy="70" r="50" fill="none" stroke={color} strokeWidth="1.5" opacity="0.7" />
        <text fontSize="10.5" fontWeight="700" letterSpacing="2" fill={color} opacity="0.9">
          <textPath href={`#${pathId}`} startOffset="50%" textAnchor="middle">
            • {label} •
          </textPath>
        </text>
      </svg>
      <div
        className="relative grid h-12 w-12 place-items-center rounded-full border-2"
        style={{ borderColor: color }}
      >
        {tone === "complete" ? <CheckCircle2 className="h-6 w-6" /> : <X className="h-6 w-6" />}
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
    <div className="relative rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9]/90 px-3 py-4 shadow-inner w-full">
      <div className="absolute left-7 right-7 top-[30px] h-[2px] bg-[#7a4416]/20" />
      <div
        className="absolute left-7 top-[30px] h-[2px] bg-gradient-to-r from-[#3a1f0a] via-[#b8722c] to-emerald-600 transition-all duration-500"
        style={{ width: `calc(${progress} * (100% - 3.5rem))` }}
      />
      <div className="relative flex items-start justify-between w-full">
        {STATUS_STEPS.map((s, i) => {
          const done = i <= activeIdx && status !== "CANCELLED";
          const current = i === activeIdx && status !== "CANCELLED";
          return (
            <div
              key={s.key}
              className="flex flex-col items-center gap-1.5"
              style={{ width: `${100 / STATUS_STEPS.length}%` }}
            >
              <div
                className={`grid h-7 w-7 place-items-center rounded-full border-2 text-[10px] font-bold transition-all ${
                  done
                    ? "border-[#ffd88a] bg-gradient-to-br from-[#3a1f0a] to-[#2e1808] text-[#ffd88a] shadow-sm"
                    : "border-[#7a4416]/30 bg-[#fffaf0] text-[#7a4416]"
                } ${current ? "ring-4 ring-[#c58a3a]/30 scale-110" : ""}`}
              >
                {done ? <CheckCircle2 className="h-3.5 w-3.5 text-[#ffd88a]" /> : i + 1}
              </div>
              <span
                className={`text-center text-[9px] font-bold uppercase tracking-wider ${
                  current ? "text-[#3a1f0a] font-black" : "text-[#7a4416]/70"
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
}: {
  firstName: string;
  lastName: string;
  vehicleNo: string;
  email: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#c58a3a]/45 bg-gradient-to-br from-[#fffdf9] via-[#fff4dc] to-[#f7e2b8] p-4 shadow-md w-full">
      <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-[#b8722c]/20 blur-2xl" />
      <div className="relative flex items-center justify-between gap-3 w-full">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="relative shrink-0">
            <div
              className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-lg font-bold text-[#ffd88a] shadow-md border border-[#c58a3a]/50"
              style={{ fontFamily: DISPLAY_FONT }}
            >
              {firstName?.[0]?.toUpperCase() || "D"}
            </div>
            <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full border-2 border-[#fffaf0] bg-emerald-600 text-white shadow">
              <Shield className="h-3 w-3" />
            </span>
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <p
              className="truncate text-base font-black text-[#2e1808]"
              style={{ fontFamily: DISPLAY_FONT }}
            >
              {firstName} {lastName}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-lg bg-[#fffaf0] px-2 py-0.5 font-bold text-[#3a1f0a] border border-[#7a4416]/20 shadow-2xs">
                <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                4.9
              </span>
              <span className="inline-flex items-center gap-1 rounded-md border border-[#3a1f0a] bg-[#ffd88a] px-2 py-0.5 text-[11px] font-extrabold tracking-wider text-[#2e1808] shadow-2xs" style={{ fontFamily: MONO_FONT }}>
                <span className="text-[8px] font-black text-[#7a4416]">IND</span>
                {vehicleNo}
              </span>
            </div>
          </div>
        </div>
        {email && (
          <a
            href={`mailto:${email}`}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffd88a] shadow-lg hover:opacity-95 transition-opacity"
            aria-label="Email driver"
            title="Contact driver via email"
          >
            <Mail className="h-4 w-4" />
          </a>
        )}
      </div>
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
    <div className="w-full relative overflow-hidden rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9] p-3.5 text-center shadow-xs">
      <div className="mx-auto grid h-8 w-8 place-items-center rounded-xl bg-[#3a1f0a] text-[#ffd88a] shadow-2xs">
        {icon}
      </div>
      <p className="mt-2 text-sm font-black text-[#2e1808]" style={{ fontFamily: MONO_FONT }}>
        {value}
      </p>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#7a4416] mt-0.5">
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
      await appApi.post(`/ride/${ride.id}/rate`, {
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
      const endpoint = id ? `/ride/${id}` : "/ride/current";
      const response = await appApi.get<{ success: boolean; data: Ride }>(endpoint);
      const currentRide = response.data.data;
      if (currentRide) {
        setRide(currentRide);
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
  }, [rideId]);

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
      await appApi.patch(`/ride/${ride.id}/cancel`, {
        cancellationReason: "Rider cancelled from ride details",
      });
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
        `/ride/${currentRide.id}/fare-preview`
      );
      currentRide = response.data.data;
      setRide(currentRide);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      const serverMsg = axiosErr?.response?.data?.message;
      setError(serverMsg || "Unable to calculate the final fare. Please try again.");
      return;
    }

    if (!currentRide.fare.breakdown) {
      setError("Ride fare breakdown is not available for payment.");
      return;
    }

    const driverId = currentRide.driver?.id ?? "";
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
    } catch {
      setError("Unable to launch payment checkout. Please try again later.");
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
          <TicketButton variant="primary" className="mt-6 w-full" onClick={() => navigate("/dashboard")}>
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

  const driverFirstName = ride.driver?.firstName || "Assigned Captain";
  const driverLastName = ride.driver?.lastName || "";
  const vehicleNo =
    ride.driver?.vehicleNumber ||
    ride.driver?.vehicle?.registrationNumber ||
    "KA-01-UF-1001";
  const driverEmail = ride.driver?.user?.email || ride.driver?.email || "";

  const activeFareValue = ride.fare.final ?? ride.fare.estimated ?? 0;
  const activeDistance = ride.distance.actual ?? ride.distance.estimated ?? 0;
  const activeDuration = ride.duration.actual ?? ride.duration.estimated ?? 0;

  const canCancel =
    ride.status === "SEARCHING" ||
    ride.status === "DRIVER_ASSIGNED" ||
    ride.status === "DRIVER_ARRIVING";

  return (
    <main
      className="relative min-h-screen w-full overflow-x-hidden bg-[#f5e6c8] text-[#2e1808]"
      style={{ fontFamily: BODY_FONT }}
    >
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

      <div className="relative z-10 mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-10 py-5 space-y-6">
        {/* Header Bar */}
        <header className="sticky top-3 z-40 w-full">
          <div className="w-full rounded-[1.75rem] border border-[#fff4dc]/80 bg-gradient-to-r from-[#fffdf9]/95 via-[#fff5e0]/90 to-[#f7e2b8]/90 backdrop-blur-2xl shadow-xl px-4 sm:px-6 py-3 flex items-center justify-between">
            <button
              onClick={() => navigate("/dashboard")}
              className="flex items-center gap-2 h-11 px-4 rounded-2xl border border-[#7a4416]/25 bg-[#fffaf0] text-xs font-bold text-[#3a1f0a] shadow-xs transition hover:bg-[#fff4dc] active:scale-95"
              aria-label="Back to Dashboard"
            >
              <ArrowLeft className="h-4 w-4 text-[#b8722c]" />
              <span className="hidden sm:inline">Dashboard</span>
            </button>

            <div
              className="flex items-center gap-2.5 rounded-full border border-[#c58a3a]/40 bg-[#fffdf9] px-5 py-2 text-xs font-bold uppercase tracking-[0.2em] text-[#3a1f0a] shadow-sm"
              style={{ fontFamily: MONO_FONT }}
            >
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Ride #{ride.id.slice(-6)}
            </div>

            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] to-[#6b3a12] text-[#ffd88a] shadow-md">
              <Navigation2 className="h-4 w-4" />
            </div>
          </div>
        </header>

        {/* RESPONSIVE FULL-WIDTH GRID */}
        <div className="grid gap-6 lg:grid-cols-12 lg:items-start w-full">
          {/* LEFT COLUMN: Map Hero Panel (Span 7 on Laptop) */}
          <section className="lg:col-span-7 flex flex-col w-full">
            <div className="relative h-[340px] sm:h-[460px] lg:h-[680px] w-full overflow-hidden rounded-[2.5rem] border border-[#fff4dc]/80 shadow-2xl bg-[#fffaf0]">
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
                    title: "Pickup",
                  },
                  {
                    position: {
                      lat: ride.destination.coordinates.latitude,
                      lng: ride.destination.coordinates.longitude,
                    },
                    label: "D",
                    title: "Destination",
                  },
                  ...(driverLocation
                    ? [
                        {
                          position: {
                            lat: driverLocation.latitude,
                            lng: driverLocation.longitude,
                          },
                          label: "🚗",
                          title: "Driver",
                        },
                      ]
                    : []),
                ]}
                path={mapPath}
              />

              {/* Floating Map Legend Overlay */}
              <div className="pointer-events-none absolute bottom-4 left-4 right-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3 rounded-xl border border-[#fff4dc]/60 bg-[#2e1808]/85 px-4 py-2 text-[11px] font-semibold text-[#ffe9be] shadow-lg backdrop-blur-md">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" /> P: Pickup
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-amber-400" /> D: Drop-off
                  </span>
                  {driverLocation && (
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-sky-400 animate-ping" /> Live Captain GPS
                    </span>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* RIGHT COLUMN: Ticket Body & Controls (Span 5 on Laptop) */}
          <section className="lg:col-span-5 relative space-y-5 overflow-hidden rounded-[2.5rem] border border-[#fff4dc]/80 bg-gradient-to-b from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-6 sm:p-8 shadow-2xl backdrop-blur-2xl w-full">
            <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

            {/* Headline */}
            <div className="relative flex items-start justify-between gap-3 w-full">
              <div className="min-w-0">
                <p
                  className="text-[11px] font-black uppercase tracking-[0.24em]"
                  style={{ color: statusMeta.accent }}
                >
                  {ride.status.replace(/_/g, " ")}
                </p>
                <h1
                  className="mt-1 truncate text-2xl font-black tracking-tight text-[#2e1808] sm:text-3xl"
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
              <div className="flex justify-center py-1">
                <TicketStamp
                  label="TRIP COMPLETE"
                  sublabel="Trip completed successfully"
                  tone="complete"
                />
              </div>
            )}
            {ride.status === "CANCELLED" && (
              <div className="flex justify-center py-1">
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
              />
            )}

            {/* Copyable OTP Security Vault */}
            {ride.otp &&
              ["SEARCHING", "DRIVER_ASSIGNED", "DRIVER_ARRIVING"].includes(ride.status) && (
                <section className="flex items-center justify-between gap-4 rounded-2xl border-2 border-[#c58a3a]/50 bg-[#fffdf9] p-4 shadow-sm">
                  <div className="flex items-start gap-3.5">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#3a1f0a] text-[#ffd88a] shadow-sm">
                      <Shield className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-wider text-[#3a1f0a]">
                        Boarding Verification PIN
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#6b3a12]">
                        Share this 4-digit PIN with your captain at pickup.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      aria-label="Ride verification code"
                      className="rounded-xl bg-[#3a1f0a] px-3.5 py-2 text-xl font-black tracking-[0.3em] text-[#ffd88a] shadow-inner"
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
                      className="grid h-10 w-10 place-items-center rounded-xl border border-[#7a4416]/25 bg-[#fffaf0] text-[#3a1f0a] hover:bg-[#fff4dc] transition-all"
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

            {/* Trip Stops */}
            <div className="relative overflow-hidden rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9] p-4 shadow-xs w-full">
              <div className="relative flex flex-col gap-3.5 w-full">
                <Stop color="saddle" label="Pickup Location" value={ride.pickup.address} />
                <div className="absolute left-[12px] top-[26px] bottom-[26px] w-6 -translate-x-1/2">
                  <svg className="absolute left-1/2 top-0 h-full w-[2px] -translate-x-1/2 overflow-visible">
                    <line
                      x1="1"
                      y1="0"
                      x2="1"
                      y2="100%"
                      stroke="#b8722c"
                      strokeWidth="2"
                      strokeDasharray="4 4"
                    />
                  </svg>
                  {!isTerminal && (
                    <div
                      className="absolute left-1/2 -translate-x-1/2 grid h-6 w-6 place-items-center rounded-full bg-[#3a1f0a] text-[#ffd88a] shadow-md ring-2 ring-[#fffaf0]"
                      style={{ top: `${Math.min(85, progressFraction * 100)}%` }}
                    >
                      <Car className="h-3 w-3" />
                    </div>
                  )}
                </div>
                <Stop color="brass" square label="Destination Drop-Off" value={ride.destination.address} />
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-3 w-full">
              <StatTile
                icon={<IndianRupee className="h-4 w-4" />}
                label="Fare"
                value={formatFare(activeFareValue)}
              />
              <StatTile
                icon={<Clock className="h-4 w-4" />}
                label="ETA"
                value={formatDuration(activeDuration)}
              />
              <StatTile
                icon={<RouteIcon className="h-4 w-4" />}
                label="Distance"
                value={formatDistance(activeDistance)}
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
              <section className="rounded-2xl border border-[#c58a3a]/40 bg-gradient-to-b from-[#fffdf9] via-[#fff4dc] to-[#f7e2b8] p-5 shadow-md">
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
                    <div className="flex justify-center items-center gap-2 py-1">
                      {[1, 2, 3, 4, 5].map((star) => {
                        const filled = (hoverRating ?? ratingScore) >= star;
                        return (
                          <button
                            key={star}
                            type="button"
                            onClick={() => setRatingScore(star)}
                            onMouseEnter={() => setHoverRating(star)}
                            onMouseLeave={() => setHoverRating(null)}
                            className="p-1 transition-transform hover:scale-125 focus:outline-none"
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
                  {isPaying ? "Preparing Razorpay Checkout…" : `Pay Now • ${formatFare(activeFareValue)}`}
                </TicketButton>
              )}
              {!canCancel ? (
                <TicketButton
                  variant={ride.status === "COMPLETED" ? "success" : "primary"}
                  className="w-full h-13 text-sm uppercase tracking-wider"
                  onClick={() => navigate("/dashboard")}
                >
                  Back to Passenger Console
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
    <div className="relative z-10 flex items-start gap-3.5 w-full">
      <div className="relative mt-1 grid h-6 w-6 place-items-center">
        {color === "saddle" && <span className="absolute h-6 w-6 rounded-full bg-[#3a1f0a]/20" />}
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
          style={{ fontFamily: "'Fraunces', Georgia, serif" }}
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
