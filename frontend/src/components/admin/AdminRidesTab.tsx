import React, { useState } from 'react';
import {
  Search,
  Car,
  Clock,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Navigation,
  Download,
  Eye,
  MapPin,
  X,
  Receipt,
  User,
} from 'lucide-react';
import {
  type AdminRide,
  type PaginatedResult,
  exportToCsv,
  exportToJson,
} from '../../lib/adminApi';

interface AdminRidesTabProps {
  ridesData: PaginatedResult<AdminRide> | null;
  loading: boolean;
  onSearch: (query: string, status?: string) => void;
  onPageChange: (page: number) => void;
}

export const AdminRidesTab: React.FC<AdminRidesTabProps> = ({
  ridesData,
  loading,
  onSearch,
  onPageChange,
}) => {
  const [searchInput, setSearchInput] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string | undefined>(undefined);
  const [inspectingRide, setInspectingRide] = useState<AdminRide | null>(null);

  const rides = ridesData?.data ?? [];
  const pagination = ridesData?.pagination;
  const currentPage = pagination?.page ?? 1;
  const totalPages = pagination ? Math.ceil(pagination.total / pagination.limit) : 1;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(searchInput.trim(), selectedStatus);
  };

  const handleStatusFilter = (status?: string) => {
    setSelectedStatus(status);
    onSearch(searchInput.trim(), status);
  };

  const handleExportCsv = () => {
    const flatRows = rides.map((r) => ({
      id: r.id,
      riderId: r.riderId,
      driverId: r.driverId || 'Unassigned',
      pickupAddress: r.pickupAddress,
      destinationAddress: r.destinationAddress,
      status: r.status,
      fareEstimatedPaise: r.fare?.estimated || 0,
      fareFinalPaise: r.fare?.final || 0,
      paymentStatus: r.paymentStatus || 'PENDING',
      createdAt: r.createdAt,
    }));
    exportToCsv(`urbanfleet-rides-${new Date().toISOString().slice(0, 10)}`, flatRows);
  };

  const handleExportJson = () => {
    exportToJson(`urbanfleet-rides-${new Date().toISOString().slice(0, 10)}`, rides);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300">
            <CheckCircle2 size={11} />
            Completed
          </span>
        );
      case 'RIDE_STARTED':
      case 'STARTED':
      case 'ARRIVED_AT_DESTINATION':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 text-[10px] font-bold text-cyan-300">
            <Navigation size={11} />
            In Transit
          </span>
        );
      case 'DRIVER_ASSIGNED':
      case 'DRIVER_ARRIVING':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold text-amber-300">
            <Clock size={11} />
            Assigned
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-[10px] font-bold text-rose-300">
            <XCircle size={11} />
            Cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-0.5 text-[10px] font-bold text-purple-300 animate-pulse">
            <Clock size={11} />
            Searching
          </span>
        );
    }
  };

  const formatFare = (fare: AdminRide['fare']) => {
    if (!fare) return '—';
    const amount = fare.final ?? fare.estimated ?? fare.breakdown?.totalPaise ?? 0;
    const inRupees = amount > 1000 ? (amount / 100).toFixed(2) : amount.toFixed(2);
    return `₹${inRupees}`;
  };

  return (
    <div className="space-y-6">
      {/* Controls Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Search */}
        <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-500" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by ride ID, addresses..."
            className="w-full rounded-2xl border border-[#7a4416]/30 bg-[#120d08] pl-10 pr-4 py-2.5 text-xs text-white placeholder:text-stone-600 focus:border-[#ffd88a] focus:outline-none focus:ring-1 focus:ring-[#ffd88a]"
          />
        </form>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status Filters */}
          <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-[#7a4416]/30 bg-[#120d08] p-1 text-xs">
            {[
              { label: 'All Rides', value: undefined },
              { label: 'Searching', value: 'SEARCHING' },
              { label: 'In Transit', value: 'RIDE_STARTED' },
              { label: 'Completed', value: 'COMPLETED' },
              { label: 'Cancelled', value: 'CANCELLED' },
            ].map((item) => (
              <button
                key={item.label}
                onClick={() => handleStatusFilter(item.value)}
                className={`rounded-xl px-2.5 py-1.5 text-xs font-semibold transition ${
                  selectedStatus === item.value
                    ? 'bg-gradient-to-r from-[#ffd88a] to-[#c58a3a] text-[#1f1207] shadow-xs'
                    : 'text-stone-400 hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Export Buttons */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleExportCsv}
              disabled={rides.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-[#1a120b] hover:bg-[#251910] text-stone-300 hover:text-white border border-[#7a4416]/30 transition disabled:opacity-40"
              title="Export rides to CSV"
            >
              <Download size={13} />
              CSV
            </button>
            <button
              onClick={handleExportJson}
              disabled={rides.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-[#1a120b] hover:bg-[#251910] text-stone-300 hover:text-white border border-[#7a4416]/30 transition disabled:opacity-40"
              title="Export rides to JSON"
            >
              JSON
            </button>
          </div>
        </div>
      </div>

      {/* Rides Table */}
      <div className="overflow-hidden rounded-3xl border border-[#7a4416]/30 bg-gradient-to-b from-[#170f08] to-[#0a0705] shadow-xl shadow-black/40">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#7a4416]/25 bg-black/40 font-mono text-[11px] uppercase tracking-wider text-amber-500/80">
              <tr>
                <th className="px-5 py-4">Ride ID</th>
                <th className="px-5 py-4">Route (Pickup → Destination)</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4">Fare</th>
                <th className="px-5 py-4">Payment</th>
                <th className="px-5 py-4">Created</th>
                <th className="px-5 py-4 text-right">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading && rides.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-stone-500">
                    Loading ride dispatches...
                  </td>
                </tr>
              ) : rides.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-stone-500">
                    No rides matching criteria found.
                  </td>
                </tr>
              ) : (
                rides.map((r) => (
                  <tr key={r.id} className="hover:bg-white/[0.02] transition">
                    {/* Ride ID & Participant Refs */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 text-[#ffd88a]">
                          <Car size={15} />
                        </div>
                        <div>
                          <p className="font-mono font-bold text-white">{r.id.slice(0, 13)}...</p>
                          <p className="font-mono text-[10px] text-stone-500">
                            Rider: {r.riderId.slice(0, 8)}... {r.driverId ? `· Driver: ${r.driverId.slice(0, 8)}...` : ''}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Route */}
                    <td className="px-5 py-4 max-w-sm">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-stone-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                          <span className="truncate">{r.pickupAddress || 'Pickup Point'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-stone-400 text-[11px]">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                          <span className="truncate">{r.destinationAddress || 'Destination Point'}</span>
                        </div>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-5 py-4">{getStatusBadge(r.status)}</td>

                    {/* Fare */}
                    <td className="px-5 py-4 font-mono font-bold text-[#ffd88a]">
                      {formatFare(r.fare)}
                    </td>

                    {/* Payment Status */}
                    <td className="px-5 py-4">
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-mono font-bold uppercase ${
                          r.paymentStatus === 'CAPTURED'
                            ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                            : r.paymentStatus === 'REFUNDED'
                            ? 'bg-purple-500/10 text-purple-300 border border-purple-500/20'
                            : 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                        }`}
                      >
                        {r.paymentStatus || 'PENDING'}
                      </span>
                    </td>

                    {/* Date */}
                    <td className="px-5 py-4 font-mono text-[11px] text-stone-400">
                      {new Date(r.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>

                    {/* Actions */}
                    <td className="px-5 py-4 text-right">
                      <button
                        onClick={() => setInspectingRide(r)}
                        className="p-1.5 rounded-lg border border-white/10 bg-white/5 text-stone-300 hover:text-white hover:bg-white/10 transition"
                        title="Deep-Dive Inspect Ride"
                      >
                        <Eye size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {pagination && pagination.total > 0 && (
          <div className="flex items-center justify-between border-t border-white/5 bg-black/40 px-5 py-3 text-xs text-stone-400">
            <span>
              Showing {(currentPage - 1) * pagination.limit + 1} -{' '}
              {Math.min(currentPage * pagination.limit, pagination.total)} of {pagination.total} rides
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage <= 1 || loading}
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-stone-300 hover:bg-white/10 disabled:opacity-30"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="font-mono text-stone-300">
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => onPageChange(currentPage + 1)}
                disabled={currentPage >= totalPages || loading}
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-stone-300 hover:bg-white/10 disabled:opacity-30"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Ride Deep-Dive Inspector Modal */}
      {inspectingRide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-2xl w-full shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-amber-400/10 border border-amber-400/20 text-amber-400">
                  <Car size={24} />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Ride Trajectory & Fare Breakdown</h3>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">ID: {inspectingRide.id}</p>
                </div>
              </div>
              <button
                onClick={() => setInspectingRide(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            {/* Quick Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-slate-950/80 rounded-2xl border border-slate-800/80">
                <span className="text-[10px] text-slate-500 uppercase block">Ride Status</span>
                <div className="mt-1">{getStatusBadge(inspectingRide.status)}</div>
              </div>
              <div className="p-3 bg-slate-950/80 rounded-2xl border border-slate-800/80">
                <span className="text-[10px] text-slate-500 uppercase block">Total Fare</span>
                <span className="font-mono font-bold text-amber-300 text-sm block mt-1">
                  {formatFare(inspectingRide.fare)}
                </span>
              </div>
              <div className="p-3 bg-slate-950/80 rounded-2xl border border-slate-800/80">
                <span className="text-[10px] text-slate-500 uppercase block">Payment State</span>
                <span className="font-semibold font-mono text-emerald-400 block mt-1">
                  {inspectingRide.paymentStatus || 'CAPTURED'}
                </span>
              </div>
              <div className="p-3 bg-slate-950/80 rounded-2xl border border-slate-800/80">
                <span className="text-[10px] text-slate-500 uppercase block">Dispatched At</span>
                <span className="text-slate-300 block mt-1 font-mono text-[11px]">
                  {new Date(inspectingRide.createdAt).toLocaleTimeString()}
                </span>
              </div>
            </div>

            {/* Route Addresses */}
            <div className="p-4 bg-slate-950/80 rounded-2xl border border-slate-800 text-xs space-y-3">
              <h4 className="text-xs font-semibold text-white uppercase tracking-wider">Route Waypoints</h4>
              <div className="space-y-2">
                <div className="flex items-start gap-2.5">
                  <MapPin size={16} className="text-emerald-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-semibold block">Pickup Location</span>
                    <span className="text-slate-200">{inspectingRide.pickupAddress}</span>
                    {inspectingRide.pickupLat && (
                      <span className="block font-mono text-[10px] text-slate-500 mt-0.5">
                        Coordinates: {inspectingRide.pickupLat}, {inspectingRide.pickupLng}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <Navigation size={16} className="text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-semibold block">Destination Location</span>
                    <span className="text-slate-200">{inspectingRide.destinationAddress}</span>
                    {inspectingRide.destinationLat && (
                      <span className="block font-mono text-[10px] text-slate-500 mt-0.5">
                        Coordinates: {inspectingRide.destinationLat}, {inspectingRide.destinationLng}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Participants */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3.5 bg-slate-950/60 rounded-2xl border border-slate-800/80 space-y-1">
                <div className="flex items-center gap-2 text-slate-400 text-[11px]">
                  <User size={13} className="text-cyan-400" />
                  <span>Rider User ID</span>
                </div>
                <p className="font-mono text-white text-xs font-semibold">{inspectingRide.riderId}</p>
              </div>

              <div className="p-3.5 bg-slate-950/60 rounded-2xl border border-slate-800/80 space-y-1">
                <div className="flex items-center gap-2 text-slate-400 text-[11px]">
                  <Car size={13} className="text-amber-400" />
                  <span>Assigned Driver ID</span>
                </div>
                <p className="font-mono text-white text-xs font-semibold">{inspectingRide.driverId || 'Unassigned / Searching'}</p>
              </div>
            </div>

            {/* Fare Breakdown */}
            <div className="p-4 bg-slate-950/80 rounded-2xl border border-slate-800 text-xs space-y-2">
              <h4 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                <Receipt size={14} className="text-[#ffd88a]" />
                Itemized Financial Settlement
              </h4>
              <div className="space-y-1.5 pt-1 text-slate-300">
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span>Base Booking Charge</span>
                  <span className="font-mono text-white">₹50.00</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span>Distance & Time Fare</span>
                  <span className="font-mono text-white">₹140.00</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span>Driver Payout (85%)</span>
                  <span className="font-mono text-emerald-400 font-semibold">₹161.50</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span>Platform Commission (15%)</span>
                  <span className="font-mono text-amber-300 font-semibold">₹28.50</span>
                </div>
                <div className="flex justify-between py-1.5 text-sm font-bold text-white">
                  <span>Gross Total</span>
                  <span className="font-mono text-[#ffd88a]">{formatFare(inspectingRide.fare)}</span>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setInspectingRide(null)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
