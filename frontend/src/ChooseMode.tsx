import MapView from './components/MapView';
import { useState, useEffect } from 'react';
import { useNavigate } from "react-router-dom";
import { appApi } from './apiInterceptor';
import { Button } from './components/ui/button';
import { Bike, Car, Clock, IndianRupee, Check, Loader2, Sparkles, ArrowLeft } from 'lucide-react';
import { useAuthContext } from "./context/auth-context";
import LoadingScreen from './components/LoadingScreen';
import { getGeoapifyRouteLines, isGeoapifyFeatureCollection } from './types/geoapify';
import CityMapBackground from './components/CityMapBackground';

interface PendingRide {
    pickup: string;
    destination: string;
    pickupCoords: { latitude: number; longitude: number };
    destinationCoords: { latitude: number; longitude: number };
    routeDistance: number | null;
    routeDuration: number | null;
}

function parsePendingRide(value: unknown): PendingRide | null {
    if (!value || typeof value !== "object") return null;
    const data = value as Record<string, unknown>;
    const pickupCoords = data.pickupCoords;
    const destinationCoords = data.destinationCoords;
    if (
        typeof data.pickup !== "string" ||
        typeof data.destination !== "string" ||
        !pickupCoords || typeof pickupCoords !== "object" ||
        !destinationCoords || typeof destinationCoords !== "object"
    ) return null;

    const pickup = pickupCoords as Record<string, unknown>;
    const destination = destinationCoords as Record<string, unknown>;
    if (
        typeof pickup.latitude !== "number" || typeof pickup.longitude !== "number" ||
        typeof destination.latitude !== "number" || typeof destination.longitude !== "number"
    ) return null;

    return {
        pickup: data.pickup,
        destination: data.destination,
        pickupCoords: { latitude: pickup.latitude, longitude: pickup.longitude },
        destinationCoords: { latitude: destination.latitude, longitude: destination.longitude },
        routeDistance: typeof data.routeDistance === "number" ? data.routeDistance : null,
        routeDuration: typeof data.routeDuration === "number" ? data.routeDuration : null,
    };
}

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

const DISPLAY_FONT = "'Fraunces', Georgia, serif";
const BODY_FONT = "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif";

function formatPaiseToRupee(amount: number | null | undefined): string {
    if (amount == null) return "0.00";
    const rupees = amount > 1000 ? amount / 100 : amount; 
    return rupees.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ChooseMode() {
    const navigate = useNavigate();
    const { user } = useAuthContext();

    const [routePolyline, setRoutePolyline] = useState<[number, number][]>([]);
    const [rideData] = useState<PendingRide | null>(() => {
        const savedData = sessionStorage.getItem("pendingRide");
        if (!savedData) return null;
        try {
            return parsePendingRide(JSON.parse(savedData));
        } catch {
            return null;
        }
    });
    const [error, setError] = useState(rideData ? "" : "No route details found. Please start over.");
    const [isLoading, setIsLoading] = useState(Boolean(rideData));
    const [isCreatingRide, setIsCreatingRide] = useState(false);
    const [selectedMode, setSelectedMode] = useState<"bike" | "auto" | "car">("car");

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
                if (!cancelled) setError("Unable to load route polyline.");
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [rideData]);

    const handleConfirmAndStart = async () => {
        if (!rideData) return;
        setIsCreatingRide(true);
        try {
            const distanceKm = rideData.routeDistance ? Number((rideData.routeDistance / 1000).toFixed(3)) : 5;
            const selectedMultiplier = RIDE_MODES.find((mode) => mode.id === selectedMode)?.multiplier ?? 1.2;
            const calculatedFare = Math.round((2500 + Math.round(distanceKm * 500) + 400) * selectedMultiplier);

            const response = await appApi.post<{ message: string; ride: { _id?: string; id?: string } }>("/ride", {
                rider: user?._id || user?.id,
                vehicleType: selectedMode,
                pickup: { address: rideData.pickup, coordinates: rideData.pickupCoords },
                destination: { address: rideData.destination, coordinates: rideData.destinationCoords },
                fare: { estimated: calculatedFare },
                distance: { estimated: distanceKm },
                duration: { estimated: rideData.routeDuration ? Math.round(rideData.routeDuration/60) : 14 },
            });

            sessionStorage.removeItem("pendingRide");
            const targetRideId = response.data.ride?._id || response.data.ride?.id;
            navigate(`/ride/${targetRideId}`, { replace: true });
        } catch (err: any) {
            const serverMessage =
                err?.response?.data?.message ||
                (err?.response?.data?.errors?.rider && err.response.data.errors.rider[0]);
            setError(serverMessage || "Unable to create ride request. Please try again.");
            setIsCreatingRide(false);
        }
    };

    if (isLoading) {
        return <LoadingScreen sublabel="Preparing your journey options..." />;
    }

    if (!rideData || error) {
        return (
            <div 
                className="relative grid min-h-screen place-items-center bg-[#f5e6c8] px-6 text-center text-[#2e1808]"
                style={{ fontFamily: BODY_FONT }}
            >
                <CityMapBackground />
                <div className="relative z-10 w-full max-w-lg rounded-[2.5rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-8 shadow-2xl backdrop-blur-2xl">
                    <p className="text-lg font-semibold text-[#3a1f0a]">{error || "Invalid session data"}</p>
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

    const distanceKm = rideData.routeDistance ? Number((rideData.routeDistance / 1000).toFixed(3)) : 5;
    const baseFareValue = 2500 + Math.round(distanceKm * 500) + 400;

    return (
        <div 
            className="relative h-screen w-screen overflow-hidden bg-[#f5e6c8] text-[#2e1808]"
            style={{ fontFamily: BODY_FONT }}
        >
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,500&family=Inter:wght@400;500;600;700&display=swap');
            `}</style>

            {/* UPPER MAP VIEW (Takes upper 50% of screen height) */}
            <div className="absolute inset-x-0 top-0 z-0 h-[50vh] w-full">
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
                    path={
                        routePolyline.length > 0
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
                              ]
                    }
                />
            </div>

            {/* FLOATING BACK BUTTON */}
            <div className="absolute top-5 left-5 z-30">
                <button
                    onClick={() => navigate("/dashboard")}
                    className="grid h-12 w-12 place-items-center rounded-2xl border border-[#7a4416]/25 bg-[#fffaf0]/95 text-[#3a1f0a] shadow-xl backdrop-blur-xl transition hover:bg-[#fff4dc] hover:scale-105 active:scale-95"
                    aria-label="Back"
                >
                    <ArrowLeft className="h-5 w-5 text-[#b8722c]" />
                </button>
            </div>

            {/* BOTTOM TICKET PANEL WITH VEHICLE MODE OPTIONS */}
            <div
                className="absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-[2.5rem] border-t border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/95 to-[#f7e2b8]/95 px-6 pt-5 pb-8 shadow-[0_-20px_60px_rgba(58,31,10,0.3)] backdrop-blur-2xl max-h-[55vh] overflow-y-auto w-full"
            >
                {/* Brass top rail */}
                <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

                <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-[#7a4416]/30" />

                <div className="flex items-center justify-between mb-4">
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#7a4416]">
                            Select Ride Category
                        </p>
                        <h2 
                            className="text-2xl font-bold tracking-tight text-[#2e1808]"
                            style={{ fontFamily: DISPLAY_FONT }}
                        >
                            Choose your ride mode
                        </h2>
                    </div>
                </div>

                {/* THREE OPTIONS (BIKE, AUTO, CAR) */}
                <div className="space-y-3 w-full">
                    {RIDE_MODES.map((mode) => {
                        const isSelected = selectedMode === mode.id;
                        const calculatedFare = Math.round(baseFareValue * mode.multiplier);

                        return (
                            <div
                                key={mode.id}
                                onClick={() => setSelectedMode(mode.id)}
                                className={`w-full flex cursor-pointer items-center justify-between rounded-2xl border p-4 transition-all active:scale-[0.98] ${
                                    isSelected
                                        ? "border-[#b8722c] bg-[#fffaf0] shadow-lg ring-2 ring-[#b8722c]/20"
                                        : "border-[#7a4416]/20 bg-[#fffaf0]/80 hover:bg-[#fffaf0] hover:border-[#b8722c]/60"
                                }`}
                            >
                                <div className="flex items-center gap-3.5">
                                    <div className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffd88a] shadow-sm border border-[#c58a3a]/40">
                                        {mode.icon}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-[#2e1808]">{mode.name}</span>
                                            {isSelected && (
                                                <span className="grid h-4 w-4 place-items-center rounded-full bg-[#b8722c] text-white">
                                                    <Check className="h-2.5 w-2.5" />
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-0.5 flex items-center gap-2 text-xs font-medium text-[#6b3a12]">
                                            <span>{mode.description}</span>
                                            <span>•</span>
                                            <span className="flex items-center gap-1 font-semibold text-emerald-900 bg-emerald-500/15 px-2 py-0.5 rounded-full border border-emerald-500/30">
                                                <Clock className="h-3 w-3 text-emerald-800" />
                                                {mode.etaMinutes} mins away
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="text-right">
                                    <p className="text-base font-extrabold text-[#2e1808] flex items-center justify-end">
                                        <IndianRupee className="h-3.5 w-3.5 mr-0.5 text-[#b8722c]" />
                                        {formatPaiseToRupee(calculatedFare)}
                                    </p>
                                    <p className="text-[10px] uppercase font-semibold text-[#7a4416]">Estimated</p>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* CONFIRM & START RIDE BUTTON */}
                <div className="mt-6 w-full">
                    <Button
                        onClick={handleConfirmAndStart}
                        disabled={isCreatingRide}
                        className="group relative w-full h-14 overflow-hidden rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-base font-semibold text-[#ffe9be] shadow-[0_18px_40px_-12px_rgba(58,31,10,0.7),inset_0_1px_0_rgba(255,216,138,0.35)] transition-all hover:opacity-95 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <span className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-[#c58a3a]/40" />
                        <span className="relative z-10 flex items-center justify-center gap-2">
                            {isCreatingRide ? (
                                <>
                                    <Loader2 className="h-5 w-5 animate-spin text-[#ffd88a]" />
                                    <span>Matching with drivers...</span>
                                </>
                            ) : (
                                "Confirm & Start Ride"
                            )}
                        </span>
                    </Button>
                </div>
            </div>
        </div>
    );
}