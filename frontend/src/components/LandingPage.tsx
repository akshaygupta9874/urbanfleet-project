import { useState, useEffect, useRef } from "react";
import { motion, type Variants, AnimatePresence } from "framer-motion";

import {
  MapPin,
  Clock3,
  ChevronDown,
  Circle,
  Square,
  Navigation,
  Sparkles,
  Car,
  Star,
  Loader2,
  Locate,
  ArrowRight,
  ShieldCheck,
  Bike,
  IndianRupee,
} from "lucide-react";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useNavigate } from "react-router-dom";
import { searchPlaces, reverseGeocode } from "../services/geoapify.service";
import { getGeoapifyPoint, isGeoapifyFeatureCollection, type GeoapifyFeature } from "../types/geoapify";
import PinpointLocation from "./PinpointLocation";
import { useAuthContext } from "../context/auth-context";
import CityMapBackground from "./CityMapBackground";

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.12, delayChildren: 0.1 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
  },
};

interface RideModeOption {
  id: "bike" | "auto" | "car";
  name: string;
  description: string;
  icon: React.ReactNode;
  multiplier: number;
  etaMinutes: number;
}

const RIDE_MODES: RideModeOption[] = [
  {
    id: "bike",
    name: "Moto / Bike",
    description: "Fastest through traffic",
    icon: <Bike className="h-5 w-5 text-[#ffd88a]" />,
    multiplier: 0.7,
    etaMinutes: 3,
  },
  {
    id: "auto",
    name: "Auto Rickshaw",
    description: "Affordable local ride",
    icon: <Sparkles className="h-5 w-5 text-[#ffd88a]" />,
    multiplier: 0.9,
    etaMinutes: 5,
  },
  {
    id: "car",
    name: "Comfort Car",
    description: "Spacious & air-conditioned",
    icon: <Car className="h-5 w-5 text-[#ffd88a]" />,
    multiplier: 1.2,
    etaMinutes: 7,
  },
];

function formatRupee(amount: number): string {
  return amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}



// ---------- Rotating tagline ----------
const taglines = ["anywhere", "anytime", "in style", "with Aura"];
function RotatingWord() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % taglines.length), 2400);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="relative inline-block min-w-[280px] align-baseline">
      <AnimatePresence mode="wait">
        <motion.span
          key={taglines[i]}
          initial={{ y: 40, opacity: 0, filter: "blur(8px)" }}
          animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
          exit={{ y: -40, opacity: 0, filter: "blur(8px)" }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="inline-block bg-gradient-to-br from-[#2e1808] via-[#6b3a12] to-[#b8722c] bg-clip-text text-transparent"
        >
          {taglines[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

// ---------- Floating live stats chip ----------
function LiveChip() {
  const [eta, setEta] = useState(3);
  useEffect(() => {
    const t = setInterval(() => setEta((e) => (e <= 1 ? 6 : e - 1)), 1800);
    return () => clearInterval(t);
  }, []);
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4, duration: 0.6 }}
      className="inline-flex items-center gap-2 rounded-full border border-[#7a4416]/25 bg-[#fffaf0]/90 px-4 py-2 text-xs font-semibold text-[#3a1f0a] shadow-sm backdrop-blur-md"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      <Navigation size={12} className="text-[#b8722c]" />
      <span>Drivers nearby · {eta} min away</span>
    </motion.div>
  );
}

export default function LandingPage() {
  const [isFocused, setIsFocused] = useState(false);
  const navigate = useNavigate();
  const formRef = useRef<HTMLDivElement | null>(null);
  const { isAuthenticated } = useAuthContext();

  // Dynamic Current Location State
  const [currentLocationName, setCurrentLocationName] = useState("Kolkata, IN");
  const [isDetectingCity, setIsDetectingCity] = useState(() => typeof navigator !== "undefined" && "geolocation" in navigator);

  // Input & Pricing States
  const [pickup, setPickup] = useState("");
  const [destination, setDestination] = useState("");
  const [pickupCoords, setPickupCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  const [pickupSuggestions, setPickupSuggestions] = useState<GeoapifyFeature[]>([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState<GeoapifyFeature[]>([]);
  const [activeField, setActiveField] = useState<"pickup" | "destination" | null>(null);

  const [isSearchingPickup, setIsSearchingPickup] = useState(false);
  const [isSearchingDestination, setIsSearchingDestination] = useState(false);
  const [isLocatingPickup, setIsLocatingPickup] = useState(false);

  // Map Modal Visibility & Initial Location State
  const [isPickupMapOpen, setIsPickupMapOpen] = useState(false);
  const [isDestinationMapOpen, setIsDestinationMapOpen] = useState(false);

  // Pricing display state
  const [showPrices, setShowPrices] = useState(false);
  const [isCalculatingPrices, setIsCalculatingPrices] = useState(false);
  const [pricingError, setPricingError] = useState("");
  const [calculatedDistanceMeters, setCalculatedDistanceMeters] = useState<number>(5000); // default 5km fallback
  const [calculatedDurationSeconds, setCalculatedDurationSeconds] = useState<number>(840); // default ~14min fallback

  // Outside click listener to close suggestions
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (formRef.current && !formRef.current.contains(event.target as Node)) {
        setActiveField(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Detect user's current city on mount
  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          try {
            const apiKey = import.meta.env.VITE_GEOAPIFY_API_KEY || "";
            const res = await fetch(`https://api.geoapify.com/v1/geocode/reverse?lat=${latitude}&lon=${longitude}&apiKey=${apiKey}`);
            const data: unknown = await res.json();
            if (isGeoapifyFeatureCollection(data) && data.features[0]) {
              const prop = data.features[0].properties;
              const city = prop.city || prop.town || prop.county || "Kolkata";
              const country = prop.country_code ? prop.country_code.toUpperCase() : "IN";
              setCurrentLocationName(`${city}, ${country}`);
            }
          } catch {
            // keep fallback
          } finally {
            setIsDetectingCity(false);
          }
        },
        () => {
          setIsDetectingCity(false);
        },
        { timeout: 8000 }
      );
    }
  }, []);

  // Place Autocomplete Effect for Pickup
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

  // Place Autocomplete Effect for Destination
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

  const handleSelectPlace = (feature: GeoapifyFeature, type: "pickup" | "destination") => {
    const address = feature.properties.formatted || feature.properties.name || "Selected Location";
    const point = getGeoapifyPoint(feature);
    if (!point) return;
    const [longitude, latitude] = point;
    if (type === "pickup") {
      setPickup(address);
      setPickupCoords({ latitude, longitude });
      setPickupSuggestions([]);
    } else {
      setDestination(address);
      setDestinationCoords({ latitude, longitude });
      setDestinationSuggestions([]);
    }
    setActiveField(null);
  };

  const handleUseCurrentLocationForPickup = () => {
    setPricingError("");
    if (!navigator.geolocation) {
      setPricingError("Geolocation is not supported by your browser.");
      return;
    }
    setIsLocatingPickup(true);
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
            setIsLocatingPickup(false);
          }
        })();
      },
      (error) => {
        setPricingError(`Unable to retrieve location: ${error.message}`);
        setIsLocatingPickup(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
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

  const handleSeePricesClick = async () => {
    if (!pickup.trim() || !destination.trim()) {
      setPricingError("Please fill in both pickup and dropoff locations.");
      return;
    }
    setPricingError("");
    setShowPrices(true);
    setIsCalculatingPrices(true);

    try {
      if (pickupCoords && destinationCoords) {
        const apiKey = import.meta.env.VITE_GEOAPIFY_API_KEY || "";
        const url = `https://api.geoapify.com/v1/routing?waypoints=${pickupCoords.latitude},${pickupCoords.longitude}|${destinationCoords.latitude},${destinationCoords.longitude}&mode=drive&apiKey=${apiKey}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data?.features?.[0]?.properties?.distance) {
          setCalculatedDistanceMeters(data.features[0].properties.distance);
        }
        if (data?.features?.[0]?.properties?.time) {
          setCalculatedDurationSeconds(data.features[0].properties.time);
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    } catch {
      // keep fallback distance
    } finally {
      setIsCalculatingPrices(false);
    }
  };

  const handleSelectRideMode = (modeId: RideModeOption["id"]) => {
    if (!isAuthenticated) {
      navigate("/login");
      return;
    }

    if (!pickupCoords || !destinationCoords) {
      setPricingError("Please select both pickup and destination from the suggestions.");
      return;
    }

    const payload = {
      pickup,
      destination,
      pickupCoords,
      destinationCoords,
      routeDistance: calculatedDistanceMeters,
      routeDuration: calculatedDurationSeconds,
      selectedMode: modeId,
    };

    sessionStorage.setItem("pendingRide", JSON.stringify(payload));
    navigate("/choose");
  };

  const baseFareValue = 25 + (calculatedDistanceMeters / 1000) * 5 + 4;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f5e6c8] font-sans text-[#2e1808]">
      <CityMapBackground />

      <section className="relative z-10 mx-auto flex min-h-[calc(100vh-80px)] max-w-7xl flex-col items-center justify-between gap-16 px-8 py-10 lg:flex-row">
        {/* Left */}
        <motion.div className="flex-1" variants={containerVariants} initial="hidden" animate="visible">
          <motion.div variants={itemVariants} className="mb-5 flex flex-wrap items-center gap-3">
            <LiveChip />
            <div className="inline-flex items-center gap-2 rounded-full border border-[#7a4416]/25 bg-[#fffaf0]/90 px-3.5 py-1.5 text-xs font-semibold text-[#3a1f0a] shadow-sm backdrop-blur-md">
              <Sparkles size={12} className="text-[#b8722c]" />
              New · Schedule rides up to 30 days ahead
            </div>
          </motion.div>

          <motion.div variants={itemVariants} className="mb-6 flex items-center gap-2 text-base text-[#6b3a12]">
            <MapPin size={18} className="text-[#b8722c]" />
            <span className="font-semibold text-[#2e1808]">
              {isDetectingCity ? "Detecting location..." : currentLocationName}
            </span>
            <button className="text-[#7a4416] underline underline-offset-4 transition-colors hover:text-[#3a1f0a] font-medium">
              Change city
            </button>
          </motion.div>

          <motion.h1
            variants={itemVariants}
            className="max-w-xl text-6xl font-extrabold leading-[1.05] tracking-tight md:text-7xl text-[#2e1808]"
            style={{ fontFamily: "'Fraunces', Georgia, serif" }}
          >
            Go <RotatingWord />
            <br />
            with one tap.
          </motion.h1>

          <motion.p variants={itemVariants} className="mt-5 max-w-md text-base font-medium text-[#6b3a12]">
            Request a ride, hop in, and relax. Real-time tracking, upfront pricing,
            and trusted drivers — wherever you're headed.
          </motion.p>

          <motion.div variants={itemVariants}>
            <button className="mt-7 flex items-center gap-3 rounded-full border border-[#7a4416]/25 bg-[#fffaf0]/90 px-6 py-3 shadow-sm transition-all hover:bg-[#fff4dc] hover:border-[#b8722c] active:scale-95 text-[#3a1f0a] font-semibold">
              <Clock3 size={20} className="text-[#b8722c]" />
              <span className="text-base font-semibold">Pickup now</span>
              <ChevronDown size={18} className="text-[#7a4416]" />
            </button>
          </motion.div>

          {/* Inputs Form Container with outside-click ref */}
          <motion.div ref={formRef} variants={itemVariants} className="mt-7 max-w-lg space-y-5">
            {/* Pickup Input */}
            <div className="group relative">
              <motion.div
                className="pointer-events-none absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-[#7a4416] via-[#f4b860] to-[#b8722c] opacity-0 blur transition duration-500"
                animate={{ opacity: isFocused ? 0.45 : 0 }}
              />
              <div
                className="relative"
                onFocus={() => setIsFocused(true)}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsFocused(false);
                }}
              >
                <Circle className="absolute left-5 top-1/2 z-10 -translate-y-1/2 text-[#7a4416]/60 transition-colors group-focus-within:text-[#b8722c]" size={16} />
                <Input
                  value={pickup}
                  onChange={(e) => {
                    setPickup(e.target.value);
                    setActiveField("pickup");
                    setPickupCoords(null);
                  }}
                  onFocus={() => setActiveField("pickup")}
                  placeholder="Pickup location"
                  className="h-16 w-full rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/95 pl-14 pr-24 text-lg text-[#2e1808] placeholder:text-[#7a4416]/45 shadow-sm backdrop-blur transition-all focus-within:border-[#b8722c] focus-within:bg-[#fffaf0] focus-within:ring-2 focus-within:ring-[#b8722c]/20 focus:outline-none"
                />

                {/* Single button if location not fetched yet, or both if fetched */}
                <div className="absolute right-3 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleUseCurrentLocationForPickup}
                    title="Use current location"
                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffd88a] transition-all hover:scale-110 shadow-md"
                  >
                    {isLocatingPickup ? <Loader2 className="animate-spin" size={18} /> : <Locate size={18} />}
                  </button>

                  {/* Show Map Pin button ONLY after pickupCoords are available */}
                  {pickupCoords && (
                    <button
                      type="button"
                      onClick={() => setIsPickupMapOpen(true)}
                      title="Select precise pickup on map"
                      className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fffaf0] text-[#3a1f0a] border border-[#7a4416]/20 shadow-md transition-all hover:scale-110"
                    >
                      <MapPin size={18} className="text-[#b8722c]" />
                    </button>
                  )}
                </div>

                {/* Pickup Dropdown */}
                <AnimatePresence>
                  {activeField === "pickup" && pickup.trim().length > 2 && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      className="absolute left-0 right-0 top-full z-30 mt-2 max-h-60 overflow-y-auto rounded-2xl border border-[#7a4416]/25 bg-[#fffaf0] p-1 shadow-2xl backdrop-blur-md"
                    >
                      {isSearchingPickup ? (
                        <div className="flex items-center justify-center gap-2 py-4 text-xs font-medium text-[#7a4416]">
                          <Loader2 className="h-4 w-4 animate-spin text-[#b8722c]" /> Searching places...
                        </div>
                      ) : pickupSuggestions.length > 0 ? (
                        pickupSuggestions.map((item, idx) => (
                          <div
                            key={idx}
                            onClick={() => handleSelectPlace(item, "pickup")}
                            className="flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold text-[#2e1808] transition hover:bg-[#fff4dc]"
                          >
                            <MapPin size={14} className="shrink-0 text-[#b8722c]" />
                            <span className="truncate">{item.properties?.formatted || item.properties?.name}</span>
                          </div>
                        ))
                      ) : (
                        <div className="py-4 text-center text-xs font-medium text-[#7a4416]/70">No locations found</div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Dropoff Input */}
            <div className="relative">
              <div className="absolute left-[27px] -top-6 h-10 w-0.5 overflow-hidden">
                <div className="h-full w-full bg-[#7a4416]/30" />
                <motion.div
                  className="absolute top-0 left-0 h-full w-full origin-top bg-[#b8722c]"
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: isFocused ? 1 : 0 }}
                  transition={{ duration: 0.4, ease: "easeInOut" }}
                />
              </div>
              <Square
                className={`absolute left-5 top-1/2 z-10 -translate-y-1/2 transition-colors ${isFocused ? "text-[#b8722c]" : "text-[#7a4416]/60"}`}
                size={16}
              />
              <Input
                value={destination}
                onChange={(e) => {
                  setDestination(e.target.value);
                  setActiveField("destination");
                  setDestinationCoords(null);
                }}
                onFocus={() => setActiveField("destination")}
                placeholder="Dropoff location"
                className={`h-16 w-full rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/95 pl-14 text-lg text-[#2e1808] placeholder:text-[#7a4416]/45 shadow-sm backdrop-blur transition-all focus-within:border-[#b8722c] focus-within:bg-[#fffaf0] focus-within:ring-2 focus-within:ring-[#b8722c]/20 focus:outline-none ${destinationCoords ? "pr-14" : "pr-4"}`}
              />

              {/* Show Map Pin button for destination ONLY after destinationCoords are selected */}
              {destinationCoords && (
                <button
                  type="button"
                  onClick={() => setIsDestinationMapOpen(true)}
                  title="Select precise dropoff on map"
                  className="absolute right-3 top-1/2 z-10 flex -translate-y-1/2 items-center justify-center rounded-xl bg-[#fffaf0] p-2.5 text-[#3a1f0a] border border-[#7a4416]/20 shadow-md transition-all hover:scale-110"
                >
                  <MapPin size={18} className="text-[#b8722c]" />
                </button>
              )}

              {/* Destination Dropdown */}
              <AnimatePresence>
                {activeField === "destination" && destination.trim().length > 2 && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="absolute left-0 right-0 top-full z-30 mt-2 max-h-60 overflow-y-auto rounded-2xl border border-[#7a4416]/25 bg-[#fffaf0] p-1 shadow-2xl backdrop-blur-md"
                  >
                    {isSearchingDestination ? (
                      <div className="flex items-center justify-center gap-2 py-4 text-xs font-medium text-[#7a4416]">
                        <Loader2 className="h-4 w-4 animate-spin text-[#b8722c]" /> Searching places...
                      </div>
                    ) : destinationSuggestions.length > 0 ? (
                      destinationSuggestions.map((item, idx) => (
                        <div
                          key={idx}
                          onClick={() => handleSelectPlace(item, "destination")}
                          className="flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold text-[#2e1808] transition hover:bg-[#fff4dc]"
                        >
                          <MapPin size={14} className="shrink-0 text-[#b8722c]" />
                          <span className="truncate">{item.properties?.formatted || item.properties?.name}</span>
                        </div>
                      ))
                    ) : (
                      <div className="py-4 text-center text-xs font-medium text-[#7a4416]/70">No locations found</div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>

          {/* Inline Pricing Error */}
          <AnimatePresence>
            {pricingError && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="mt-3 rounded-xl border border-rose-500/30 bg-rose-950/20 px-4 py-2 text-sm font-semibold text-rose-900 shadow-sm"
              >
                {pricingError}
              </motion.p>
            )}
          </AnimatePresence>

          <motion.div variants={itemVariants} className="mt-10 flex flex-wrap items-center gap-6">
            <Button
              className="group relative h-14 overflow-hidden rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-8 text-base font-semibold text-[#ffe9be] shadow-[0_18px_40px_-12px_rgba(58,31,10,0.7),inset_0_1px_0_rgba(255,216,138,0.35)] transition-all hover:shadow-[0_24px_50px_-14px_rgba(58,31,10,0.85)] active:scale-95"
              onClick={handleSeePricesClick}
            >
              <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-[#c58a3a]/40" />
              <span className="relative z-10">See prices</span>
              <span className="absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-[#ffd88a]/60 to-transparent transition-transform duration-1000 group-hover:translate-x-[420%]" />
            </Button>
            <button
              type="button"
              className="group relative text-base font-semibold text-[#6b3a12] transition-colors hover:text-[#3a1f0a]"
              onClick={() => navigate("/login")}
            >
              Log in to see your recent activity
              <span className="absolute -bottom-1 left-0 h-[2px] w-0 bg-[#b8722c] transition-all duration-300 group-hover:w-full" />
            </button>
          </motion.div>

          {/* Pricing Preview Showcase Panel */}
          <AnimatePresence>
            {showPrices && (
              <motion.div
                initial={{ opacity: 0, y: 16, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: 16, height: 0 }}
                className="mt-8 max-w-lg overflow-hidden rounded-[2rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-6 shadow-2xl backdrop-blur-2xl text-[#2e1808]"
              >
                <div className="flex items-center justify-between border-b border-[#7a4416]/20 pb-4">
                  <div>
                    <h3 className="text-lg font-bold" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>Choose your ride mode</h3>
                    <p className="text-xs font-medium text-[#6b3a12] truncate max-w-[280px]">
                      {pickup} → {destination}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowPrices(false)}
                    className="text-xs font-semibold text-[#7a4416] hover:text-[#3a1f0a]"
                  >
                    Close
                  </button>
                </div>

                {isCalculatingPrices ? (
                  <div className="flex flex-col items-center justify-center py-10 text-[#7a4416]">
                    <Loader2 className="mb-2 h-6 w-6 animate-spin text-[#b8722c]" />
                    <p className="text-sm font-medium">Calculating best fares & ETAs...</p>
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {RIDE_MODES.map((mode) => {
                      const calculatedFare = Math.round(baseFareValue * mode.multiplier);
                      return (
                        <div
                          key={mode.id}
                          onClick={() => handleSelectRideMode(mode.id)}
                          className="group flex cursor-pointer items-center justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/80 p-4 transition-all hover:border-[#b8722c] hover:bg-[#fffaf0] hover:shadow-md"
                        >
                          <div className="flex items-center gap-3.5">
                            <div className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffd88a] shadow-sm border border-[#c58a3a]/40">
                              {mode.icon}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-[#2e1808]">{mode.name}</span>
                                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-900 border border-emerald-500/30">
                                  {mode.etaMinutes} mins away
                                </span>
                              </div>
                              <p className="text-xs font-medium text-[#6b3a12]">{mode.description}</p>
                            </div>
                          </div>

                          <div className="text-right">
                            <p className="text-base font-extrabold text-[#2e1808] flex items-center justify-end">
                              <IndianRupee className="h-3.5 w-3.5 mr-0.5 text-[#b8722c]" />
                              {formatRupee(calculatedFare)}
                            </p>
                            <div className="text-xs text-emerald-800 flex items-center gap-1 justify-end font-bold">
                              <span>Book</span> <ArrowRight size={12} />
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    <div className="pt-2 text-center">
                      <p className="text-[11px] font-semibold text-[#7a4416] flex items-center justify-center gap-1">
                        <ShieldCheck size={12} className="text-[#b8722c]" /> Sign in to confirm booking & lock in your fare
                      </p>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Trust row */}
          <motion.div variants={itemVariants} className="mt-10 flex items-center gap-6 text-sm font-semibold text-[#6b3a12]">
            <div className="flex items-center gap-1.5">
              <Star size={14} className="fill-amber-400 text-amber-400" />
              <span className="font-bold text-[#2e1808]">4.9</span>
              <span>· 130M+ riders</span>
            </div>
            <div className="hidden h-4 w-px bg-[#7a4416]/25 md:block" />
            <div className="hidden md:block">Available in 10,000+ cities</div>
          </motion.div>
        </motion.div>

        {/* Right */}
        <motion.div
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.9, delay: 0.3, ease: "easeOut" }}
          className="relative hidden flex-1 justify-center lg:flex"
        >
          <motion.div
            animate={{ y: [0, -12, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            className="relative"
          >
            <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-tr from-[#b8722c]/20 via-transparent to-[#f4b860]/30 blur-2xl" />
            <img
              src="https://cn-geo1.uber.com/image-proc/crop/resizecrop/udam/format=auto/width=1344/height=1344/srcb64=aHR0cHM6Ly90Yi1zdGF0aWMudWJlci5jb20vcHJvZC91ZGFtLWFzc2V0cy9jZTczNjUzMy1iMWE0LTQ3ZjktOTk0OS0zNWEzZGUyNTkyYzk="
              alt="Aura Journey"
              className="relative w-[460px] rounded-[2rem] object-cover shadow-2xl ring-1 ring-[#c58a3a]/30"
            />

            {/* Top-left floating ETA card */}
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: 0.9, duration: 0.6 }}
              className="absolute -left-8 top-10 flex items-center gap-3 rounded-2xl bg-[#fffaf0]/95 px-4 py-3 shadow-xl backdrop-blur border border-[#7a4416]/20"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] text-[#ffd88a]">
                <Car size={18} />
              </div>
              <div className="text-sm">
                <div className="font-bold text-[#2e1808]">AuraX · 2 min</div>
                <div className="text-xs font-medium text-[#6b3a12]">Arriving nearby</div>
              </div>
            </motion.div>

            {/* Right floating rating */}
            <motion.div
              initial={{ opacity: 0, x: 20, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              transition={{ delay: 1.1, duration: 0.6 }}
              className="absolute -right-6 top-1/2 flex items-center gap-2 rounded-full bg-[#fffaf0]/95 px-4 py-2.5 shadow-xl backdrop-blur border border-[#7a4416]/20"
            >
              <Star size={14} className="fill-amber-400 text-amber-400" />
              <span className="text-sm font-bold text-[#2e1808]">5.0 trip</span>
            </motion.div>

            {/* Bottom card */}
            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="absolute -bottom-6 left-1/2 flex w-[88%] -translate-x-1/2 items-center justify-between rounded-2xl bg-gradient-to-r from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-6 py-5 text-[#ffe9be] shadow-2xl backdrop-blur border border-[#c58a3a]/40"
            >
              <div>
                <h2 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>Ready to travel?</h2>
                <p className="text-xs font-medium text-[#ffd88a]/80">Plan your ride in advance.</p>
              </div>
              <Button 
                onClick={() => navigate("/login")}
                className="rounded-xl bg-[#fffaf0] px-6 font-semibold text-[#3a1f0a] transition-transform hover:scale-105 hover:bg-[#fff4dc] shadow-md"
              >
                Schedule
              </Button>
            </motion.div>
          </motion.div>
        </motion.div>
      </section>

      {/* Pinpoint map modals for pickup and dropoff */}
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