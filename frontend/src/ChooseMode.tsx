import MapView from "./components/MapView";
import { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { appApi } from "./apiInterceptor";
import { Button } from "./components/ui/button";
import {
  Bike,
  Car,
  Clock,
  IndianRupee,
  Check,
  Loader2,
  Sparkles,
  ArrowLeft,
  Users,
  Route as RouteIcon,
  ShieldCheck,
  Gem,
  AlertTriangle,
  X,
  Zap,
  ChevronRight,
  ChevronDown,
  Receipt,
  Navigation,
  CheckCircle2,
  Lock,
} from "lucide-react";
import { useAuthContext } from "./context/auth-context";
import LoadingScreen from "./components/LoadingScreen";
import { getGeoapifyRouteLines, isGeoapifyFeatureCollection } from "./types/geoapify";
import CityMapBackground from "./components/CityMapBackground";
import { formatFareWithoutSymbol } from "./lib/formatters";
import type { Coordinates, LocationPoint } from "./types/location";

interface PendingRide {
  pickup: string;
  destination: string;
  pickupCoords: Coordinates;
  destinationCoords: Coordinates;
  routeDistance: number | null;
  routeDuration: number | null;
  selectedMode?: "bike" | "auto" | "car";
}

function parsePendingRide(value: unknown): PendingRide | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const pickupCoords = data.pickupCoords;
  const destinationCoords = data.destinationCoords;
  if (
    typeof data.pickup !== "string" ||
    typeof data.destination !== "string" ||
    !pickupCoords ||
    typeof pickupCoords !== "object" ||
    !destinationCoords ||
    typeof destinationCoords !== "object"
  )
    return null;

  const pickup = pickupCoords as Record<string, unknown>;
  const destination = destinationCoords as Record<string, unknown>;
  if (
    typeof pickup.latitude !== "number" ||
    typeof pickup.longitude !== "number" ||
    typeof destination.latitude !== "number" ||
    typeof destination.longitude !== "number"
  )
    return null;

  return {
    pickup: data.pickup,
    destination: data.destination,
    pickupCoords: { latitude: pickup.latitude, longitude: pickup.longitude },
    destinationCoords: { latitude: destination.latitude, longitude: destination.longitude },
    routeDistance: typeof data.routeDistance === "number" ? data.routeDistance : null,
    routeDuration: typeof data.routeDuration === "number" ? data.routeDuration : null,
    selectedMode:
      data.selectedMode === "bike" ||
      data.selectedMode === "auto" ||
      data.selectedMode === "car"
        ? data.selectedMode
        : undefined,
  };
}

interface RideModeOption {
  id: "bike" | "auto" | "car";
  name: string;
  tagline: string;
  description: string;
  capacity: string;
  badge: string;
  perks: string[];
  icon: React.ReactNode;
  multiplier: number;
  etaMinutes: number;
}

const RIDE_MODES: RideModeOption[] = [
  {
    id: "bike",
    name: "Moto / Bike",
    tagline: "Fastest through peak gridlock",
    description: "Nimble solo two-wheeler dispatch",
    capacity: "1 Rider",
    badge: "Express • Save 40%",
    perks: ["Helmet Provided", "Zero Traffic Delay"],
    icon: <Bike className="h-5 w-5 text-[#ffd88a]" />,
    multiplier: 0.7,
    etaMinutes: 3,
  },
  {
    id: "auto",
    name: "Auto Rickshaw",
    tagline: "Classic doorstep city hop",
    description: "Open-air local transit with zero surge",
    capacity: "3 Seats",
    badge: "Best Value",
    perks: ["Doorstep Pickup", "No Surge Fee"],
    icon: <Sparkles className="h-5 w-5 text-[#ffd88a]" />,
    multiplier: 0.9,
    etaMinutes: 5,
  },
  {
    id: "car",
    name: "Comfort Sedan",
    tagline: "Spacious & climate-controlled",
    description: "Top-rated captains & extra luggage room",
    capacity: "4 Seats",
    badge: "AC Prime",
    perks: ["AC Cabin", "Top 5% Captains"],
    icon: <Car className="h-5 w-5 text-[#ffd88a]" />,
    multiplier: 1.2,
    etaMinutes: 7,
  },
];

const DISPLAY_FONT = "'Fraunces', Georgia, serif";
const BODY_FONT = "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif";
const MONO_FONT = "'JetBrains Mono', ui-monospace, 'SF Mono', monospace";

const containerEntranceVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.45,
      ease: [0.16, 1, 0.3, 1],
      staggerChildren: 0.06,
    },
  },
};

const itemEntranceVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
  },
};

function formatPaiseToRupee(amount: number | null | undefined): string {
  return formatFareWithoutSymbol(amount);
}

export default function ChooseMode() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthContext();

  const [routePolyline, setRoutePolyline] = useState<[number, number][]>([]);
  const [rideData] = useState<PendingRide | null>(() =>
    parsePendingRide((location.state as { pendingRide?: unknown } | null)?.pendingRide)
  );
  const [bookingError, setBookingError] = useState("");
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [baseTimestamp] = useState(() => Date.now());
  const [isLoading, setIsLoading] = useState(Boolean(rideData));
  const [isCreatingRide, setIsCreatingRide] = useState(false);
  const [selectedMode, setSelectedMode] = useState<"bike" | "auto" | "car">(
    rideData?.selectedMode ?? "car"
  );

  // Role & Active Ride Protection Guard
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (user?.roles?.includes("DRIVER") && !user?.roles?.includes("RIDER")) {
          navigate("/driver-dashboard", { replace: true });
          return;
        }

        if (user?.roles?.includes("DRIVER")) {
          const driverRes = await appApi
            .get<{ success: boolean; data: { status?: string; id?: string; driverId?: string } }>(
              "/rides/driver/current"
            )
            .catch(() => null);
          if (cancelled) return;
          const driverRide = driverRes?.data?.data;
          if (
            driverRide &&
            [
              "DRIVER_ASSIGNED",
              "DRIVER_ARRIVING",
              "RIDE_STARTED",
              "ARRIVED_AT_DESTINATION",
            ].includes(driverRide.status || "")
          ) {
            navigate("/driver-dashboard", { replace: true });
            return;
          }
        }

        if (user?.roles?.includes("RIDER")) {
          const riderRes = await appApi
            .get<{ success: boolean; data: { status?: string; id?: string; riderId?: string } }>(
              "/rides/current"
            )
            .catch(() => null);
          if (cancelled) return;
          const riderRide = riderRes?.data?.data;
          if (
            riderRide &&
            riderRide.riderId === user?.id &&
            riderRide.status !== "COMPLETED" &&
            riderRide.status !== "CANCELLED"
          ) {
            navigate(`/ride/${riderRide.id}`, { replace: true });
            return;
          }
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, user?.id, user?.roles]);

  // Fetch Geoapify Route Polyline
  useEffect(() => {
    if (!rideData) return;
    const parsed = rideData;

    let cancelled = false;
    (async () => {
      try {
        const pLat = parsed.pickupCoords.latitude;
        const pLon = parsed.pickupCoords.longitude;
        const dLat = parsed.destinationCoords.latitude;
        const dLon = parsed.destinationCoords.longitude;
        const apiKey = import.meta.env.VITE_GEOAPIFY_API_KEY || "";

        const url = `https://api.geoapify.com/v1/routing?waypoints=${pLat},${pLon}|${dLat},${dLon}&mode=drive&apiKey=${apiKey}`;
        const routeRes = await fetch(url);
        const routeDataRes: unknown = await routeRes.json();

        if (!cancelled && isGeoapifyFeatureCollection(routeDataRes)) {
          const coords = getGeoapifyRouteLines(routeDataRes.features[0]);
          const flatCoords: [number, number][] = [];
          coords.forEach((line: [number, number][]) => {
            line.forEach(([lon, lat]) => {
              flatCoords.push([lat, lon]);
            });
          });
          setRoutePolyline(flatCoords);
        }
      } catch {
        // Fallback straight-line path will still render on MapView
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rideData]);

  const handleBackToModify = () => {
    if (rideData) {
      navigate("/dashboard", {
        state: {
          prefillPickup: rideData.pickup,
          prefillDestination: rideData.destination,
        },
      });
    } else {
      navigate("/dashboard");
    }
  };

  const handleConfirmAndStart = async () => {
    if (!rideData) return;
    setBookingError("");
    setIsCreatingRide(true);
    try {
      const distanceKm = rideData.routeDistance
        ? Number((rideData.routeDistance / 1000).toFixed(3))
        : 5;
      const selectedMultiplier =
        RIDE_MODES.find((mode) => mode.id === selectedMode)?.multiplier ?? 1.2;
      const calculatedFare = Math.round(
        (2500 + Math.round(distanceKm * 500) + 400) * selectedMultiplier
      );

      const pickup: LocationPoint = {
        address: rideData.pickup,
        coordinates: rideData.pickupCoords,
      };
      const destination: LocationPoint = {
        address: rideData.destination,
        coordinates: rideData.destinationCoords,
      };
      const response = await appApi.post<{ success: boolean; data: { id: string } }>("/rides", {
        rider: user?.id,
        vehicleType: selectedMode,
        pickup,
        destination,
        fare: { estimated: calculatedFare },
        distance: { estimated: distanceKm },
        duration: {
          estimated: rideData.routeDuration ? Math.round(rideData.routeDuration / 60) : 14,
        },
      });

      const targetRideId = response.data.data?.id;
      navigate(`/ride/${targetRideId}`, { replace: true });
    } catch (err: unknown) {
      const axiosError = err as {
        response?: { data?: { message?: string; errors?: { rider?: string[] } } };
      };
      const serverMessage =
        axiosError?.response?.data?.message ||
        (axiosError?.response?.data?.errors?.rider &&
          axiosError.response.data.errors.rider[0]);
      setBookingError(serverMessage || "Unable to create ride request. Please try again.");
      setIsCreatingRide(false);
    }
  };

  const mapPath = useMemo(() => {
    if (!rideData) return [];
    return routePolyline.length > 0
      ? routePolyline.map(([lat, lng]) => ({ lat, lng }))
      : [
          {
            lat: rideData.pickupCoords.latitude,
            lng: rideData.pickupCoords.longitude,
          },
          {
            lat: rideData.destinationCoords.latitude,
            lng: rideData.destinationCoords.longitude,
          },
        ];
  }, [routePolyline, rideData]);

  if (isLoading) {
    return <LoadingScreen sublabel="Preparing your journey options..." />;
  }

  if (!rideData) {
    return (
      <div
        className="relative grid min-h-screen place-items-center bg-[#f5e6c8] px-6 text-center text-[#2e1808]"
        style={{ fontFamily: BODY_FONT }}
      >
        <CityMapBackground />
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="relative z-10 w-full max-w-lg rounded-[2.5rem] border border-[#fff4dc]/85 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-8 shadow-2xl backdrop-blur-2xl"
        >
          <div className="pointer-events-none absolute inset-x-10 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffd88a] shadow-md">
            <Car className="h-6 w-6" />
          </div>
          <p
            className="text-xl font-black text-[#2e1808]"
            style={{ fontFamily: DISPLAY_FONT }}
          >
            No route details found. Please start over.
          </p>
          <p className="mt-2 text-xs font-medium text-[#6b3a12]">
            Select your pickup and drop-off points on the passenger console to view vehicle classes.
          </p>
          <Button
            className="mt-6 h-12 rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-7 font-bold text-[#ffe9be] shadow-lg transition hover:opacity-95 active:scale-95"
            onClick={() => navigate("/dashboard")}
          >
            Back to Passenger Dashboard
          </Button>
        </motion.div>
      </div>
    );
  }

  const distanceKm = rideData.routeDistance
    ? Number((rideData.routeDistance / 1000).toFixed(3))
    : 5;
  const durationMinutes = rideData.routeDuration
    ? Math.max(1, Math.round(rideData.routeDuration / 60))
    : 14;

  const rawBasePaise = 2500;
  const rawDistancePaise = Math.round(distanceKm * 500);
  const rawPlatformFeePaise = 400;
  const baseFareValue = rawBasePaise + rawDistancePaise + rawPlatformFeePaise;

  const activeModeObj = RIDE_MODES.find((m) => m.id === selectedMode) ?? RIDE_MODES[2];
  const activeCalculatedFare = Math.round(baseFareValue * activeModeObj.multiplier);

  const estimatedDropoffTime = new Date(
    baseTimestamp + (activeModeObj.etaMinutes + durationMinutes) * 60_000
  ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <main
      className="relative min-h-screen w-full overflow-x-hidden bg-[#f5e6c8] text-[#2e1808] selection:bg-[#3a1f0a] selection:text-[#ffd88a]"
      style={{ fontFamily: BODY_FONT }}
    >
      <CityMapBackground />

      <div className="relative z-10 mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-10 py-4 sm:py-6 space-y-5 sm:space-y-6">
        {/* Sticky Top Command Header */}
        <header className="sticky top-2.5 z-40 w-full">
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="w-full rounded-[1.75rem] border border-[#fff4dc]/85 bg-gradient-to-r from-[#fffdf9]/95 via-[#fff5e0]/92 to-[#f7e2b8]/92 backdrop-blur-2xl shadow-[0_12px_32px_-8px_rgba(46,24,8,0.18)] px-3.5 sm:px-6 py-3 flex items-center justify-between gap-2"
          >
            <button
              type="button"
              onClick={handleBackToModify}
              className="flex items-center gap-2 h-10 sm:h-11 px-3.5 sm:px-4 rounded-2xl border border-[#7a4416]/25 bg-[#fffaf0] text-xs font-bold text-[#3a1f0a] shadow-2xs transition hover:bg-[#fff4dc] active:scale-95 shrink-0"
              aria-label="Back to Dashboard"
            >
              <ArrowLeft className="h-4 w-4 text-[#b8722c]" />
              <span>Modify Route</span>
            </button>

            <div className="flex items-center gap-2 min-w-0">
              <Gem className="h-4 w-4 text-[#b8722c] shrink-0 hidden md:inline" />
              <span className="truncate text-[11px] sm:text-xs font-black uppercase tracking-[0.18em] sm:tracking-[0.22em] text-[#3a1f0a]">
                Dispatch • Step 2 of 2
              </span>
            </div>

            <div
              className="flex items-center gap-1.5 sm:gap-2.5 rounded-full border border-[#c58a3a]/40 bg-[#fffdf9] px-3 sm:px-4 py-1.5 text-[11px] sm:text-xs font-bold text-[#3a1f0a] shadow-2xs shrink-0"
              style={{ fontFamily: MONO_FONT }}
            >
              <RouteIcon className="h-3.5 w-3.5 text-[#b8722c]" />
              <span>{distanceKm.toFixed(1)} km</span>
              <span className="text-[#7a4416]/40">•</span>
              <Clock className="h-3.5 w-3.5 text-[#b8722c]" />
              <span>~{durationMinutes}m</span>
            </div>
          </motion.div>
        </header>

        {/* Responsive 12-Column Split-Screen Grid */}
        <motion.div
          variants={containerEntranceVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-7 items-start w-full"
        >
          {/* LEFT COLUMN (lg:col-span-7): Interactive Route Map & Live Corridor HUD */}
          <motion.section
            variants={itemEntranceVariants}
            className="lg:col-span-7 flex flex-col w-full space-y-4 lg:sticky lg:top-24"
          >
            <div className="relative h-[270px] sm:h-[390px] lg:h-[620px] w-full overflow-hidden rounded-[2.25rem] sm:rounded-[2.5rem] border border-[#fff4dc]/85 shadow-[0_24px_60px_-15px_rgba(46,24,8,0.28)] bg-[#fffaf0]">
              <MapView
                center={{
                  lat: rideData.pickupCoords.latitude,
                  lng: rideData.pickupCoords.longitude,
                }}
                zoom={14}
                markers={[
                  {
                    position: {
                      lat: rideData.pickupCoords.latitude,
                      lng: rideData.pickupCoords.longitude,
                    },
                    label: "P",
                    title: "Pickup",
                  },
                  {
                    position: {
                      lat: rideData.destinationCoords.latitude,
                      lng: rideData.destinationCoords.longitude,
                    },
                    label: "D",
                    title: "Destination",
                  },
                ]}
                path={mapPath}
              />

              {/* Top Floating Telemetry Pill (Synchronized with Selected Vehicle Class) */}
              <div className="pointer-events-none absolute top-3.5 left-3.5 right-3.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 rounded-2xl border border-[#fff4dc]/80 bg-[#fffdf9]/95 px-3.5 py-2 text-xs font-bold text-[#2e1808] shadow-xl backdrop-blur-md">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  </span>
                  <span className="hidden sm:inline">Corridor Locked</span>
                  <span className="hidden sm:inline text-[#7a4416]/40">•</span>
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={selectedMode}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.18 }}
                      className="text-[#3a1f0a]"
                      style={{ fontFamily: MONO_FONT }}
                    >
                      {activeModeObj.name} • Arrival {estimatedDropoffTime}
                    </motion.span>
                  </AnimatePresence>
                </div>

                <div
                  className="hidden sm:flex items-center gap-1.5 rounded-2xl border border-[#c58a3a]/50 bg-[#2e1808]/90 px-3.5 py-2 text-xs font-bold text-[#ffd88a] shadow-xl backdrop-blur-md"
                  style={{ fontFamily: MONO_FONT }}
                >
                  <Clock className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Pickup in {activeModeObj.etaMinutes} min</span>
                </div>
              </div>

              {/* Bottom Floating Map Legend */}
              <div className="pointer-events-none absolute bottom-3.5 left-3.5 right-3.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3 sm:gap-4 rounded-xl border border-[#fff4dc]/60 bg-[#2e1808]/90 px-3.5 py-2 text-[11px] font-semibold text-[#ffe9be] shadow-lg backdrop-blur-md">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" /> P: Pickup
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-amber-400" /> D: Drop-Off
                  </span>
                  <span className="text-[#ffd88a]/50">|</span>
                  <span className="text-[#ffd88a]" style={{ fontFamily: MONO_FONT }}>
                    {distanceKm.toFixed(2)} km
                  </span>
                </div>
              </div>
            </div>

            {/* Desktop Telemetry & Security Guarantees Strip Below Map */}
            <div className="hidden lg:grid grid-cols-3 gap-3.5">
              {[
                {
                  icon: Lock,
                  title: "4-Digit PIN Lock",
                  sub: "Cryptographic boarding verification",
                },
                {
                  icon: Navigation,
                  title: "Live Vector GPS",
                  sub: "Sub-second WebSocket tracking",
                },
                {
                  icon: ShieldCheck,
                  title: "Zero Hidden Surge",
                  sub: "Audited upfront fare guarantee",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="flex items-center gap-3 rounded-2xl border border-[#fff4dc]/80 bg-[#fffdf9]/90 px-4 py-3 shadow-sm backdrop-blur-xl"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#3a1f0a] text-[#ffd88a] shadow-2xs">
                    <item.icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-black text-[#2e1808]">{item.title}</p>
                    <p className="truncate text-[11px] font-medium text-[#7a4416]">{item.sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.section>

          {/* RIGHT COLUMN (lg:col-span-5): Luxury Perforated Dispatch Ticket */}
          <motion.section
            variants={itemEntranceVariants}
            className="lg:col-span-5 relative overflow-hidden rounded-[2.25rem] sm:rounded-[2.5rem] border border-[#fff4dc]/85 bg-gradient-to-b from-[#fffdf9]/96 via-[#fff4dc]/92 to-[#f7e2b8]/92 p-5 sm:p-8 shadow-[0_28px_70px_-15px_rgba(46,24,8,0.28)] backdrop-blur-2xl w-full space-y-5"
          >
            {/* Ticket Perforation Edge Dots */}
            <div className="pointer-events-none absolute left-0 top-1/2 hidden sm:flex -translate-x-1/2 -translate-y-1/2 flex-col gap-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <span
                  key={`pl-${i}`}
                  className="h-2.5 w-2.5 rounded-full bg-[#f5e6c8] shadow-inner"
                />
              ))}
            </div>
            <div className="pointer-events-none absolute right-0 top-1/2 hidden sm:flex translate-x-1/2 -translate-y-1/2 flex-col gap-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <span
                  key={`pr-${i}`}
                  className="h-2.5 w-2.5 rounded-full bg-[#f5e6c8] shadow-inner"
                />
              ))}
            </div>

            {/* Brass Top Rail */}
            <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#3a1f0a] to-[#7a4416] px-3.5 py-1 text-[10px] font-bold uppercase tracking-widest text-[#ffd88a] shadow-sm">
                  <Zap className="h-3 w-3" />
                  Select Ride Category
                </div>
                <h1
                  className="mt-2 text-2xl sm:text-3xl font-black tracking-tight text-[#2e1808]"
                  style={{ fontFamily: DISPLAY_FONT }}
                >
                  Choose your ride mode
                </h1>
                <p className="mt-0.5 text-xs font-medium text-[#6b3a12]">
                  Instant proximity matching with verified captains nearby.
                </p>
              </div>
            </div>

            {/* Route Itinerary Summary Box */}
            <div className="relative overflow-hidden rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9] p-4 shadow-2xs w-full">
              <div className="flex items-center justify-between border-b border-[#7a4416]/10 pb-2.5 mb-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#7a4416]">
                  Trip Stops
                </span>
                <button
                  type="button"
                  onClick={handleBackToModify}
                  className="text-[11px] font-bold text-[#b8722c] hover:text-[#3a1f0a] flex items-center gap-0.5 transition-colors"
                >
                  Edit Route <ChevronRight className="h-3 w-3" />
                </button>
              </div>

              <div className="relative flex flex-col gap-3.5 w-full">
                {/* Pickup Row */}
                <div className="relative z-10 flex items-start gap-3.5 w-full">
                  <div className="relative mt-0.5 grid h-5 w-5 place-items-center shrink-0">
                    <span className="absolute h-5 w-5 rounded-full bg-emerald-600/20" />
                    <span className="relative h-2.5 w-2.5 rounded-full bg-emerald-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#7a4416]">
                      Pickup Location
                    </p>
                    <p
                      className="truncate text-xs font-bold text-[#2e1808]"
                      title={rideData.pickup}
                    >
                      {rideData.pickup}
                    </p>
                  </div>
                </div>

                {/* Dashed Connector Line */}
                <div className="pointer-events-none absolute left-[10px] top-[22px] bottom-[22px] w-[2px] -translate-x-1/2 border-l-2 border-dashed border-[#b8722c]/60" />

                {/* Destination Row */}
                <div className="relative z-10 flex items-start gap-3.5 w-full">
                  <div className="relative mt-0.5 grid h-5 w-5 place-items-center shrink-0">
                    <span className="relative h-2.5 w-2.5 rotate-45 rounded-[2px] bg-[#b8722c]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#7a4416]">
                      Destination Drop-Off
                    </p>
                    <p
                      className="truncate text-xs font-bold text-[#2e1808]"
                      title={rideData.destination}
                    >
                      {rideData.destination}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Inline Dismissible Error Alert */}
            <AnimatePresence>
              {bookingError && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.98 }}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-rose-500/40 bg-rose-950/15 p-3.5 text-xs font-semibold text-rose-950 shadow-2xs"
                >
                  <div className="flex items-center gap-2.5">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-rose-700" />
                    <span>{bookingError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setBookingError("")}
                    className="rounded-lg p-1 hover:bg-rose-500/15"
                    aria-label="Dismiss error"
                  >
                    <X className="h-3.5 w-3.5 text-rose-800" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* THREE VEHICLE MODE OPTIONS (BIKE, AUTO, CAR) WITH SHARED LAYOUT SPRING RING */}
            <div className="space-y-3 w-full" role="radiogroup" aria-label="Vehicle class options">
              {RIDE_MODES.map((mode) => {
                const isSelected = selectedMode === mode.id;
                const calculatedFare = Math.round(baseFareValue * mode.multiplier);
                const modeDropoff = new Date(
                  baseTimestamp + (mode.etaMinutes + durationMinutes) * 60_000
                ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

                return (
                  <motion.div
                    key={mode.id}
                    layout
                    role="radio"
                    aria-checked={isSelected}
                    tabIndex={0}
                    onClick={() => setSelectedMode(mode.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedMode(mode.id);
                      }
                    }}
                    className={`group relative w-full flex cursor-pointer items-center justify-between rounded-2xl border p-3.5 sm:p-4 transition-colors duration-200 focus:outline-none ${
                      isSelected
                        ? "border-transparent bg-gradient-to-r from-[#fffdf9] via-[#fff8eb] to-[#fcf0d5] shadow-[0_14px_30px_-10px_rgba(58,31,10,0.22)]"
                        : "border-[#7a4416]/20 bg-[#fffaf0]/80 hover:bg-[#fffdf9] hover:border-[#b8722c]/50"
                    }`}
                  >
                    {/* Shared Layout Spring Selection Border */}
                    {isSelected && (
                      <motion.div
                        layoutId="selectedVehicleBorder"
                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                        className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-[#3a1f0a] ring-3 ring-[#c58a3a]/25"
                      />
                    )}

                    <div className="relative z-10 flex items-center gap-3.5 min-w-0">
                      <div
                        className={`relative grid h-12 w-12 sm:h-13 sm:w-13 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffd88a] shadow-md border border-[#c58a3a]/40 transition-transform duration-200 ${
                          isSelected ? "scale-105" : "group-hover:scale-105"
                        }`}
                      >
                        {mode.icon}
                        <AnimatePresence>
                          {isSelected && (
                            <motion.span
                              initial={{ scale: 0, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              exit={{ scale: 0, opacity: 0 }}
                              transition={{ type: "spring", stiffness: 420, damping: 22 }}
                              className="absolute -top-1.5 -right-1.5 grid h-4.5 w-4.5 place-items-center rounded-full bg-emerald-600 text-white ring-2 ring-[#fffdf9] shadow-2xs"
                            >
                              <Check className="h-2.5 w-2.5 stroke-[3]" />
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className="font-black text-base text-[#2e1808]"
                            style={{ fontFamily: DISPLAY_FONT }}
                          >
                            {mode.name}
                          </span>
                          <span
                            className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${
                              isSelected
                                ? "bg-[#3a1f0a] text-[#ffd88a] border-[#c58a3a]/40"
                                : "bg-[#3a1f0a]/10 text-[#3a1f0a] border-[#7a4416]/20"
                            }`}
                          >
                            {mode.badge}
                          </span>
                        </div>

                        <p className="mt-0.5 text-xs font-medium text-[#6b3a12] truncate">
                          {mode.tagline}
                        </p>

                        <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:gap-2 text-[11px] font-semibold text-[#7a4416]">
                          <span className="inline-flex items-center gap-1 font-bold text-emerald-900 bg-emerald-500/15 px-2 py-0.5 rounded-full border border-emerald-500/30">
                            <Clock className="h-3 w-3 text-emerald-800" />
                            {mode.etaMinutes}m away
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#3a1f0a]/8 px-2 py-0.5 text-[#3a1f0a]">
                            <Users className="h-3 w-3 text-[#b8722c]" />
                            {mode.capacity}
                          </span>
                          <span
                            className="text-[10px] text-[#7a4416]/85"
                            style={{ fontFamily: MONO_FONT }}
                          >
                            • Drop {modeDropoff}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="relative z-10 text-right shrink-0 pl-2">
                      <p
                        className="text-lg sm:text-xl font-black text-[#2e1808] flex items-center justify-end"
                        style={{ fontFamily: MONO_FONT }}
                      >
                        <IndianRupee className="h-3.5 w-3.5 mr-0.5 text-[#b8722c]" />
                        {formatPaiseToRupee(calculatedFare)}
                      </p>
                      <p className="text-[10px] uppercase font-bold tracking-wider text-emerald-800">
                        All Inclusive
                      </p>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* Interactive Itemized Fare Breakdown Accordion */}
            <div className="rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9]/95 p-3.5 shadow-2xs">
              <button
                type="button"
                onClick={() => setShowBreakdown((prev) => !prev)}
                className="flex w-full items-center justify-between text-left focus:outline-none"
              >
                <div className="flex items-center gap-2 text-xs font-bold text-[#3a1f0a]">
                  <ShieldCheck className="h-4 w-4 text-emerald-700 shrink-0" />
                  <span>Upfront Fare Guarantee</span>
                  <span className="hidden sm:inline-block rounded-full bg-emerald-950/10 px-2 py-0.5 text-[10px] font-bold text-emerald-900">
                    Zero Hidden Fees
                  </span>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#b8722c] hover:text-[#3a1f0a] transition-colors">
                  <Receipt className="h-3.5 w-3.5" />
                  {showBreakdown ? "Hide Receipt" : "Audit Fare"}
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform duration-200 ${
                      showBreakdown ? "rotate-180" : ""
                    }`}
                  />
                </span>
              </button>

              <AnimatePresence initial={false}>
                {showBreakdown && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div
                      className="mt-3 pt-3 border-t border-[#7a4416]/15 space-y-1.5 text-xs text-[#6b3a12]"
                      style={{ fontFamily: MONO_FONT }}
                    >
                      <div className="flex justify-between">
                        <span>Base Flag-Down Fare</span>
                        <span className="font-bold text-[#2e1808]">
                          ₹{formatPaiseToRupee(rawBasePaise)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Distance ({distanceKm.toFixed(1)} km)</span>
                        <span className="font-bold text-[#2e1808]">
                          ₹{formatPaiseToRupee(rawDistancePaise)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Platform & Safety Fee</span>
                        <span className="font-bold text-[#2e1808]">
                          ₹{formatPaiseToRupee(rawPlatformFeePaise)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>{activeModeObj.name} Class Multiplier</span>
                        <span className="font-bold text-[#b8722c]">
                          ×{activeModeObj.multiplier}
                        </span>
                      </div>
                      <div className="flex justify-between pt-2 border-t border-dashed border-[#7a4416]/25 font-black text-[#2e1808] text-sm">
                        <span>Total Guaranteed Fare</span>
                        <span className="text-emerald-900">
                          ₹{formatPaiseToRupee(activeCalculatedFare)}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* CONFIRM & START RIDE CTA BUTTON */}
            <div className="pt-1 w-full">
              <Button
                onClick={handleConfirmAndStart}
                disabled={isCreatingRide}
                className="group relative w-full h-14 overflow-hidden rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-5 text-base font-bold text-[#ffe9be] shadow-[0_18px_40px_-12px_rgba(58,31,10,0.75),inset_0_1px_0_rgba(255,216,138,0.35)] transition-all hover:opacity-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-[#c58a3a]/45" />
                <span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-[#ffd88a]/40 to-transparent transition-transform duration-1000 group-hover:translate-x-[420%]" />

                {isCreatingRide ? (
                  <span className="relative z-10 flex items-center justify-center gap-2.5">
                    <Loader2 className="h-5 w-5 animate-spin text-[#ffd88a]" />
                    <span>Matching with nearby captains…</span>
                  </span>
                ) : (
                  <span className="relative z-10 flex w-full items-center justify-between">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-[#ffd88a]" />
                      <span>Confirm {activeModeObj.name}</span>
                    </span>

                    <AnimatePresence mode="popLayout">
                      <motion.span
                        key={activeCalculatedFare}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.18 }}
                        className="inline-flex items-center gap-1 rounded-xl bg-white/10 border border-[#ffd88a]/30 px-3 py-1 text-sm font-black text-[#ffd88a]"
                        style={{ fontFamily: MONO_FONT }}
                      >
                        ₹{formatPaiseToRupee(activeCalculatedFare)}
                        <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                      </motion.span>
                    </AnimatePresence>
                  </span>
                )}
              </Button>
            </div>

            {/* Brass Bottom Rail */}
            <div className="pointer-events-none absolute inset-x-8 bottom-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
          </motion.section>
        </motion.div>
      </div>
    </main>
  );
}