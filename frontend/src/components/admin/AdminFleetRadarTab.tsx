import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Car,
  Navigation,
  Compass,
  MapPin,
  RefreshCw,
  Search,
  Download,
  AlertCircle,
  ExternalLink,
  Star,
} from 'lucide-react';
import L from 'leaflet';
import { adminApi, type FleetRadarVehicle, exportToCsv, exportToJson } from '../../lib/adminApi';

interface AdminFleetRadarTabProps {
  onSelectRide?: (rideId: string) => void;
}

const CITY_PRESETS = [
  { name: 'Bangalore Metro', lat: 12.9716, lng: 77.5946, zoom: 12 },
  { name: 'Delhi NCR', lat: 28.6139, lng: 77.2090, zoom: 12 },
  { name: 'Mumbai City', lat: 19.0760, lng: 72.8777, zoom: 12 },
  { name: 'Hyderabad', lat: 17.3850, lng: 78.4867, zoom: 12 },
];

export function AdminFleetRadarTab({ onSelectRide }: AdminFleetRadarTabProps) {
  const [vehicles, setVehicles] = useState<FleetRadarVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<FleetRadarVehicle | null>(null);
  const [filterType, setFilterType] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState(CITY_PRESETS[0]);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchFleet = useCallback(async () => {
    // Abort any in-flight previous radar request to prevent stale response overwrites
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setLoading(true);
      setError(null);
      const data = await adminApi.getFleetRadar(controller.signal);
      setVehicles(data);
    } catch (err: unknown) {
      const e = err as { name?: string; code?: string; response?: { data?: { message?: string } }; message?: string };
      if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') {
        return; // Ignore canceled requests
      }
      setError(e?.response?.data?.message || e?.message || 'Failed to load fleet radar positions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFleet();
    const interval = setInterval(() => {
      void fetchFleet();
    }, 15000);

    return () => {
      clearInterval(interval);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchFleet]);

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: false,
      }).setView([selectedCity.lat, selectedCity.lng], selectedCity.zoom);

      // Dark Carto style tiles
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd',
      }).addTo(map);

      // Add Zoom Control top-right
      L.control.zoom({ position: 'topright' }).addTo(map);

      markersLayerRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
    }
  }, []);

  // Update map center when city changes
  useEffect(() => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([selectedCity.lat, selectedCity.lng], selectedCity.zoom, {
        animate: true,
      });
    }
  }, [selectedCity]);

  // Render vehicle markers on map
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current) return;

    markersLayerRef.current.clearLayers();

    const filtered = vehicles.filter((v) => {
      const matchesType = filterType === 'ALL' || v.vehicleType === filterType;
      const matchesStatus = filterStatus === 'ALL' || v.status === filterStatus;
      const matchesSearch =
        !searchQuery ||
        v.driverName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        v.vehiclePlate.toLowerCase().includes(searchQuery.toLowerCase()) ||
        v.vehicleModel.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesType && matchesStatus && matchesSearch;
    });

    filtered.forEach((vehicle) => {
      // Only plot markers for vehicles with active GPS telemetry
      if (!vehicle.hasGpsFix || (vehicle.lat === 0 && vehicle.lng === 0)) {
        return;
      }

      const isSelected = selectedVehicle?.id === vehicle.id;
      const statusColor =
        vehicle.status === 'AVAILABLE'
          ? '#10b981'
          : vehicle.status === 'ON_TRIP'
          ? '#f59e0b'
          : vehicle.status === 'EN_ROUTE_PICKUP'
          ? '#3b82f6'
          : '#6b7280';

      const iconHtml = `
        <div style="position: relative; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer; transform: scale(${isSelected ? 1.25 : 1}); transition: transform 0.2s;">
          <div style="position: absolute; inset: 0; border-radius: 9999px; background: ${statusColor}; opacity: 0.2; animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
          <div style="position: relative; width: 30px; height: 30px; border-radius: 9999px; background: #0f172a; border: 2px solid ${statusColor}; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.6);">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${statusColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C2.1 10.9 2 11.2 2 11.5V16c0 .6.4 1 1 1h2"></path>
              <circle cx="7" cy="17" r="2"></circle>
              <path d="M9 17h6"></path>
              <circle cx="17" cy="17" r="2"></circle>
            </svg>
          </div>
        </div>
      `;

      const customIcon = L.divIcon({
        html: iconHtml,
        className: 'custom-fleet-marker',
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });

      const marker = L.marker([vehicle.lat, vehicle.lng], { icon: customIcon });

      marker.on('click', () => {
        setSelectedVehicle(vehicle);
        if (mapInstanceRef.current) {
          mapInstanceRef.current.panTo([vehicle.lat, vehicle.lng], { animate: true });
        }
      });

      markersLayerRef.current?.addLayer(marker);
    });
  }, [vehicles, filterType, filterStatus, searchQuery, selectedVehicle]);

  const filteredVehicles = vehicles.filter((v) => {
    const matchesType = filterType === 'ALL' || v.vehicleType === filterType;
    const matchesStatus = filterStatus === 'ALL' || v.status === filterStatus;
    const matchesSearch =
      !searchQuery ||
      v.driverName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.vehiclePlate.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.vehicleModel.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesType && matchesStatus && matchesSearch;
  });

  const availableCount = vehicles.filter((v) => v.status === 'AVAILABLE').length;
  const onTripCount = vehicles.filter((v) => v.status === 'ON_TRIP' || v.status === 'EN_ROUTE_PICKUP').length;
  const withGpsCount = vehicles.filter((v) => v.hasGpsFix).length;

  return (
    <div className="space-y-4">
      {/* Top Filter and Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/80 border border-slate-800 p-4 rounded-3xl backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-2">
          {/* City Switcher */}
          <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-2xl p-1">
            <Compass className="w-4 h-4 text-amber-400 ml-2" />
            <select
              value={selectedCity.name}
              onChange={(e) => {
                const found = CITY_PRESETS.find((c) => c.name === e.target.value);
                if (found) setSelectedCity(found);
              }}
              className="bg-transparent text-xs text-white px-2 py-1.5 focus:outline-none rounded-xl"
            >
              {CITY_PRESETS.map((city) => (
                <option key={city.name} value={city.name} className="bg-slate-900 text-white">
                  {city.name}
                </option>
              ))}
            </select>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search driver or plate..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-2xl text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 w-44"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-2xl p-1 text-xs">
            {['ALL', 'AVAILABLE', 'ON_TRIP'].map((st) => (
              <button
                key={st}
                onClick={() => setFilterStatus(st)}
                className={`px-2.5 py-1 rounded-xl transition ${
                  filterStatus === st
                    ? 'bg-amber-400 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {st === 'ALL' ? 'All Status' : st === 'AVAILABLE' ? 'Available' : 'On Trip'}
              </button>
            ))}
          </div>

          {/* Vehicle Type Filter */}
          <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-2xl p-1 text-xs">
            {['ALL', 'SEDAN', 'SUV', 'AUTO'].map((tp) => (
              <button
                key={tp}
                onClick={() => setFilterType(tp)}
                className={`px-2.5 py-1 rounded-xl transition ${
                  filterType === tp
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tp}
              </button>
            ))}
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportToCsv(`fleet-radar-${Date.now()}`, filteredVehicles as unknown as Record<string, unknown>[])}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 transition"
            title="Export CSV"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
          <button
            onClick={() => exportToJson(`fleet-radar-${Date.now()}`, filteredVehicles)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 transition"
            title="Export JSON"
          >
            JSON
          </button>
          <button
            onClick={() => void fetchFleet()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-amber-400 text-slate-950 hover:bg-amber-300 transition shadow-lg shadow-amber-400/10 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Sync Radar
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-4 flex items-center gap-3 text-rose-300 text-xs">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Grid: Map & Vehicle List */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Interactive Map View */}
        <div className="lg:col-span-3 bg-slate-900/60 border border-slate-800 rounded-3xl overflow-hidden relative shadow-2xl h-[620px]">
          <div ref={mapContainerRef} className="w-full h-full" />

          {/* Floating Map Legend */}
          <div className="absolute bottom-4 left-4 z-[1000] bg-slate-950/90 border border-slate-800 rounded-2xl p-3 backdrop-blur-md text-xs space-y-1.5 shadow-xl">
            <div className="font-semibold text-slate-300 text-[11px] uppercase tracking-wider mb-1">Radar Legend</div>
            <div className="flex items-center gap-2 text-slate-300">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 ring-4 ring-emerald-400/20"></span>
              <span>Available ({availableCount})</span>
            </div>
            <div className="flex items-center gap-2 text-slate-300">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 ring-4 ring-amber-400/20"></span>
              <span>En Route / On Trip ({onTripCount})</span>
            </div>
            <div className="flex items-center gap-2 text-slate-400">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-600"></span>
              <span>Live GPS Fix ({withGpsCount}/{vehicles.length})</span>
            </div>
          </div>

          {/* Floating Selected Vehicle Card */}
          {selectedVehicle && (
            <div className="absolute top-4 left-4 z-[1000] w-80 bg-slate-950/95 border border-slate-800 rounded-2xl p-4 backdrop-blur-xl shadow-2xl text-xs space-y-3 animate-in fade-in slide-in-from-top-2">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[11px] font-mono text-amber-400 uppercase tracking-wider">
                    {selectedVehicle.vehicleType} · {selectedVehicle.vehiclePlate}
                  </div>
                  <div className="text-sm font-semibold text-white mt-0.5">{selectedVehicle.driverName}</div>
                </div>
                <button
                  onClick={() => setSelectedVehicle(null)}
                  className="text-slate-500 hover:text-white p-1"
                >
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 py-2 border-y border-slate-800/80">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase">Vehicle</div>
                  <div className="font-medium text-slate-200 truncate">{selectedVehicle.vehicleModel}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 uppercase">GPS Telemetry</div>
                  <div className={`font-medium ${selectedVehicle.hasGpsFix ? 'text-emerald-400' : 'text-stone-500'}`}>
                    {selectedVehicle.hasGpsFix ? `${selectedVehicle.speedKmh} km/h` : 'No Live Fix'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 uppercase">Rating</div>
                  <div className="flex items-center gap-1 font-medium text-amber-400">
                    <Star className="w-3 h-3 fill-amber-400" />
                    {selectedVehicle.rating}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 uppercase">Status</div>
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                      selectedVehicle.status === 'AVAILABLE'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : selectedVehicle.status === 'ON_TRIP'
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-blue-500/20 text-blue-300'
                    }`}
                  >
                    {selectedVehicle.status.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>

              {selectedVehicle.rideId ? (
                <div className="space-y-1.5 pt-1">
                  <div className="text-[10px] text-slate-400 uppercase font-semibold">Active Trip</div>
                  <div className="bg-slate-900/80 rounded-xl p-2.5 border border-slate-800 text-[11px] space-y-1">
                    <div className="flex items-start gap-1.5 text-slate-300 truncate">
                      <MapPin className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <span className="truncate">{selectedVehicle.pickupAddress || 'Pickup address'}</span>
                    </div>
                    <div className="flex items-start gap-1.5 text-slate-300 truncate">
                      <Navigation className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                      <span className="truncate">{selectedVehicle.destinationAddress || 'Destination address'}</span>
                    </div>
                  </div>
                  {onSelectRide && (
                    <button
                      onClick={() => onSelectRide(selectedVehicle.rideId!)}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl bg-amber-400/20 text-amber-300 hover:bg-amber-400/30 border border-amber-400/30 text-xs font-medium transition"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Inspect Trip in Dispatch Tab
                    </button>
                  )}
                </div>
              ) : (
                <div className="text-[11px] text-slate-400 italic">No active dispatch assigned. Cruising for orders.</div>
              )}
            </div>
          )}
        </div>

        {/* Right Sidebar: Live Fleet List */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-4 flex flex-col h-[620px]">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <div className="text-sm font-semibold text-white">Driver Fleet</div>
              <div className="text-xs text-slate-400">{filteredVehicles.length} units listed</div>
            </div>
            <div className="flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              LIVE
            </div>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 mt-3 pr-1">
            {filteredVehicles.map((vehicle) => {
              const isSelected = selectedVehicle?.id === vehicle.id;
              return (
                <div
                  key={vehicle.id}
                  onClick={() => {
                    setSelectedVehicle(vehicle);
                    if (mapInstanceRef.current && vehicle.hasGpsFix && vehicle.lat !== 0 && vehicle.lng !== 0) {
                      mapInstanceRef.current.panTo([vehicle.lat, vehicle.lng], { animate: true });
                    }
                  }}
                  className={`p-3 rounded-2xl border transition cursor-pointer ${
                    isSelected
                      ? 'bg-amber-400/10 border-amber-400/40 text-white'
                      : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700 text-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-xs text-white flex items-center gap-1.5">
                        <Car className="w-3.5 h-3.5 text-amber-400" />
                        {vehicle.driverName}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                        {vehicle.vehiclePlate} · {vehicle.vehicleType}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                          vehicle.status === 'AVAILABLE'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : vehicle.status === 'ON_TRIP'
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-blue-500/20 text-blue-300'
                        }`}
                      >
                        {vehicle.status === 'AVAILABLE' ? 'Available' : 'On Trip'}
                      </span>
                      {!vehicle.hasGpsFix && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-stone-800 text-stone-400 border border-stone-700">
                          No GPS Fix
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2 pt-2 border-t border-slate-800/60 font-mono">
                    <span>{vehicle.vehicleModel}</span>
                    <span className="text-amber-300 font-semibold">{vehicle.rating} ★</span>
                  </div>
                </div>
              );
            })}

            {filteredVehicles.length === 0 && (
              <div className="text-center py-16 text-slate-500 text-xs">
                No vehicles matching current filters.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
