import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Car,
  MapPin,
  Navigation,
  LogOut,
  History,
  Sparkles,
  ArrowRight,
  ArrowUpDown,
  Locate,
  Loader2,
  Clock,
  Route as RouteIcon,
  Gem,
  ShieldCheck,
  X,
  CheckCircle2,
  Compass,
} from "lucide-react";
import LoadingScreen from "./components/LoadingScreen";
import { Input } from "./components/ui/input";
import { appApi } from "./lib/api";
import { useAuthContext } from "./context/auth-context";
import { searchPlaces, reverseGeocode } from "./services/geoapify.service";
import PinpointLocation from "./components/PinpointLocation";
import {
  getGeoapifyPoint,
  isGeoapifyFeatureCollection,
  type GeoapifyFeature,
} from "./types/geoapify";
import CityMapBackground from "./components/CityMapBackground";
import { formatDistance, formatDuration } from "./lib/formatters";
import RiderHistoryPanel from "./components/RiderHistoryPanel";
import ActiveSessions from "./ActiveSessions";
import type { Coordinates } from "./types/location";
import type { RideDto as Ride } from "./types/ride";

type PassengerTab = "console" | "history" | "sessions";

const PASSENGER_TABS: Array<{
  id: PassengerTab;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: "console",
    label: "Book Ride & Live Console",
    shortLabel: "Book Ride",
    icon: Navigation,
  },
  {
    id: "history",
    label: "Ride History & Receipts",
    shortLabel: "Ride History",
    icon: History,
  },
  {
    id: "sessions",
    label: "Active Sessions & Security",
    shortLabel: "Security",
    icon: ShieldCheck,
  },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, logout } = useAuthContext();

  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [rideError, setRideError] = useState("");

  // Top-level Console Tab & Right-Dock Switcher
  const [activeTab, setActiveTab] = useState<PassengerTab>("console");
  const [rightDockTab, setRightDockTab] = useState<"history" | "sessions">("history");

  // Lazy-mount flags so full-width tabs mount on first visit and stay warm without reloading
  const [visitedTabs, setVisitedTabs] = useState<Record<PassengerTab, boolean>>({
    console: true,
    history: false,
    sessions: false,
  });

  const handleSelectTab = (tab: PassengerTab) => {
    setVisitedTabs((prev) => (prev[tab] ? prev : { ...prev, [tab]: true }));
    setActiveTab(tab);
  };

  const [pickup, setPickup] = useState("");
  const [destination, setDestination] = useState("");
  const [pickupCoords, setPickupCoords] = useState<Coordinates | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<Coordinates | null>(null);

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
  const location = useLocation();

  // Prefill pickup and destination when Re-booking from Ride History
  useEffect(() => {
    const state = location.state as {
      prefillPickup?: string;
      prefillDestination?: string;
    } | null;
    if (state?.prefillPickup || state?.prefillDestination) {
      queueMicrotask(() => {
        if (state.prefillPickup) setPickup(state.prefillPickup);
        if (state.prefillDestination) setDestination(state.prefillDestination);
      });
    }
  }, [location.state]);

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
        // 0. If user is strictly a driver without RIDER role, redirect immediately to driver dashboard
        if (user?.roles?.includes("DRIVER") && !user?.roles?.includes("RIDER")) {
          navigate("/driver-dashboard", { replace: true });
          return;
        }

        // 1. If user is a driver, check if they are actively on a driving assignment
        if (user?.roles?.includes("DRIVER")) {
          const driverRes = await appApi
            .get<{ success: boolean; data: Ride }>("/rides/driver/current")
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
            ].includes(driverRide.status)
          ) {
            navigate("/driver-dashboard", { replace: true });
            return;
          }
        }

        // 2. Check if user has an active ride as a passenger/rider
        if (user?.roles?.includes("RIDER")) {
          const response = await appApi.get<{ success: boolean; data: Ride }>("/rides/current");
          if (cancelled) return;
          const ride = response.data?.data;
          if (
            ride &&
            ride.riderId === user?.id &&
            ride.status !== "COMPLETED" &&
            ride.status !== "CANCELLED"
          ) {
            navigate(`/ride/${ride.id}`, { replace: true });
            return;
          }
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
  }, [navigate, user?.id, user?.roles]);

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

  const handleSwapLocations = () => {
    setPickup(destination);
    setDestination(pickup);
    setPickupCoords(destinationCoords);
    setDestinationCoords(pickupCoords);
    setActiveField(null);
  };

  const handleInstantRebook = (
    rebookPickup: string,
    rebookDestination: string,
    rebookPickupCoords?: Coordinates,
    rebookDestinationCoords?: Coordinates
  ) => {
    setPickup(rebookPickup);
    setDestination(rebookDestination);
    if (rebookPickupCoords) setPickupCoords(rebookPickupCoords);
    if (rebookDestinationCoords) setDestinationCoords(rebookDestinationCoords);
    handleSelectTab("console");
    window.scrollTo({ top: 0, behavior: "smooth" });
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
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleConfirmPickup = (confirmedAddress: string, coords: Coordinates) => {
    setPickup(confirmedAddress);
    setPickupCoords(coords);
    setIsPickupMapOpen(false);
  };

  const handleConfirmDestination = (confirmedAddress: string, coords: Coordinates) => {
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
    if (!user?.id) {
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

    navigate("/choose", { state: { pendingRide: payload } });
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

        @keyframes uf-shimmer {
          100% { transform: translateX(200%); }
        }
        .uf-skeleton-shimmer {
          animation: uf-shimmer 1.8s infinite ease-in-out;
        }
      `}</style>

      {/* Main Full-Width Content Container */}
      <div className="relative z-10 mx-auto w-full max-w-[1600px] px-3.5 sm:px-6 lg:px-10 py-4 sm:py-5 space-y-5 sm:space-y-6">
        {/* Sticky Top Command Header — Cleanly Aligned on Mobile & Desktop */}
        <header className="sticky top-2.5 z-40 w-full">
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="w-full rounded-[1.5rem] sm:rounded-[1.75rem] border border-[#fff4dc]/85 bg-gradient-to-r from-[#fffdf9]/95 via-[#fff5e0]/92 to-[#f7e2b8]/92 backdrop-blur-2xl shadow-[0_12px_32px_-8px_rgba(46,24,8,0.16)] px-3.5 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0">
              <div className="relative flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-xl sm:rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#241205] text-[#ffd88a] shadow-md ring-1 ring-[#c58a3a]/50">
                <Car className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#fffaf0] bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] sm:tracking-[0.24em] text-[#7a4416] flex items-center gap-1">
                  <Gem className="h-3 w-3 text-[#b8722c] shrink-0" />
                  <span>UrbanFleet Passenger</span>
                </p>
                <p className="truncate text-xs sm:text-sm font-bold text-[#2e1808]">
                  Welcome back,{" "}
                  <span className="text-[#3a1f0a]">{displayName.split(" ")[0]}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleSelectTab("console")}
                className={`hidden md:flex items-center gap-1.5 h-9 sm:h-10 px-3.5 rounded-xl border text-xs font-bold transition-all active:scale-95 ${
                  activeTab === "console"
                    ? "border-[#c58a3a] bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] text-[#ffd88a] shadow-sm"
                    : "border-[#7a4416]/25 bg-[#fffaf0] text-[#3a1f0a] hover:bg-[#fff4dc]"
                }`}
              >
                <Compass className="h-3.5 w-3.5 text-[#ffd88a]" />
                <span>Dispatch</span>
              </button>

              {/* Dual-role switch button (only if user has both DRIVER and RIDER roles) */}
              {user?.roles?.includes("DRIVER") && (
                <button
                  type="button"
                  onClick={() => navigate("/driver-dashboard")}
                  className="flex items-center gap-1.5 h-9 sm:h-10 px-2.5 sm:px-3.5 rounded-xl border border-[#c58a3a]/40 bg-[#fffaf0] text-[#3a1f0a] hover:bg-[#fff4dc] active:scale-95 transition-all text-xs font-bold shadow-2xs"
                  title="Switch to Driver Dashboard"
                >
                  <Car className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-[#b8722c] shrink-0" />
                  <span className="hidden sm:inline">Driver Dashboard</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleLogout}
                className="group relative flex items-center justify-center gap-1.5 h-9 sm:h-10 px-2.5 sm:px-3.5 rounded-xl border border-rose-500/30 bg-rose-950/15 text-rose-900 shadow-2xs hover:bg-rose-950/25 active:scale-95 transition-all text-xs font-bold"
                aria-label="Log out"
                title="Sign out"
              >
                <LogOut className="h-4 w-4 text-rose-800 transition-colors group-hover:text-rose-950 shrink-0" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          </motion.div>
        </header>

        {/* Responsive Segmented Navigation Bar — 3-Column Mobile Grid / Flex Desktop Bar */}
        <section className="w-full">
          <div className="grid grid-cols-3 sm:flex sm:items-center gap-1.5 sm:gap-2 rounded-2xl border border-[#fff4dc]/85 bg-[#fffaf0]/85 p-1.5 shadow-md backdrop-blur-xl">
            {PASSENGER_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const TabIcon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleSelectTab(tab.id)}
                  className={`relative flex items-center justify-center sm:justify-start gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2.5 rounded-xl text-[11px] sm:text-xs font-bold transition-colors ${
                    isActive
                      ? "text-[#ffe9be]"
                      : "text-[#6b3a12] hover:bg-[#fff4dc]/80 hover:text-[#2e1808]"
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="riderMainTab"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] shadow-md ring-1 ring-[#c58a3a]/50"
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-1.5 sm:gap-2 truncate">
                    <TabIcon
                      className={`h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 ${
                        isActive ? "text-[#ffd88a]" : "text-[#b8722c]"
                      }`}
                    />
                    <span className="sm:hidden truncate">{tab.shortLabel}</span>
                    <span className="hidden sm:inline truncate">{tab.label}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* LOCKED-HEIGHT TAB WORKSPACE: Prevents height collapse, scroll jumps & remount reloads */}
        <div className="relative w-full min-h-[640px]">
          {/* TAB 1: SPLIT-SCREEN DISPATCH CONSOLE (Kept warm in DOM) */}
          <div
            className={
              activeTab === "console"
                ? "grid grid-cols-1 xl:grid-cols-12 gap-6 items-start animate-in fade-in duration-200"
                : "hidden"
            }
          >
            {/* LEFT COLUMN (xl:col-span-7): Master Ticket Booking Card */}
            <section
              ref={formRef}
              className="xl:col-span-7 relative w-full overflow-hidden rounded-[2.25rem] sm:rounded-[2.5rem] border border-[#fff4dc]/85 bg-gradient-to-b from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-5 sm:p-10 shadow-2xl backdrop-blur-2xl"
            >
              {/* Perforation ticket-edge dots */}
              <div className="pointer-events-none absolute left-0 top-1/2 hidden sm:flex -translate-x-1/2 -translate-y-1/2 flex-col gap-2">
                {Array.from({ length: 12 }).map((_, i) => (
                  <span
                    key={`pl-${i}`}
                    className="h-2.5 w-2.5 rounded-full bg-[#f5e6c8] shadow-inner"
                  />
                ))}
              </div>
              <div className="pointer-events-none absolute right-0 top-1/2 hidden sm:flex translate-x-1/2 -translate-y-1/2 flex-col gap-2">
                {Array.from({ length: 12 }).map((_, i) => (
                  <span
                    key={`pr-${i}`}
                    className="h-2.5 w-2.5 rounded-full bg-[#f5e6c8] shadow-inner"
                  />
                ))}
              </div>

              {/* Brass top rail */}
              <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

              {/* Hero greeting & Title inside the card */}
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
                <div>
                  <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#3a1f0a] to-[#7a4416] px-4 py-1.5 text-[11px] sm:text-xs font-semibold uppercase tracking-widest text-[#ffd88a] shadow-[0_8px_20px_-8px_rgba(58,31,10,0.6)]">
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

                <div className="hidden sm:flex items-center gap-2 rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/90 px-3.5 py-2 text-xs font-semibold text-[#3a1f0a] shadow-2xs shrink-0">
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                  <span>Instant GPS Dispatch</span>
                </div>
              </div>

              {/* Ticket perforation divider */}
              <div className="relative my-5 sm:my-6 flex items-center gap-3">
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

              <div className="mb-4 flex items-center justify-between gap-2">
                <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.22em] text-[#7a4416]">
                  Route Specifications
                </span>
                {(pickup || destination) && (
                  <button
                    type="button"
                    onClick={handleSwapLocations}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#7a4416]/25 bg-[#fffaf0] px-3 py-1.5 text-[11px] font-bold text-[#3a1f0a] hover:bg-[#fff4dc] active:scale-95 transition-all shadow-2xs"
                    title="Swap Pickup and Destination"
                  >
                    <ArrowUpDown className="h-3.5 w-3.5 text-[#b8722c]" />
                    Swap Route
                  </button>
                )}
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
                      <div className="flex items-center gap-1 sm:gap-1.5">
                        {pickup && (
                          <button
                            type="button"
                            onClick={() => {
                              setPickup("");
                              setPickupCoords(null);
                              setRouteDistance(null);
                              setRouteDuration(null);
                            }}
                            className="grid h-8 w-8 place-items-center rounded-lg text-[#7a4416]/70 hover:bg-[#7a4416]/10 hover:text-[#2e1808] transition-colors"
                            title="Clear pickup"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleUseCurrentLocation}
                          title="Use current location"
                          className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] text-[#ffd88a] shadow-sm hover:opacity-90 active:scale-95 transition-all"
                        >
                          {isLocating ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Locate className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsPickupMapOpen(true)}
                          title="Pinpoint pickup on map"
                          className="grid h-9 w-9 place-items-center rounded-xl border border-[#7a4416]/25 bg-[#fffaf0] text-[#3a1f0a] shadow-sm hover:bg-[#fff4dc] active:scale-95 transition-all"
                        >
                          <MapPin className="h-4 w-4 text-[#b8722c]" />
                        </button>
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
                  <AnimatePresence>
                    {activeField === "pickup" && pickup.trim().length > 2 && (
                      <motion.div
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.16 }}
                        className="rd-scroll-fade absolute left-0 sm:left-11 right-0 top-full z-30 mt-2 max-h-64 overflow-y-auto rounded-2xl border border-[#7a4416]/25 bg-[#fffaf0] p-1.5 shadow-[0_20px_50px_-20px_rgba(80,40,10,0.45)] backdrop-blur-md"
                      >
                        {isSearchingPickup ? (
                          <div className="flex items-center justify-center gap-2 py-4 text-xs font-semibold text-[#7a4416]">
                            <Loader2 className="h-4 w-4 animate-spin text-[#b8722c]" />
                            Searching places...
                          </div>
                        ) : pickupSuggestions.length > 0 ? (
                          pickupSuggestions.map((item, idx) => (
                            <div
                              key={idx}
                              onClick={() => handleSelectPlace(item, "pickup")}
                              className="flex cursor-pointer items-center gap-2.5 rounded-xl px-4 py-2.5 text-xs font-semibold text-[#2e1808] hover:bg-[#fff4dc] transition-colors"
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
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Destination */}
                <div className="relative w-full">
                  <FieldRow
                    icon={<Dot color="brass" />}
                    trailing={
                      <div className="flex items-center gap-1 sm:gap-1.5">
                        {destination && (
                          <button
                            type="button"
                            onClick={() => {
                              setDestination("");
                              setDestinationCoords(null);
                              setRouteDistance(null);
                              setRouteDuration(null);
                            }}
                            className="grid h-8 w-8 place-items-center rounded-lg text-[#7a4416]/70 hover:bg-[#7a4416]/10 hover:text-[#2e1808] transition-colors"
                            title="Clear destination"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setIsDestinationMapOpen(true)}
                          title="Pinpoint destination on map"
                          className="grid h-9 w-9 place-items-center rounded-xl border border-[#7a4416]/25 bg-[#fffaf0] text-[#3a1f0a] shadow-sm hover:bg-[#fff4dc] active:scale-95 transition-all"
                        >
                          <MapPin className="h-4 w-4 text-[#b8722c]" />
                        </button>
                        <div className="hidden sm:grid h-9 w-9 place-items-center text-[#7a4416]">
                          <Navigation className="h-4 w-4 text-[#b8722c]" />
                        </div>
                      </div>
                    }
                    label="Destination Drop-Off"
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
                  <AnimatePresence>
                    {activeField === "destination" && destination.trim().length > 2 && (
                      <motion.div
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.16 }}
                        className="rd-scroll-fade absolute left-0 sm:left-11 right-0 top-full z-30 mt-2 max-h-64 overflow-y-auto rounded-2xl border border-[#7a4416]/25 bg-[#fffaf0] p-1.5 shadow-[0_20px_50px_-20px_rgba(80,40,10,0.45)] backdrop-blur-md"
                      >
                        {isSearchingDestination ? (
                          <div className="flex items-center justify-center gap-2 py-4 text-xs font-semibold text-[#7a4416]">
                            <Loader2 className="h-4 w-4 animate-spin text-[#b8722c]" />
                            Searching places...
                          </div>
                        ) : destinationSuggestions.length > 0 ? (
                          destinationSuggestions.map((item, idx) => (
                            <div
                              key={idx}
                              onClick={() => handleSelectPlace(item, "destination")}
                              className="flex cursor-pointer items-center gap-2.5 rounded-xl px-4 py-2.5 text-xs font-semibold text-[#2e1808] hover:bg-[#fff4dc] transition-colors"
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
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Bottom Dispatch & Route Metrics Bar inside Master Card */}
              <div className="mt-7 sm:mt-8 pt-6 border-t border-[#7a4416]/20 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 w-full">
                {routeDistance !== null || isCalculatingRoute ? (
                  <div className="flex items-center justify-center sm:justify-start gap-3 rounded-2xl border border-[#c58a3a]/40 bg-[#fffdf9] px-5 py-3 text-xs font-semibold text-[#3a1f0a] shadow-sm console-readout">
                    {isCalculatingRoute ? (
                      <div className="flex items-center gap-2 text-[#7a4416]">
                        <Loader2 className="h-4 w-4 animate-spin text-[#b8722c]" />
                        Calculating optimal route…
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5">
                          <RouteIcon className="h-4 w-4 text-[#b8722c]" />
                          <span className="font-black text-sm text-[#2e1808]">
                            {routeDistance ? formatDistance(routeDistance) : ""}
                          </span>
                        </div>
                        <span className="h-4 w-px bg-[#7a4416]/25" />
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-4 w-4 text-[#b8722c]" />
                          <span className="font-black text-sm text-[#2e1808]">
                            {routeDuration ? formatDuration(routeDuration) : ""}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-center sm:text-left text-xs font-medium text-[#7a4416]/85">
                    Select pickup & destination to preview route distance and ETA.
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleProceedToChoose}
                  disabled={!canProceed}
                  className="group relative w-full sm:w-auto inline-flex items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-8 py-4 text-sm sm:text-base font-bold text-[#ffe9be] shadow-[0_18px_40px_-12px_rgba(58,31,10,0.7),inset_0_1px_0_rgba(255,216,138,0.35)] hover:opacity-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 transition-all"
                >
                  <span className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-[#c58a3a]/40" />
                  <span className="relative z-10 inline-flex items-center gap-2">
                    Choose Vehicle Class
                    <ArrowRight className="h-4 w-4 text-[#ffd88a] transition-transform group-hover:translate-x-1" />
                  </span>
                </button>
              </div>

              {/* Inline error */}
              <AnimatePresence>
                {rideError && (
                  <motion.p
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="mt-4 rounded-xl border border-rose-500/35 bg-rose-950/15 px-4 py-3 text-xs font-semibold text-rose-950 shadow-2xs w-full"
                  >
                    {rideError}
                  </motion.p>
                )}
              </AnimatePresence>

              {/* Brass bottom rail */}
              <div className="pointer-events-none absolute inset-x-8 bottom-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
            </section>

            {/* RIGHT COLUMN (xl:col-span-5): Modular Companion Dock (Kept mounted so switching never re-fetches) */}
            <aside className="xl:col-span-5 w-full space-y-4">
              {/* Spring-Animated Dock Mode Switcher */}
              <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-[#fff4dc]/85 bg-[#fffaf0]/90 p-1.5 shadow-md backdrop-blur-xl">
                {(
                  [
                    { id: "history", label: "Recent Rides", icon: History },
                    { id: "sessions", label: "Active Sessions", icon: ShieldCheck },
                  ] as const
                ).map((dock) => {
                  const isDockActive = rightDockTab === dock.id;
                  const DockIcon = dock.icon;
                  return (
                    <button
                      key={dock.id}
                      type="button"
                      onClick={() => setRightDockTab(dock.id)}
                      className={`relative flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold transition-colors ${
                        isDockActive
                          ? "text-[#ffd88a]"
                          : "text-[#6b3a12] hover:bg-[#fff4dc]/70 hover:text-[#2e1808]"
                      }`}
                    >
                      {isDockActive && (
                        <motion.span
                          layoutId="riderRightDockPill"
                          transition={{ type: "spring", stiffness: 380, damping: 30 }}
                          className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] shadow-sm ring-1 ring-[#c58a3a]/45"
                        />
                      )}
                      <span className="relative z-10 flex items-center gap-2">
                        <DockIcon
                          className={`h-3.5 w-3.5 ${
                            isDockActive ? "text-[#ffd88a]" : "text-[#b8722c]"
                          }`}
                        />
                        <span>{dock.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Both compact panels stay warm once rendered so toggling never flashes 0 or re-fetches */}
              <div className={rightDockTab === "history" ? "block" : "hidden"}>
                <RiderHistoryPanel
                  compact
                  onRebook={handleInstantRebook}
                  onExpandView={() => handleSelectTab("history")}
                />
              </div>

              <div className={rightDockTab === "sessions" ? "block" : "hidden"}>
                <ActiveSessions
                  embedded
                  compact
                  onExpandView={() => handleSelectTab("sessions")}
                />
              </div>
            </aside>
          </div>

          {/* TAB 2: FULL-WIDTH RIDE HISTORY VIEW */}
          {visitedTabs.history && (
            <div
              className={
                activeTab === "history"
                  ? "block w-full animate-in fade-in duration-200"
                  : "hidden"
              }
            >
              <RiderHistoryPanel onRebook={handleInstantRebook} />
            </div>
          )}

          {/* TAB 3: FULL-WIDTH ACTIVE SESSIONS & SECURITY VIEW */}
          {visitedTabs.sessions && (
            <div
              className={
                activeTab === "sessions"
                  ? "block w-full animate-in fade-in duration-200"
                  : "hidden"
              }
            >
              <ActiveSessions embedded />
            </div>
          )}
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
    <label className="w-full flex items-center gap-3 rounded-2xl border border-[#7a4416]/25 bg-[#fffdf9] px-3.5 sm:px-4 py-3 transition-all duration-300 focus-within:border-transparent focus-within:ring-2 focus-within:ring-[#b8722c] focus-within:shadow-[0_0_0_4px_rgba(184,114,44,0.15)] shadow-sm">
      <span className="shrink-0">{icon}</span>
      <span className="flex flex-1 flex-col min-w-0">
        <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#7a4416]">
          {label}
        </span>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          placeholder={placeholder}
          className="h-9 border-0 bg-transparent px-0 text-base font-semibold text-[#2e1808] placeholder:text-[#7a4416]/45 placeholder:font-normal focus-visible:ring-0 shadow-none outline-none w-full"
        />
      </span>
      <span className="shrink-0">{trailing}</span>
    </label>
  );
}