import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import {
  MapPin,
  Loader2,
  Locate,
  Search,
  X,
  CheckCircle2,
  Plus,
  Minus,
  Compass,
  Navigation,
  Sparkles,
  RotateCcw,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { searchPlaces } from "../services/geoapify.service";
import { getGeoapifyPoint, type GeoapifyFeature } from "../types/geoapify";
import type { Coordinates } from "../types/location";

export interface PinpointLocationProps {
  isOpen: boolean;
  onClose: () => void;
  initialCoords: Coordinates | null;
  onConfirm: (address: string, coords: Coordinates) => void;
  reverseGeocodeFn: (lat: number, lng: number) => Promise<string>;
  title?: string;
}

const DISPLAY_FONT = "'Fraunces', Georgia, serif";
const BODY_FONT = "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif";
const MONO_FONT = "'JetBrains Mono', ui-monospace, 'SF Mono', monospace";

const DEFAULT_LAT = 22.5726;
const DEFAULT_LNG = 88.3639;

export default function PinpointLocation({
  isOpen,
  onClose,
  initialCoords,
  onConfirm,
  reverseGeocodeFn,
  title = "Set location",
}: PinpointLocationProps) {
  const [mapModalLat, setMapModalLat] = useState<number>(
    initialCoords?.latitude ?? DEFAULT_LAT
  );
  const [mapModalLng, setMapModalLng] = useState<number>(
    initialCoords?.longitude ?? DEFAULT_LNG
  );
  const [mapModalAddress, setMapModalAddress] = useState<string>("");
  const [isReverseGeocodingMap, setIsReverseGeocodingMap] = useState<boolean>(false);
  const [isDraggingMap, setIsDraggingMap] = useState<boolean>(false);
  const [isLocatingGps, setIsLocatingGps] = useState<boolean>(false);

  // Search input and autocomplete state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [suggestions, setSuggestions] = useState<GeoapifyFeature[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false);

  const isProgrammaticMoveRef = useRef(false);
  const geocodeSeqRef = useRef(0);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);

  // Race-condition-safe reverse geocoder
  const handleMapMoveEnd = useCallback(
    async (lat: number, lng: number) => {
      const requestId = ++geocodeSeqRef.current;
      setMapModalLat(lat);
      setMapModalLng(lng);
      setIsReverseGeocodingMap(true);

      try {
        const address = await reverseGeocodeFn(lat, lng);
        if (requestId === geocodeSeqRef.current) {
          setMapModalAddress(address);
        }
      } catch {
        if (requestId === geocodeSeqRef.current) {
          setMapModalAddress(`Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
        }
      } finally {
        if (requestId === geocodeSeqRef.current) {
          setIsReverseGeocodingMap(false);
        }
      }
    },
    [reverseGeocodeFn]
  );

  // Close search dropdown on outside click or Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchBoxRef.current &&
        !searchBoxRef.current.contains(event.target as Node)
      ) {
        setIsSearchFocused(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isSearchFocused && searchQuery) {
          setIsSearchFocused(false);
        } else {
          onClose();
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, isSearchFocused, onClose, searchQuery]);

  // Initialize Leaflet Map on an independent full-bleed canvas
  useEffect(() => {
    if (!isOpen) {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      setSearchQuery("");
      setSuggestions([]);
      setIsDraggingMap(false);
      return;
    }

    let resizeObserver: ResizeObserver | null = null;

    const timer = setTimeout(() => {
      if (mapContainerRef.current && !mapInstanceRef.current) {
        const startLat = initialCoords?.latitude ?? DEFAULT_LAT;
        const startLng = initialCoords?.longitude ?? DEFAULT_LNG;

        const map = L.map(mapContainerRef.current, {
          zoomControl: false,
          attributionControl: false,
        }).setView([startLat, startLng], 16);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
        }).addTo(map);

        mapInstanceRef.current = map;

        // Keep Leaflet tile geometry synced if window orientation changes
        map.invalidateSize();
        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(() => {
            map.invalidateSize({ pan: false });
          });
          resizeObserver.observe(mapContainerRef.current);
        }

        // Resolve initial center address
        void handleMapMoveEnd(startLat, startLng);

        map.on("movestart", () => {
          setIsDraggingMap(true);
        });

        map.on("move", () => {
          const center = map.getCenter();
          setMapModalLat(center.lat);
          setMapModalLng(center.lng);
        });

        map.on("moveend", () => {
          setIsDraggingMap(false);
          if (isProgrammaticMoveRef.current) {
            isProgrammaticMoveRef.current = false;
            return;
          }
          const center = map.getCenter();
          void handleMapMoveEnd(center.lat, center.lng);
        });
      }
    }, 60);

    return () => {
      clearTimeout(timer);
      resizeObserver?.disconnect();
    };
  }, [handleMapMoveEnd, initialCoords?.latitude, initialCoords?.longitude, isOpen]);

  // Debounced Geoapify Autocomplete Search
  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length <= 2) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await searchPlaces(query);
        setSuggestions(results || []);
      } catch {
        setSuggestions([]);
      } finally {
        setIsSearching(false);
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const panToCoordinates = (latitude: number, longitude: number, zoom = 17) => {
    if (mapInstanceRef.current) {
      isProgrammaticMoveRef.current = true;
      mapInstanceRef.current.setView([latitude, longitude], zoom, {
        animate: true,
      });
    }
  };

  const handleSelectSuggestion = (item: GeoapifyFeature) => {
    const address =
      item.properties.formatted || item.properties.name || "Selected Location";
    const point = getGeoapifyPoint(item);
    if (!point) return;
    const [longitude, latitude] = point;

    geocodeSeqRef.current += 1;
    setIsReverseGeocodingMap(false);
    setMapModalLat(latitude);
    setMapModalLng(longitude);
    setMapModalAddress(address);
    setSearchQuery("");
    setSuggestions([]);
    setIsSearchFocused(false);

    panToCoordinates(latitude, longitude, 17);
  };

  const handleUseCurrentGps = () => {
    if (navigator.geolocation) {
      setIsLocatingGps(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setIsLocatingGps(false);
          panToCoordinates(latitude, longitude, 17);
          void handleMapMoveEnd(latitude, longitude);
        },
        () => {
          setIsLocatingGps(false);
          if (initialCoords) {
            panToCoordinates(initialCoords.latitude, initialCoords.longitude, 16);
            void handleMapMoveEnd(initialCoords.latitude, initialCoords.longitude);
          }
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
      return;
    }

    if (initialCoords) {
      panToCoordinates(initialCoords.latitude, initialCoords.longitude, 16);
      void handleMapMoveEnd(initialCoords.latitude, initialCoords.longitude);
    }
  };

  const handleZoom = (delta: number) => {
    if (!mapInstanceRef.current) return;
    if (delta > 0) {
      mapInstanceRef.current.zoomIn();
    } else {
      mapInstanceRef.current.zoomOut();
    }
  };

  const handleConfirmSelection = () => {
    const resolvedAddress =
      mapModalAddress.trim() ||
      `Location (${mapModalLat.toFixed(4)}, ${mapModalLng.toFixed(4)})`;
    onConfirm(resolvedAddress, {
      latitude: mapModalLat,
      longitude: mapModalLng,
    });
  };

  const showSuggestionsDropdown =
    isSearchFocused && (isSearching || searchQuery.trim().length > 2);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1c0f05]/75 backdrop-blur-md sm:p-4 lg:p-6 select-none"
          style={{ fontFamily: BODY_FONT }}
        >
          <style>{`
            @keyframes uf-pin-radar {
              0% { transform: scale(0.65); opacity: 0.85; }
              80%, 100% { transform: scale(2.2); opacity: 0; }
            }
            @keyframes uf-shimmer {
              100% { transform: translateX(200%); }
            }
            .uf-pin-pulse {
              animation: uf-pin-radar 2.2s cubic-bezier(0.16, 1, 0.3, 1) infinite;
            }
            .uf-skeleton-shimmer {
              animation: uf-shimmer 1.6s infinite ease-in-out;
            }
          `}</style>

          {/* Modal Viewport: Full-Screen on Mobile, Framed Luxury Console on Desktop */}
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 12 }}
            transition={{ type: "spring", stiffness: 360, damping: 30 }}
            className="relative h-[100dvh] w-full overflow-hidden bg-[#efe0c4] text-[#2e1808] sm:h-[88dvh] sm:max-w-5xl sm:rounded-[2.5rem] sm:border sm:border-[#fff4dc]/85 sm:shadow-[0_36px_100px_-15px_rgba(20,10,2,0.7)] transform-gpu"
          >
            {/* 1. INDEPENDENT FULL-BLEED MAP CANVAS (Never resizes when UI cards change) */}
            <div
              ref={mapContainerRef}
              className="absolute inset-0 h-full w-full z-0"
            />

            {/* 2. INDEPENDENT GEOMETRIC CENTER PIN (Anchored at exact 50% / 50% of Map Canvas) */}
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-[400] h-0 w-0">
              {/* Ground Target Crosshair Ring (Locked at exact (0,0) center coordinate) */}
              <div className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
                {!isDraggingMap && (
                  <span className="uf-pin-pulse absolute h-8 w-8 rounded-full border-2 border-[#3a1f0a]/70" />
                )}
                {/* Contact Shadow / Bullseye Dot */}
                <span
                  className={`rounded-full bg-[#1c0f05] transition-all duration-200 ${
                    isDraggingMap
                      ? "h-2.5 w-4 opacity-35 blur-[1px]"
                      : "h-2.5 w-2.5 ring-2 ring-[#ffd88a] shadow-md"
                  }`}
                />
              </div>

              {/* Pin Body: Bottom of needle is anchored at bottom-0 (exact (0,0) center) */}
              <div
                className={`absolute bottom-0 left-0 -translate-x-1/2 flex flex-col items-center transition-transform duration-200 ease-out will-change-transform ${
                  isDraggingMap ? "-translate-y-3.5 scale-105" : "translate-y-0 scale-100"
                }`}
              >
                {/* Floating Micro Status Pill Above Pin */}
                <div
                  className="mb-1.5 rounded-full border border-[#ffd88a]/60 bg-[#2e1808]/95 px-2.5 py-0.5 text-[10px] font-bold text-[#ffd88a] shadow-lg whitespace-nowrap"
                  style={{ fontFamily: MONO_FONT }}
                >
                  {isDraggingMap
                    ? "Panning map…"
                    : isReverseGeocodingMap
                      ? "Locking…"
                      : "Exact Spot"}
                </div>

                {/* Luxury Pin Medallion */}
                <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#241205] text-[#ffd88a] shadow-[0_14px_28px_rgba(28,15,5,0.55)] border-2 border-[#ffd88a]">
                  <MapPin size={22} className="text-[#ffd88a]" />
                  <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-[#fffdf9]">
                    <Sparkles className="h-2 w-2 text-white" />
                  </span>
                </div>

                {/* Needle Tip touching (0,0) */}
                <div className="h-3 w-1 bg-gradient-to-b from-[#3a1f0a] to-[#1c0f05] rounded-b-full -mt-0.5" />
              </div>
            </div>

            {/* 3. FLOATING TOP COMMAND & SEARCH BAR (Keyboard-safe on Mobile & Laptop) */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] p-3 sm:p-5">
              <div className="pointer-events-auto mx-auto max-w-3xl rounded-[1.75rem] border border-[#fff4dc]/90 bg-gradient-to-b from-[#fffdf9]/96 via-[#fff5e1]/94 to-[#f7e2b8]/94 p-3.5 sm:p-4 shadow-[0_20px_50px_-12px_rgba(28,15,5,0.4)] backdrop-blur-2xl">
                {/* Brass Top Rail */}
                <div className="pointer-events-none absolute inset-x-10 top-0 h-[2.5px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

                {/* Header Row: Title, Live Coordinates & Cancel */}
                <div className="flex items-center justify-between gap-2.5 mb-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#241205] text-[#ffd88a] shadow-sm ring-1 ring-[#c58a3a]/40">
                      <Compass className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2
                          className="truncate text-base sm:text-lg font-black text-[#2e1808] tracking-tight"
                          style={{ fontFamily: DISPLAY_FONT }}
                        >
                          {title}
                        </h2>
                        <span
                          className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-[#c58a3a]/40 bg-[#fffaf0] px-2.5 py-0.5 text-[10px] font-bold text-[#3a1f0a]"
                          style={{ fontFamily: MONO_FONT }}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          {mapModalLat.toFixed(4)}° N, {mapModalLng.toFixed(4)}° E
                        </span>
                      </div>
                      <p className="truncate text-[11px] font-medium text-[#6b3a12]">
                        Drag the map under the center pin or search a place
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={onClose}
                    className="flex items-center gap-1.5 h-9 px-3.5 rounded-xl border border-[#7a4416]/25 bg-[#fffaf0] text-xs font-bold text-[#3a1f0a] shadow-2xs transition hover:bg-[#fff4dc] active:scale-95 shrink-0"
                    aria-label="Cancel and close map"
                  >
                    <X className="h-3.5 w-3.5 text-[#b8722c]" />
                    <span>Cancel</span>
                  </button>
                </div>

                {/* Search Input & Downward Suggestions */}
                <div ref={searchBoxRef} className="relative w-full">
                  <div
                    className={`flex items-center gap-2.5 rounded-xl border bg-[#fffdf9] px-3.5 h-10 sm:h-11 transition-all duration-200 shadow-inner ${
                      isSearchFocused
                        ? "border-[#3a1f0a] ring-3 ring-[#c58a3a]/25"
                        : "border-[#7a4416]/25 hover:border-[#b8722c]/60"
                    }`}
                  >
                    {isSearching ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#b8722c]" />
                    ) : (
                      <Search className="h-4 w-4 shrink-0 text-[#b8722c]" />
                    )}

                    <Input
                      variant="ghost"
                      value={searchQuery}
                      onFocus={() => setIsSearchFocused(true)}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setIsSearchFocused(true);
                      }}
                      placeholder="Search place, landmark, street, or building..."
                      className="h-full flex-1 border-0 bg-transparent px-0 text-xs sm:text-sm font-semibold text-[#2e1808] placeholder:font-normal placeholder:text-[#7a4416]/50 shadow-none focus-visible:ring-0 outline-none"
                    />

                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery("");
                          setSuggestions([]);
                        }}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-[#3a1f0a]/10 text-[#3a1f0a] hover:bg-[#3a1f0a]/20 active:scale-90 transition-all"
                        aria-label="Clear search query"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>

                  {/* Downward Autocomplete Dropdown */}
                  <AnimatePresence>
                    {showSuggestionsDropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: -6, scale: 0.99 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.99 }}
                        transition={{ duration: 0.15 }}
                        className="absolute left-0 right-0 top-full mt-2 z-[600] max-h-60 overflow-y-auto rounded-2xl border border-[#c58a3a]/45 bg-[#fffdf9]/98 p-1.5 shadow-[0_24px_60px_-12px_rgba(28,15,5,0.5)] backdrop-blur-2xl"
                      >
                        {isSearching ? (
                          <div className="flex items-center justify-center gap-2.5 py-4 text-xs font-semibold text-[#7a4416]">
                            <Loader2 className="h-4 w-4 animate-spin text-[#b8722c]" />
                            <span>Searching matching places…</span>
                          </div>
                        ) : suggestions.length > 0 ? (
                          suggestions.map((item, idx) => {
                            const label =
                              item.properties?.formatted ||
                              item.properties?.name ||
                              "Selected Location";
                            return (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => handleSelectSuggestion(item)}
                                className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-xs font-semibold text-[#2e1808] transition-colors hover:bg-[#fff4dc] active:bg-[#f5e1b8]"
                              >
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#3a1f0a]/10 text-[#b8722c]">
                                  <MapPin size={14} />
                                </span>
                                <span className="truncate flex-1">{label}</span>
                              </button>
                            );
                          })
                        ) : (
                          <div className="py-4 text-center text-xs font-medium text-[#7a4416]/80">
                            No matching locations found. Drag the map to pinpoint directly.
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            {/* 4. FLOATING RIGHT-HAND MAP CONTROLS (GPS Locate, Reset & Custom Zoom) */}
            <div className="pointer-events-none absolute right-3.5 sm:right-5 top-1/2 -translate-y-1/2 z-[450] flex flex-col gap-2">
              <button
                type="button"
                onClick={handleUseCurrentGps}
                disabled={isLocatingGps}
                className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-[#c58a3a]/45 bg-[#fffdf9]/95 text-[#3a1f0a] shadow-xl backdrop-blur-md transition-all hover:bg-[#fff4dc] active:scale-95 disabled:opacity-60"
                title="Re-center to GPS"
                aria-label="Re-center to GPS"
              >
                {isLocatingGps ? (
                  <Loader2 size={18} className="animate-spin text-[#b8722c]" />
                ) : (
                  <Locate size={19} className="text-[#b8722c]" />
                )}
              </button>

              {initialCoords && (
                <button
                  type="button"
                  onClick={() => {
                    panToCoordinates(
                      initialCoords.latitude,
                      initialCoords.longitude,
                      16
                    );
                    void handleMapMoveEnd(
                      initialCoords.latitude,
                      initialCoords.longitude
                    );
                  }}
                  className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-[#7a4416]/25 bg-[#fffdf9]/95 text-[#3a1f0a] shadow-xl backdrop-blur-md transition-all hover:bg-[#fff4dc] active:scale-95"
                  title="Reset to starting pin"
                  aria-label="Reset to starting pin"
                >
                  <RotateCcw size={16} className="text-[#7a4416]" />
                </button>
              )}

              <div className="pointer-events-auto mt-1 flex flex-col overflow-hidden rounded-2xl border border-[#7a4416]/25 bg-[#fffdf9]/95 shadow-xl backdrop-blur-md divide-y divide-[#7a4416]/15">
                <button
                  type="button"
                  onClick={() => handleZoom(1)}
                  className="flex h-10 w-11 items-center justify-center text-[#3a1f0a] hover:bg-[#fff4dc] active:bg-[#f5e1b8] transition-colors"
                  title="Zoom in"
                  aria-label="Zoom in"
                >
                  <Plus size={17} />
                </button>
                <button
                  type="button"
                  onClick={() => handleZoom(-1)}
                  className="flex h-10 w-11 items-center justify-center text-[#3a1f0a] hover:bg-[#fff4dc] active:bg-[#f5e1b8] transition-colors"
                  title="Zoom out"
                  aria-label="Zoom out"
                >
                  <Minus size={17} />
                </button>
              </div>
            </div>

            {/* 5. FLOATING BOTTOM CONFIRMATION DOCK (Locked height so it never jitters) */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[500] p-3 sm:p-5">
              <div className="pointer-events-auto mx-auto max-w-3xl rounded-[1.75rem] border border-[#fff4dc]/90 bg-gradient-to-b from-[#fffdf9]/96 via-[#fff5e1]/95 to-[#f5dfb5]/95 p-3.5 sm:p-4 shadow-[0_-18px_50px_-12px_rgba(28,15,5,0.45)] backdrop-blur-2xl">
                {/* Brass Top Rail */}
                <div className="pointer-events-none absolute inset-x-10 top-0 h-[2.5px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  {/* Fixed-Height Selected Address Card (Never expands or shrinks) */}
                  <div className="flex-1 flex items-center gap-3 rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9] px-3.5 py-2.5 shadow-2xs min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#3a1f0a] to-[#6b3a12] text-[#ffd88a] shadow-xs">
                      <Navigation className="h-4 w-4" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#7a4416]">
                          Selected Address
                        </span>
                        <span
                          className="text-[10px] font-bold text-[#3a1f0a] bg-[#3a1f0a]/10 px-2 py-0.2 rounded-md"
                          style={{ fontFamily: MONO_FONT }}
                        >
                          {mapModalLat.toFixed(4)}, {mapModalLng.toFixed(4)}
                        </span>
                      </div>

                      {/* Locked Height Slot (`h-10`) prevents vertical layout bounce */}
                      <div className="mt-0.5 flex h-10 items-center">
                        {isReverseGeocodingMap ? (
                          <div className="relative w-full overflow-hidden rounded-lg bg-[#3a1f0a]/10 h-4">
                            <div className="uf-skeleton-shimmer absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/70 to-transparent" />
                          </div>
                        ) : (
                          <p
                            className="text-xs sm:text-sm font-black text-[#2e1808] leading-tight line-clamp-2"
                            title={mapModalAddress}
                          >
                            {mapModalAddress || "Move map to select location"}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Primary Confirm CTA Button */}
                  <Button
                    type="button"
                    disabled={isReverseGeocodingMap || isDraggingMap}
                    onClick={handleConfirmSelection}
                    className="group relative h-12 sm:h-14 sm:w-56 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-6 text-sm sm:text-base font-bold text-[#ffe9be] shadow-lg transition-all hover:opacity-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="relative z-10 flex items-center justify-center gap-2">
                      {isReverseGeocodingMap ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin text-[#ffd88a]" />
                          <span>Fetching…</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4 text-[#ffd88a]" />
                          <span>Confirm Location</span>
                        </>
                      )}
                    </span>
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}