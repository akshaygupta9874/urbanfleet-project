import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  MapPin,
  Navigation,
  LogOut,
  History,
  Sparkles,
  ArrowRight,
  Locate,
  Loader2,
  Clock,
  Route as RouteIcon,
  Gem,
  Car
} from "lucide-react";
import LoadingScreen from "./components/LoadingScreen";
import { Input } from "./components/ui/input";
import { appApi } from "./lib/api";
import { useAuthContext } from "./context/auth-context";
import type { DriverProfile } from "./lib/driverApi";
import DriverCTA from "./components/DriverCTA";
import { searchPlaces, reverseGeocode } from "./services/geoapify.service";
import PinpointLocation from "./components/PinpointLocation";
import { getGeoapifyPoint, isGeoapifyFeatureCollection, type GeoapifyFeature } from "./types/geoapify";
import CityMapBackground from "./components/CityMapBackground";

type RideStatus =
  | "SEARCHING"
  | "DRIVER_ASSIGNED"
  | "DRIVER_ARRIVING"
  | "STARTED"
  | "COMPLETED"
  | "CANCELLED";

interface RidePoint {
  address: string;
  coordinates: { latitude: number; longitude: number };
}

interface Ride {
  _id: string;
  pickup: RidePoint;
  destination: RidePoint;
  fare: { estimated: number; final?: number | null };
  distance: { estimated: number | null };
  duration: { estimated: number | null };
  status: RideStatus;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, logout } = useAuthContext();
  const [driverProfile, setDriverProfile] = useState<DriverProfile | null>(null);
  const [isLoadingDriver, setIsLoadingDriver] = useState(true);

  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [rideError, setRideError] = useState("");

  const [pickup, setPickup] = useState("");
  const [destination, setDestination] = useState("");
  const [pickupCoords, setPickupCoords] =
    useState<{ latitude: number; longitude: number } | null>(null);
  const [destinationCoords, setDestinationCoords] =
    useState<{ latitude: number; longitude: number } | null>(null);

  const [pickupSuggestions, setPickupSuggestions] = useState<GeoapifyFeature[]>([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState<GeoapifyFeature[]>([]);
  const [activeField, setActiveField] = useState<"pickup" | "destination" | null>(null);

  const [isSearchingPickup, setIsSearchingPickup] = useState(false);
  const [isSearchingDestination, setIsSearchingDestination] = useState(false);

  const [routeDistance, setRouteDistance] = useState<number | null>(null);
  const [routeDuration, setRouteDuration] = useState<number | null>(null);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);

  const [isLocating, setIsLocating] = useState(false);

  // Map Modal States for Location Selection
  const [isPickupMapOpen, setIsPickupMapOpen] = useState(false);
  const [isDestinationMapOpen, setIsDestinationMapOpen] = useState(false);

  const formRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    async function loadDriver() {
      try {
        const res = await appApi.get("/driver/profile");
        setDriverProfile(res.data.data);
      } catch {
        setDriverProfile(null);
      } finally {
        setIsLoadingDriver(false);
      }
    }
    loadDriver();
  }, []);

  // Close suggestions dropdown when clicking outside the master card form
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (formRef.current && !formRef.current.contains(event.target as Node)) {
        setActiveField(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await appApi.get<{ message: string; ride: Ride }>("/ride/current");
        if (cancelled) return;
        const ride = response.data.ride;
        if (ride && ride.status !== "COMPLETED" && ride.status !== "CANCELLED") {
          navigate(`/ride/${ride._id}`, { replace: true });
          return;
        }
      } catch {
        // no active ride
      } finally {
        if (!cancelled) setIsBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (activeField === "pickup" && pickup.trim().length > 2) {
        setIsSearchingPickup(true);
        try {
          const features = await searchPlaces(pickup);
          setPickupSuggestions(features || []);
        } catch {
          setPickupSuggestions([]);
        } finally {
          setIsSearchingPickup(false);
        }
      } else {
        setIsSearchingPickup(false);
        setPickupSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [pickup, activeField]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (activeField === "destination" && destination.trim().length > 2) {
        setIsSearchingDestination(true);
        try {
          const features = await searchPlaces(destination);
          setDestinationSuggestions(features || []);
        } catch {
          setDestinationSuggestions([]);
        } finally {
          setIsSearchingDestination(false);
        }
      } else {
        setIsSearchingDestination(false);
        setDestinationSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [destination, activeField]);

  useEffect(() => {
    if (!pickupCoords || !destinationCoords) {
      return;
    }
    async function fetchRouteDetails() {
      setIsCalculatingRoute(true);
      try {
        const apiKey = import.meta.env.VITE_GEOAPIFY_API_KEY || "";
        const url = `https://api.geoapify.com/v1/routing?waypoints=${pickupCoords?.latitude},${pickupCoords?.longitude}|${destinationCoords?.latitude},${destinationCoords?.longitude}&mode=drive&apiKey=${apiKey}`;
        const response = await fetch(url);
        const data: unknown = await response.json();
        if (isGeoapifyFeatureCollection(data) && data.features.length > 0) {
          const feature = data.features[0];
          setRouteDistance(feature.properties.distance ?? null);
          setRouteDuration(feature.properties.time ?? null);
        }
      } catch (err) {
        console.error("Failed to fetch route details", err);
      } finally {
        setIsCalculatingRoute(false);
      }
    }
    fetchRouteDetails();
  }, [pickupCoords, destinationCoords]);

  const handleSelectPlace = (feature: GeoapifyFeature, type: "pickup" | "destination") => {
    const address = feature.properties.formatted || feature.properties.name || "Selected Location";
    const point = getGeoapifyPoint(feature);
    if (!point) return;
    const [longitude, latitude] = point;
    if (type === "pickup") {
      setPickup(address);
      setPickupCoords({ latitude, longitude });
      setPickupSuggestions([]);
      setIsSearchingPickup(false);
    } else {
      setDestination(address);
      setDestinationCoords({ latitude, longitude });
      setDestinationSuggestions([]);
      setIsSearchingDestination(false);
    }
    setActiveField(null);
  };

  const handleUseCurrentLocation = () => {
    setRideError("");
    if (!navigator.geolocation) {
      setRideError("Geolocation is not supported by this browser.");
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setPickupCoords({ latitude, longitude });
        const fallback = `Current location (${latitude.toFixed(3)}, ${longitude.toFixed(3)})`;

        (async () => {
          try {
            const address = await reverseGeocode(latitude, longitude);
            setPickup(address);
          } catch {
            setPickup(fallback);
          } finally {
            setIsLocating(false);
          }
        })();
      },
      (error) => {
        setRideError(`Unable to access location: ${error.message}`);
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const handleConfirmPickup = (confirmedAddress: string, coords: { latitude: number; longitude: number }) => {
    setPickup(confirmedAddress);
    setPickupCoords(coords);
    setIsPickupMapOpen(false);
  };

  const handleConfirmDestination = (confirmedAddress: string, coords: { latitude: number; longitude: number }) => {
    setDestination(confirmedAddress);
    setDestinationCoords(coords);
    setIsDestinationMapOpen(false);
  };

  const handleProceedToChoose = () => {
    if (!pickup.trim() || !destination.trim()) {
      setRideError("Please provide both pickup and destination details.");
      return;
    }
    if (!pickupCoords || !destinationCoords) {
      setRideError("Please select both pickup and destination from the suggestions.");
      return;
    }
    if (!user?._id) {
      setRideError("Unable to determine your profile. Please sign in again.");
      return;
    }
    setRideError("");

    const payload = {
      pickup,
      destination,
      pickupCoords,
      destinationCoords,
      routeDistance,
      routeDuration,
    };

    sessionStorage.setItem("pendingRide", JSON.stringify(payload));
    navigate("/choose");
  };

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      navigate("/login", { replace: true });
      setIsLoggingOut(false);
    }
  }

  if (isLoggingOut) {
    return <LoadingScreen sublabel="Signing you out..." />;
  }

  if (isBootstrapping) {
    return <LoadingScreen sublabel="Preparing your dashboard..." />;
  }

  const canProceed =
    Boolean(pickup) &&
    Boolean(destination) &&
    Boolean(pickupCoords) &&
    Boolean(destinationCoords) &&
    routeDistance !== null &&
    routeDuration !== null &&
    !isCalculatingRoute;

  const displayName = user?.firstName
    ? `${user.firstName} ${user.lastName ?? ""}`.trim()
    : "Rider";

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

      {/* Main Full-Width Content Container */}
      <div className="relative z-10 w-full px-4 sm:px-8 lg:px-12 py-6 space-y-6">
        {/* Header */}
        <header className="sticky top-4 z-50 w-full">
          <div className="w-full rounded-[2rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/90 via-[#fff4dc]/85 to-[#f7e2b8]/85 backdrop-blur-xl shadow-xl px-4 sm:px-8 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffd88a] shadow-md">
                <Car className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#7a4416] flex items-center gap-1.5">
                  <Gem className="h-3 w-3 text-[#b8722c]" />
                  Urban Fleet
                </p>
                <p className="text-sm font-semibold text-[#2e1808]">
                  Welcome back, <span className="font-bold text-[#3a1f0a]">{displayName.split(" ")[0]}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                onClick={() => navigate("/history")}
                className="group relative grid h-10 w-10 place-items-center rounded-xl border border-[#7a4416]/25 bg-[#fffaf0] text-[#3a1f0a] shadow-sm hover:bg-[#fff4dc] active:scale-95 transition-all"
                aria-label="History"
              >
                <History className="h-4 w-4 text-[#b8722c] transition-colors group-hover:text-[#3a1f0a]" />
              </button>
              <button
                onClick={handleLogout}
                className="group relative grid h-10 w-10 place-items-center rounded-xl border border-rose-500/30 bg-rose-950/20 text-rose-900 shadow-sm hover:bg-rose-950/30 active:scale-95 transition-all"
                aria-label="Log out"
              >
                <LogOut className="h-4 w-4 text-rose-800 transition-colors group-hover:text-rose-950" />
              </button>
            </div>
          </div>
        </header>

        {/* UNIFIED MASTER TICKET CARD — FULL SCREEN WIDTH */}
        <section
          ref={formRef}
          className="relative w-full overflow-hidden rounded-[2.5rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-6 sm:p-10 shadow-2xl backdrop-blur-2xl"
        >
          {/* Perforation ticket-edge dots */}
          <div className="pointer-events-none absolute left-0 top-1/2 hidden sm:flex -translate-x-1/2 -translate-y-1/2 flex-col gap-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <span key={`pl-${i}`} className="h-2.5 w-2.5 rounded-full bg-[#f5e6c8] shadow-inner" />
            ))}
          </div>
          <div className="pointer-events-none absolute right-0 top-1/2 hidden sm:flex translate-x-1/2 -translate-y-1/2 flex-col gap-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <span key={`pr-${i}`} className="h-2.5 w-2.5 rounded-full bg-[#f5e6c8] shadow-inner" />
            ))}
          </div>

          {/* Brass top rail */}
          <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

          {/* Hero greeting & Title inside the card */}
          <div className="mb-6 text-center sm:text-left">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#3a1f0a] to-[#7a4416] px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-[#ffd88a] shadow-[0_8px_20px_-8px_rgba(58,31,10,0.6)]">
              <Sparkles size={13} />
              Where are we heading today?
            </div>
            <h1 className="console-display text-3xl sm:text-5xl font-bold tracking-tight text-[#2e1808]">
              Book a ride in{" "}
              <span className="italic bg-gradient-to-br from-[#2e1808] via-[#6b3a12] to-[#b8722c] bg-clip-text text-transparent">
                seconds.
              </span>
            </h1>
          </div>

          {/* Ticket perforation divider */}
          <div className="relative my-6 flex items-center gap-3">
            <span className="h-6 w-6 -translate-x-1/2 rounded-full bg-[#f5e6c8] shadow-[inset_0_2px_4px_rgba(122,68,22,0.2)]" />
            <div
              className="h-px flex-1"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(90deg, #7a4416 0 8px, transparent 8px 16px)",
                opacity: 0.4,
              }}
            />
            <span className="h-6 w-6 translate-x-1/2 rounded-full bg-[#f5e6c8] shadow-[inset_0_2px_4px_rgba(122,68,22,0.2)]" />
          </div>

          <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#7a4416]">
            Route Specifications
          </div>

          {/* Route Fields */}
          <div className="relative space-y-4 w-full">
            {/* connecting line */}
            <div className="pointer-events-none absolute left-[22px] top-[36px] h-[calc(100%-72px)] w-[2px] bg-[#b8722c]/40" />

            {/* Pickup */}
            <div className="relative w-full">
              <FieldRow
                icon={<Dot color="dark" />}
                trailing={
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleUseCurrentLocation}
                      title="Use current location"
                      className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] text-[#ffd88a] shadow-sm hover:opacity-90 active:scale-95 transition-all"
                    >
                      {isLocating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Locate className="h-4 w-4" />}
                    </button>
                    {pickupCoords && (
                      <button
                        type="button"
                        onClick={() => setIsPickupMapOpen(true)}
                        title="Choose location on map"
                        className="grid h-9 w-9 place-items-center rounded-xl border border-[#7a4416]/25 bg-[#fffaf0] text-[#3a1f0a] shadow-sm hover:bg-[#fff4dc] active:scale-95 transition-all"
                      >
                        <MapPin className="h-4 w-4 text-[#b8722c]" />
                      </button>
                    )}
                  </div>
                }
                label="Pickup Location"
                value={pickup}
                placeholder="Where from?"
                onChange={(v) => {
                  setPickup(v);
                  setActiveField("pickup");
                  setPickupCoords(null);
                  setRouteDistance(null);
                  setRouteDuration(null);
                }}
                onFocus={() => setActiveField("pickup")}
              />
              {activeField === "pickup" && pickup.trim().length > 2 && (
                <div className="rd-scroll-fade absolute left-11 right-0 top-full z-30 mt-2 max-h-64 overflow-y-auto rounded-2xl border border-[#7a4416]/25 bg-[#fffaf0] p-1 shadow-[0_20px_50px_-20px_rgba(80,40,10,0.4)] backdrop-blur-md">
                  {isSearchingPickup ? (
                    <div className="flex items-center justify-center gap-2 py-4 text-xs text-[#7a4416]">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Searching places...
                    </div>
                  ) : pickupSuggestions.length > 0 ? (
                    pickupSuggestions.map((item, idx) => (
                      <div
                        key={idx}
                        onClick={() => handleSelectPlace(item, "pickup")}
                        className="flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium text-[#2e1808] hover:bg-[#fff4dc] transition-colors"
                      >
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-[#b8722c]" />
                        <span className="truncate">
                          {item.properties?.formatted || item.properties?.name}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="py-4 text-center text-xs text-[#7a4416]/70">
                      No locations found
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Destination */}
            <div className="relative w-full">
              <FieldRow
                icon={<Dot color="brass" />}
                trailing={
                  <div className="flex items-center gap-1.5">
                    {destinationCoords && (
                      <button
                        type="button"
                        onClick={() => setIsDestinationMapOpen(true)}
                        title="Choose location on map"
                        className="grid h-9 w-9 place-items-center rounded-xl border border-[#7a4416]/25 bg-[#fffaf0] text-[#3a1f0a] shadow-sm hover:bg-[#fff4dc] active:scale-95 transition-all"
                      >
                        <MapPin className="h-4 w-4 text-[#b8722c]" />
                      </button>
                    )}
                    <div className="grid h-9 w-9 place-items-center text-[#7a4416]">
                      <Navigation className="h-4 w-4 text-[#b8722c]" />
                    </div>
                  </div>
                }
                label="Destination"
                value={destination}
                placeholder="Where to?"
                onChange={(v) => {
                  setDestination(v);
                  setActiveField("destination");
                  setDestinationCoords(null);
                  setRouteDistance(null);
                  setRouteDuration(null);
                }}
                onFocus={() => setActiveField("destination")}
              />
              {activeField === "destination" && destination.trim().length > 2 && (
                <div className="rd-scroll-fade absolute left-11 right-0 top-full z-30 mt-2 max-h-64 overflow-y-auto rounded-2xl border border-[#7a4416]/25 bg-[#fffaf0] p-1 shadow-[0_20px_50px_-20px_rgba(80,40,10,0.4)] backdrop-blur-md">
                  {isSearchingDestination ? (
                    <div className="flex items-center justify-center gap-2 py-4 text-xs text-[#7a4416]">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Searching places...
                    </div>
                  ) : destinationSuggestions.length > 0 ? (
                    destinationSuggestions.map((item, idx) => (
                      <div
                        key={idx}
                        onClick={() => handleSelectPlace(item, "destination")}
                        className="flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium text-[#2e1808] hover:bg-[#fff4dc] transition-colors"
                      >
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-[#b8722c]" />
                        <span className="truncate">
                          {item.properties?.formatted || item.properties?.name}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="py-4 text-center text-xs text-[#7a4416]/70">
                      No locations found
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Bottom Dispatch & Route Metrics Bar inside Master Card */}
          <div className="mt-8 pt-6 border-t border-[#7a4416]/20 flex flex-col sm:flex-row items-center justify-between gap-4 w-full">
            {(routeDistance !== null || isCalculatingRoute) ? (
              <div className="flex items-center gap-3 rounded-full border border-[#7a4416]/20 bg-[#fffaf0]/90 px-5 py-2.5 text-xs font-medium text-[#3a1f0a] shadow-sm console-readout">
                {isCalculatingRoute ? (
                  <div className="flex items-center gap-2 text-[#7a4416]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Calculating route…
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5">
                      <RouteIcon className="h-3.5 w-3.5 text-[#b8722c]" />
                      <span className="tabular-nums font-semibold">
                        {routeDistance ? `${(routeDistance / 1000).toFixed(1)} km` : ""}
                      </span>
                    </div>
                    <span className="h-3 w-px bg-[#7a4416]/30" />
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-[#b8722c]" />
                      <span className="tabular-nums font-semibold">
                        {routeDuration ? `${Math.round(routeDuration / 60)} mins` : ""}
                      </span>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="text-xs font-medium text-[#7a4416]/80">
                Select pickup & destination to estimate fare & time.
              </div>
            )}

            <button
              onClick={handleProceedToChoose}
              disabled={!canProceed}
              className="group relative w-full sm:w-auto inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-8 py-4 text-base font-semibold text-[#ffe9be] shadow-[0_18px_40px_-12px_rgba(58,31,10,0.7),inset_0_1px_0_rgba(255,216,138,0.35)] hover:opacity-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 transition-all"
            >
              <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-[#c58a3a]/40" />
              <span className="relative z-10 inline-flex items-center gap-2">
                Choose vehicle
                <ArrowRight className="h-4 w-4 text-[#ffd88a]" />
              </span>
            </button>
          </div>

          {/* Inline error */}
          {rideError && (
            <p className="mt-4 rounded-xl border border-rose-500/30 bg-rose-950/20 px-4 py-3 text-xs font-medium text-rose-900 shadow-sm w-full">
              {rideError}
            </p>
          )}

          {/* Brass bottom rail */}
          <div className="pointer-events-none absolute inset-x-8 bottom-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
        </section>

        {/* Driver CTA Section — FULL WIDTH */}
        <div className="w-full">
          <DriverCTA
            driver={driverProfile}
            loading={isLoadingDriver}
          />
        </div>
      </div>

      {/* Pinpoint Map Modals */}
      <PinpointLocation
        isOpen={isPickupMapOpen}
        onClose={() => setIsPickupMapOpen(false)}
        initialCoords={pickupCoords}
        onConfirm={handleConfirmPickup}
        reverseGeocodeFn={reverseGeocode}
        title="Set pickup location"
      />
      <PinpointLocation
        isOpen={isDestinationMapOpen}
        onClose={() => setIsDestinationMapOpen(false)}
        initialCoords={destinationCoords}
        onConfirm={handleConfirmDestination}
        reverseGeocodeFn={reverseGeocode}
        title="Set dropoff location"
      />
    </div>
  );
}

/* ---------- helpers ---------- */

function Dot({ color }: { color: "dark" | "brass" }) {
  if (color === "brass") {
    return (
      <span className="relative grid h-6 w-6 place-items-center">
        <span className="absolute inset-0 rounded-md bg-[#b8722c]/20" />
        <span className="h-3 w-3 rounded-[3px] bg-gradient-to-br from-[#7a4416] to-[#b8722c] shadow-sm" />
      </span>
    );
  }
  return (
    <span className="relative grid h-6 w-6 place-items-center">
      <span className="absolute inset-0 rounded-full bg-[#3a1f0a]/20" />
      <span className="h-3 w-3 rounded-full bg-[#3a1f0a] ring-2 ring-[#fffaf0] shadow-sm" />
    </span>
  );
}

function FieldRow({
  icon,
  trailing,
  label,
  value,
  placeholder,
  onChange,
  onFocus,
}: {
  icon: React.ReactNode;
  trailing: React.ReactNode;
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  onFocus: () => void;
}) {
  return (
    <label className="w-full flex items-center gap-3 rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/95 px-4 py-3 transition-all duration-300 focus-within:border-transparent focus-within:ring-2 focus-within:ring-[#b8722c] focus-within:shadow-[0_0_0_4px_rgba(184,114,44,0.15)] shadow-sm">
      <span className="shrink-0">{icon}</span>
      <span className="flex flex-1 flex-col">
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#7a4416]">
          {label}
        </span>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          placeholder={placeholder}
          className="h-10 border-0 bg-transparent px-0 text-base text-[#2e1808] placeholder:text-[#7a4416]/45 focus-visible:ring-0 shadow-none outline-none w-full"
        />
      </span>
      <span className="shrink-0">{trailing}</span>
    </label>
  );
}