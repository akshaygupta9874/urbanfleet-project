import MapView from "./components/MapView";
import { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
  Receipt,
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
  description: string;
  capacity: string;
  badge: string;
  icon: React.ReactNode;
  multiplier: number;
  etaMinutes: number;
}

const RIDE_MODES: RideModeOption[] = [
  {
    id: "bike",
    name: "Moto / Bike",
    description: "Fastest through traffic",
    capacity: "1 Rider",
    badge: "Express",
    icon: <Bike className="h-5 w-5 text-[#ffd88a]" />,
    multiplier: 0.7,
    etaMinutes: 3,
  },
  {
    id: "auto",
    name: "Auto Rickshaw",
    description: "Affordable local ride",
    capacity: "3 Seats",
    badge: "Value",
    icon: <Sparkles className="h-5 w-5 text-[#ffd88a]" />,
    multiplier: 0.9,
    etaMinutes: 5,
  },
  {
    id: "car",
    name: "Comfort Car",
    description: "Spacious & air-conditioned",
    capacity: "4 Seats",
    badge: "AC Prime",
    icon: <Car className="h-5 w-5 text-[#ffd88a]" />,
    multiplier: 1.2,
    etaMinutes: 7,
  },
];

const DISPLAY_FONT = "'Fraunces', Georgia, serif";
const BODY_FONT = "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif";
const MONO_FONT = "'JetBrains Mono', ui-monospace, 'SF Mono', monospace";

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 0. If user is strictly a driver without RIDER role, redirect immediately to driver dashboard
        if (user?.roles?.includes("DRIVER") && !user?.roles?.includes("RIDER")) {
          navigate("/driver-dashboard", { replace: true });
          return;
        }

        if (user?.roles?.includes("DRIVER")) {
          const driverRes = await appApi
            .get<{ success: boolean; data: { status?: string; id?: string; driverId?: string } }>("/ride/driver/current")
            .catch(() => null);
          if (cancelled) return;
          const driverRide = driverRes?.data?.data;
          if (
            driverRide &&
            ["DRIVER_ASSIGNED", "DRIVER_ARRIVING", "RIDE_STARTED", "ARRIVED_AT_DESTINATION"].includes(
              driverRide.status || ""
            )
          ) {
            navigate("/driver-dashboard", { replace: true });
            return;
          }
        }

        if (user?.roles?.includes("RIDER")) {
          const riderRes = await appApi
            .get<{ success: boolean; data: { status?: string; id?: string; riderId?: string } }>("/ride/current")
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
      const response = await appApi.post<{ success: boolean; data: { id: string } }>("/ride", {
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
        <div className="relative z-10 w-full max-w-lg rounded-[2.5rem] border border-[#fff4dc]/80 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-8 shadow-2xl backdrop-blur-2xl">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffd88a] shadow-md">
            <Car className="h-6 w-6" />
          </div>
          <p
            className="text-xl font-bold text-[#2e1808]"
            style={{ fontFamily: DISPLAY_FONT }}
          >
            No route details found. Please start over.
          </p>
          <p className="mt-2 text-xs font-medium text-[#6b3a12]">
            Select your pickup and drop-off points on the dashboard to view vehicle classes.
          </p>
          <Button
            className="mt-6 rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-6 py-3 font-semibold text-[#ffe9be] shadow-lg transition hover:scale-105"
            onClick={() => navigate("/dashboard")}
          >
            Back to dashboard
          </Button>
        </div>
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

      <div className="relative z-10 mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-10 py-5 space-y-6">
        {/* Sticky Top Command Header */}
        <header className="sticky top-3 z-40 w-full">
          <div className="w-full rounded-[1.75rem] border border-[#fff4dc]/80 bg-gradient-to-r from-[#fffdf9]/95 via-[#fff5e0]/90 to-[#f7e2b8]/90 backdrop-blur-2xl shadow-[0_12px_32px_-8px_rgba(46,24,8,0.16)] px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleBackToModify}
              className="flex items-center gap-2 h-11 px-4 rounded-2xl border border-[#7a4416]/25 bg-[#fffaf0] text-xs font-bold text-[#3a1f0a] shadow-2xs transition hover:bg-[#fff4dc] tap-tactile active:scale-95"
              aria-label="Back to Dashboard"
            >
              <ArrowLeft className="h-4 w-4 text-[#b8722c]" />
              <span>Modify Route</span>
            </button>

            <div className="flex items-center gap-2">
              <Gem className="h-4 w-4 text-[#b8722c] hidden sm:inline" />
              <span className="text-xs font-black uppercase tracking-[0.22em] text-[#3a1f0a]">
                UrbanFleet Dispatch • Step 2 of 2
              </span>
            </div>

            <div
              className="hidden sm:flex items-center gap-2.5 rounded-full border border-[#c58a3a]/40 bg-[#fffdf9] px-4 py-1.5 text-xs font-bold text-[#3a1f0a] shadow-2xs"
              style={{ fontFamily: MONO_FONT }}
            >
              <RouteIcon className="h-3.5 w-3.5 text-[#b8722c]" />
              <span>{distanceKm.toFixed(1)} km</span>
              <span className="text-[#7a4416]/40">•</span>
              <Clock className="h-3.5 w-3.5 text-[#b8722c]" />
              <span>~{durationMinutes} min</span>
            </div>
          </div>
        </header>

        {/* Responsive 12-Column Split-Screen Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start w-full">
          {/* LEFT COLUMN (lg:col-span-7): Interactive Route Map & Live Corridor HUD */}
          <section className="lg:col-span-7 flex flex-col w-full">
            <div className="relative h-[320px] sm:h-[440px] lg:h-[680px] w-full overflow-hidden rounded-[2.5rem] border border-[#fff4dc]/80 shadow-2xl bg-[#fffaf0]">
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

              {/* Top Floating Telemetry Pill */}
              <div className="pointer-events-none absolute top-4 left-4 right-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 rounded-2xl border border-[#fff4dc]/70 bg-[#fffdf9]/95 px-4 py-2.5 text-xs font-bold text-[#2e1808] shadow-xl backdrop-blur-md">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Route Locked</span>
                  <span className="text-[#7a4416]/40">•</span>
                  <span style={{ fontFamily: MONO_FONT }}>
                    Est. Arrival {estimatedDropoffTime}
                  </span>
                </div>
              </div>

              {/* Bottom Floating Map Legend */}
              <div className="pointer-events-none absolute bottom-4 left-4 right-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-4 rounded-xl border border-[#fff4dc]/60 bg-[#2e1808]/90 px-4 py-2 text-[11px] font-semibold text-[#ffe9be] shadow-lg backdrop-blur-md">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" /> P: Pickup
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-amber-400" /> D: Destination
                  </span>
                  <span className="hidden sm:inline text-[#ffd88a]/70">|</span>
                  <span
                    className="hidden sm:inline text-[#ffd88a]"
                    style={{ fontFamily: MONO_FONT }}
                  >
                    {distanceKm.toFixed(2)} km total
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* RIGHT COLUMN (lg:col-span-5): Luxury Perforated Dispatch Ticket */}
          <section className="lg:col-span-5 relative overflow-hidden rounded-[2.5rem] border border-[#fff4dc]/80 bg-gradient-to-b from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-6 sm:p-8 shadow-2xl backdrop-blur-2xl w-full space-y-5">
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
            <div className="relative overflow-hidden rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9] p-4 shadow-xs w-full">
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
                    <span className="absolute h-5 w-5 rounded-full bg-[#3a1f0a]/20" />
                    <span className="relative h-2.5 w-2.5 rounded-full bg-[#3a1f0a]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#7a4416]">
                      Pickup
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
                      Drop-Off
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
            {bookingError && (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-500/40 bg-rose-950/15 p-3.5 text-xs font-semibold text-rose-950 shadow-xs">
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
              </div>
            )}

            {/* THREE VEHICLE MODE OPTIONS (BIKE, AUTO, CAR) */}
            <div className="space-y-3 w-full">
              {RIDE_MODES.map((mode) => {
                const isSelected = selectedMode === mode.id;
                const calculatedFare = Math.round(baseFareValue * mode.multiplier);
                const modeDropoff = new Date(
                  baseTimestamp + (mode.etaMinutes + durationMinutes) * 60_000
                ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

                return (
                  <div
                    key={mode.id}
                    onClick={() => setSelectedMode(mode.id)}
                    className={`group w-full flex cursor-pointer items-center justify-between rounded-2xl border p-4 transition-all duration-200 tap-tactile active:scale-[0.98] ${
                      isSelected
                        ? "border-2 border-[#3a1f0a] bg-gradient-to-r from-[#fffdf9] via-[#fff8eb] to-[#fcf0d5] shadow-lg ring-2 ring-[#b8722c]/25"
                        : "border-[#7a4416]/20 bg-[#fffaf0]/85 hover:bg-[#fffaf0] hover:border-[#b8722c]/60"
                    }`}
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="relative grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffd88a] shadow-sm border border-[#c58a3a]/40 transition-transform group-hover:scale-105">
                        {mode.icon}
                        {isSelected && (
                          <span className="absolute -top-1.5 -right-1.5 grid h-4 w-4 place-items-center rounded-full bg-emerald-600 text-white ring-2 ring-[#fffaf0]">
                            <Check className="h-2.5 w-2.5" />
                          </span>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className="font-bold text-base text-[#2e1808]"
                            style={{ fontFamily: DISPLAY_FONT }}
                          >
                            {mode.name}
                          </span>
                          <span className="rounded-md bg-[#3a1f0a]/10 border border-[#7a4416]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#3a1f0a]">
                            {mode.badge}
                          </span>
                        </div>

                        <p className="mt-0.5 text-xs font-medium text-[#6b3a12]">
                          {mode.description}
                        </p>

                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-[#7a4416]">
                          <span className="flex items-center gap-1 font-semibold text-emerald-900 bg-emerald-500/15 px-2 py-0.5 rounded-full border border-emerald-500/30">
                            <Clock className="h-3 w-3 text-emerald-800" />
                            {mode.etaMinutes} mins away
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#3a1f0a]/5 px-2 py-0.5 text-[#3a1f0a]">
                            <Users className="h-3 w-3 text-[#b8722c]" />
                            {mode.capacity}
                          </span>
                          <span
                            className="text-[10px] text-[#7a4416]/80"
                            style={{ fontFamily: MONO_FONT }}
                          >
                            • Drop {modeDropoff}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0 pl-2">
                      <p
                        className="text-lg font-extrabold text-[#2e1808] flex items-center justify-end"
                        style={{ fontFamily: MONO_FONT }}
                      >
                        <IndianRupee className="h-3.5 w-3.5 mr-0.5 text-[#b8722c]" />
                        {formatPaiseToRupee(calculatedFare)}
                      </p>
                      <p className="text-[10px] uppercase font-bold tracking-wider text-[#7a4416]">
                        Estimated
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Interactive Itemized Fare Breakdown Toggle */}
            <div className="rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9]/90 p-3.5 shadow-2xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-[#3a1f0a]">
                  <ShieldCheck className="h-4 w-4 text-emerald-700 shrink-0" />
                  <span>Upfront Fare Guarantee</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowBreakdown((prev) => !prev)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-[#b8722c] hover:text-[#3a1f0a] transition-colors"
                >
                  <Receipt className="h-3.5 w-3.5" />
                  {showBreakdown ? "Hide Breakdown" : "View Breakdown"}
                </button>
              </div>

              {showBreakdown && (
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
                  <div className="flex justify-between pt-1.5 border-t border-dashed border-[#7a4416]/25 font-black text-[#2e1808]">
                    <span>Total Estimated Fare</span>
                    <span>₹{formatPaiseToRupee(activeCalculatedFare)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* CONFIRM & START RIDE BUTTON */}
            <div className="pt-1 w-full">
              <Button
                onClick={handleConfirmAndStart}
                disabled={isCreatingRide}
                className="group relative w-full h-14 overflow-hidden rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-base font-bold text-[#ffe9be] shadow-[0_18px_40px_-12px_rgba(58,31,10,0.7),inset_0_1px_0_rgba(255,216,138,0.35)] transition-all hover:opacity-95 tap-tactile active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-[#c58a3a]/40" />
                <span className="relative z-10 flex items-center justify-center gap-2">
                  {isCreatingRide ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin text-[#ffd88a]" />
                      <span>Matching with drivers...</span>
                    </>
                  ) : (
                    <>
                      <span>
                        Confirm {activeModeObj.name} • ₹{formatPaiseToRupee(activeCalculatedFare)}
                      </span>
                      <ChevronRight className="h-5 w-5 text-[#ffd88a] transition-transform group-hover:translate-x-1" />
                    </>
                  )}
                </span>
              </Button>
            </div>

            {/* Brass Bottom Rail */}
            <div className="pointer-events-none absolute inset-x-8 bottom-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
          </section>
        </div>
      </div>
    </main>
  );
}