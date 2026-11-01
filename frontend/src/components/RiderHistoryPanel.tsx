import { useCallback, useEffect, useState } from "react";
import {
  History,
  MapPin,
  Clock,
  Route as RouteIcon,
  CheckCircle2,
  XCircle,
  RefreshCw,
  RotateCcw,
  Star,
  Loader2,
  Wallet,
  ArrowUpRight,
} from "lucide-react";
import { appApi } from "../lib/api";
import { Button } from "./ui/button";
import { formatFare, formatDistance, formatDuration } from "../lib/formatters";
import type { Coordinates } from "../types/location";
import type { RideDto as Ride } from "../types/ride";

interface RiderHistoryPanelProps {
  compact?: boolean;
  onRebook?: (
    pickup: string,
    destination: string,
    pickupCoords?: Coordinates,
    destinationCoords?: Coordinates
  ) => void;
  onExpandView?: () => void;
}

export default function RiderHistoryPanel({
  compact = false,
  onRebook,
  onExpandView,
}: RiderHistoryPanelProps) {
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"ALL" | "COMPLETED" | "CANCELLED">("ALL");

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const response = await appApi
        .get<{ success: boolean; data: Ride[] | { rides?: Ride[] } }>("/rides/history")
        .catch(() =>
          appApi
            .get<{ success: boolean; data: Ride[] | { rides?: Ride[] } }>("/ride/history")
            .catch(() =>
              appApi.get<{ success: boolean; data: Ride[] | { rides?: Ride[] } }>(
                "/ride/rider/history"
              )
            )
        );

      const rawData = response?.data?.data;
      const list = Array.isArray(rawData)
        ? rawData
        : Array.isArray(rawData?.rides)
          ? rawData.rides
          : [];
      setRides(list);
    } catch (err) {
      console.error("Failed to load rider history:", err);
      setRides([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  const filteredRides = rides.filter((r) => filter === "ALL" || r.status === filter);
  const displayedRides = compact ? filteredRides.slice(0, 4) : filteredRides;

  const completedRides = rides.filter((r) => r.status === "COMPLETED");
  const totalSpentPaise = completedRides.reduce(
    (acc, r) => acc + (r.fare?.final ?? r.fare?.estimated ?? 0),
    0
  );
  const totalDistanceRaw = completedRides.reduce(
    (acc, r) => acc + (r.distance?.actual ?? r.distance?.estimated ?? 0),
    0
  );

  // Full Shimmer Skeleton While Loading (Prevents 0 / ₹0.00 / 0 km Flash)
  if (loading) {
    return (
      <div className="w-full space-y-5 animate-in fade-in duration-200">
        {!compact && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, idx) => (
              <div
                key={idx}
                className="relative overflow-hidden rounded-[1.75rem] border border-[#c58a3a]/30 bg-gradient-to-br from-[#fffdf9]/90 via-[#fff4dc]/85 to-[#f7e2b8]/85 p-5 shadow-md backdrop-blur-xl"
              >
                <div className="uf-skeleton-shimmer pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent" />
                <div className="flex items-center justify-between">
                  <div className="h-3 w-28 rounded-md bg-[#7a4416]/15" />
                  <div className="h-10 w-10 rounded-2xl bg-[#3a1f0a]/15" />
                </div>
                <div className="mt-4 h-7 w-24 rounded-lg bg-[#3a1f0a]/20" />
                <div className="mt-2 h-3 w-32 rounded-md bg-[#7a4416]/15" />
              </div>
            ))}
          </div>
        )}

        <div
          className={`relative overflow-hidden rounded-[2.25rem] border border-[#fff4dc]/85 bg-gradient-to-b from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 shadow-xl backdrop-blur-2xl ${
            compact ? "p-5 sm:p-6" : "p-6 sm:p-8"
          }`}
        >
          <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
          <div className="flex items-center justify-between gap-3 border-b border-[#7a4416]/15 pb-4 mb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] to-[#6b3a12] text-[#ffd88a] shadow-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
              <div>
                <h3
                  className={`${compact ? "text-base" : "text-lg"} font-black text-[#2e1808]`}
                  style={{ fontFamily: "'Fraunces', Georgia, serif" }}
                >
                  Synchronizing Travel Ledger…
                </h3>
                <p className="text-[11px] font-medium text-[#7a4416]">
                  Loading past trips, fare receipts, and route coordinates.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {Array.from({ length: compact ? 2 : 3 }).map((_, idx) => (
              <div
                key={idx}
                className="relative overflow-hidden rounded-2xl border border-[#7a4416]/15 bg-[#fffdf9]/90 p-4 shadow-2xs"
              >
                <div className="uf-skeleton-shimmer pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-[#fff4dc]/80 to-transparent" />
                <div className="flex items-center justify-between border-b border-[#7a4416]/10 pb-2.5 mb-3">
                  <div className="h-4 w-28 rounded-md bg-[#3a1f0a]/15" />
                  <div className="h-4 w-20 rounded-full bg-[#3a1f0a]/15" />
                </div>
                <div className="space-y-2">
                  <div className="h-3.5 w-4/5 rounded-md bg-[#3a1f0a]/15" />
                  <div className="h-3.5 w-3/5 rounded-md bg-[#7a4416]/15" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-5 animate-in fade-in duration-200">
      {/* Full-View Summary KPIs (Only rendered after data has loaded) */}
      {!compact && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-[1.75rem] border border-[#c58a3a]/35 bg-gradient-to-br from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-5 shadow-lg backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#7a4416]">
                Completed Journeys
              </span>
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-950/15 text-emerald-800 border border-emerald-600/25">
                <CheckCircle2 className="h-5 w-5" />
              </div>
            </div>
            <p className="mt-3 text-2xl font-black text-[#2e1808] console-readout">
              {completedRides.length}
            </p>
            <p className="mt-1 text-xs font-medium text-[#6b3a12]">
              Out of {rides.length} total bookings
            </p>
          </div>

          <div className="rounded-[1.75rem] border border-[#c58a3a]/35 bg-gradient-to-br from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-5 shadow-lg backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#7a4416]">
                Total Spend
              </span>
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-950/15 text-amber-800 border border-amber-600/25">
                <Wallet className="h-5 w-5" />
              </div>
            </div>
            <p className="mt-3 text-2xl font-black text-[#2e1808] console-readout">
              {formatFare(totalSpentPaise)}
            </p>
            <p className="mt-1 text-xs font-medium text-[#6b3a12]">Verified settled fares</p>
          </div>

          <div className="rounded-[1.75rem] border border-[#c58a3a]/35 bg-gradient-to-br from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-5 shadow-lg backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#7a4416]">
                Distance Traveled
              </span>
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#3a1f0a] text-[#ffd88a]">
                <RouteIcon className="h-5 w-5" />
              </div>
            </div>
            <p className="mt-3 text-2xl font-black text-[#2e1808] console-readout">
              {formatDistance(totalDistanceRaw)}
            </p>
            <p className="mt-1 text-xs font-medium text-[#6b3a12]">Across urban transit routes</p>
          </div>
        </div>
      )}

      {/* Main History List Container */}
      <div
        className={`relative overflow-hidden rounded-[2.25rem] border border-[#fff4dc]/85 bg-gradient-to-b from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 shadow-xl backdrop-blur-2xl ${
          compact ? "p-5 sm:p-6" : "p-6 sm:p-8"
        }`}
      >
        <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

        {/* Header & Filter Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#7a4416]/15 pb-4 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-[#b8722c]" />
              <h3
                className={`${compact ? "text-base" : "text-xl"} font-black text-[#2e1808]`}
                style={{ fontFamily: "'Fraunces', Georgia, serif" }}
              >
                {compact ? "Recent Journeys" : "Passenger Ride History & Receipts"}
              </h3>
            </div>
            <p className="text-[11px] font-medium text-[#7a4416] mt-0.5">
              {compact
                ? "One-click rebooking for your frequent routes."
                : "Complete log of your past trips, fares, and driver ratings."}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            {(["ALL", "COMPLETED", "CANCELLED"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition-all ${
                  filter === tab
                    ? "bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] text-[#ffd88a] shadow-2xs"
                    : "border border-[#7a4416]/20 bg-[#fffaf0] text-[#6b3a12] hover:bg-[#fff4dc]"
                }`}
              >
                {tab === "ALL" ? "All" : tab === "COMPLETED" ? "Done" : "Void"}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void fetchHistory()}
              disabled={loading}
              className="grid h-7 w-7 place-items-center rounded-xl border border-[#7a4416]/20 bg-[#fffaf0] text-[#3a1f0a] hover:bg-[#fff4dc] active:scale-95 transition-all"
              title="Refresh history"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-[#b8722c] ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Ride Cards */}
        {displayedRides.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#7a4416]/25 bg-[#fffaf0]/60 p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#3a1f0a]/10 text-[#7a4416]">
              <History className="h-6 w-6" />
            </div>
            <p
              className="mt-3 text-sm font-bold text-[#2e1808]"
              style={{ fontFamily: "'Fraunces', Georgia, serif" }}
            >
              No matching trips found
            </p>
            <p className="mt-1 text-xs text-[#7a4416] max-w-xs mx-auto">
              Book your first luxury ride on the dispatch ticket to start building your travel log.
            </p>
          </div>
        ) : (
          <div
            className={`space-y-3 ${
              compact ? "max-h-[370px] overflow-y-auto pr-1 rd-scroll-fade" : ""
            }`}
          >
            {displayedRides.map((ride) => {
              const isCompleted = ride.status === "COMPLETED";
              const isCancelled = ride.status === "CANCELLED";
              const farePaise = ride.fare?.final ?? ride.fare?.estimated ?? 0;

              return (
                <div
                  key={ride.id}
                  className="group rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9]/95 p-4 shadow-2xs transition-all hover:border-[#b8722c]/60 hover:shadow-md"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-[#7a4416]/10 pb-2.5 mb-3">
                    <div className="flex items-center gap-2">
                      <span className="console-readout text-[11px] font-bold text-[#3a1f0a] bg-[#3a1f0a]/10 px-2 py-0.5 rounded-md">
                        #{ride.id.slice(-6)}
                      </span>
                      <span className="text-[11px] font-medium text-[#6b3a12]">
                        {ride.createdAt
                          ? new Date(ride.createdAt).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "Date unavailable"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="console-readout text-xs font-black text-[#2e1808]">
                        {formatFare(farePaise)}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          isCompleted
                            ? "bg-emerald-950/15 text-emerald-900 border border-emerald-500/30"
                            : isCancelled
                              ? "bg-rose-950/15 text-rose-900 border border-rose-500/30"
                              : "bg-amber-950/15 text-amber-900 border border-amber-500/30"
                        }`}
                      >
                        {isCompleted ? (
                          <CheckCircle2 className="h-3 w-3 text-emerald-700" />
                        ) : (
                          <XCircle className="h-3 w-3 text-rose-700" />
                        )}
                        {ride.status}
                      </span>
                    </div>
                  </div>

                  {/* Pickup & Destination */}
                  <div className="space-y-2 text-xs">
                    <div className="flex items-start gap-2.5">
                      <span className="mt-1 h-2 w-2 rounded-full bg-emerald-600 shrink-0" />
                      <p className="font-semibold text-[#2e1808] line-clamp-1">
                        {ride.pickup?.address}
                      </p>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 text-[#b8722c] shrink-0" />
                      <p className="font-semibold text-[#2e1808] line-clamp-1">
                        {ride.destination?.address}
                      </p>
                    </div>
                  </div>

                  {/* Footer Actions */}
                  <div className="mt-3 pt-2.5 border-t border-[#7a4416]/10 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 text-[11px] text-[#7a4416] console-readout font-semibold">
                      <span className="flex items-center gap-1">
                        <RouteIcon className="h-3 w-3 text-[#b8722c]" />{" "}
                        {formatDistance(ride.distance)}
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-[#b8722c]" />{" "}
                        {formatDuration(ride.duration)}
                      </span>
                      {ride.ratings?.[0]?.score && (
                        <>
                          <span>•</span>
                          <span className="flex items-center gap-0.5 text-amber-600 font-bold">
                            <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                            {ride.ratings[0].score}.0
                          </span>
                        </>
                      )}
                    </div>

                    {onRebook && (
                      <button
                        type="button"
                        onClick={() =>
                          onRebook(
                            ride.pickup.address,
                            ride.destination.address,
                            ride.pickup.coordinates,
                            ride.destination.coordinates
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-xl border border-[#c58a3a]/40 bg-[#fffaf0] px-2.5 py-1 text-[11px] font-bold text-[#3a1f0a] shadow-2xs hover:bg-[#3a1f0a] hover:text-[#ffd88a] active:scale-95 transition-all"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Rebook
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Compact Footer Expander */}
        {compact && onExpandView && rides.length > 0 && (
          <div className="mt-4 pt-3 border-t border-[#7a4416]/15 flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onExpandView}
              className="w-full rounded-xl border-[#7a4416]/25 bg-[#fffaf0] text-xs font-bold text-[#3a1f0a] hover:bg-[#fff4dc]"
            >
              View Full Ride History ({rides.length})
              <ArrowUpRight className="ml-1.5 h-3.5 w-3.5 text-[#b8722c]" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}