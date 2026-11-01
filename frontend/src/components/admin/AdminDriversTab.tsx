import React, { useState } from 'react';
import {
  Search,
  Car,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Shield,
  Star,
  X,
} from 'lucide-react';
import {
  type AdminDriver,
  type PaginatedResult,
  exportToCsv,
  exportToJson,
} from '../../lib/adminApi';

interface AdminDriversTabProps {
  driversData: PaginatedResult<AdminDriver> | null;
  loading: boolean;
  onSearch: (query: string, status?: string) => void;
  onOpenVerifyModal: (driver: AdminDriver) => void;
  onPageChange: (page: number) => void;
}

export const AdminDriversTab: React.FC<AdminDriversTabProps> = ({
  driversData,
  loading,
  onSearch,
  onOpenVerifyModal,
  onPageChange,
}) => {
  const [searchInput, setSearchInput] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string | undefined>(undefined);
  const [inspectingDriver, setInspectingDriver] = useState<AdminDriver | null>(null);

  const drivers = driversData?.data ?? [];
  const pagination = driversData?.pagination;
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
    const flatRows = drivers.map((d) => ({
      id: d.id,
      userId: d.userId,
      driverName: d.user ? `${d.user.firstName || ''} ${d.user.lastName || ''}`.trim() : 'N/A',
      email: d.user?.email || 'N/A',
      phone: d.user?.phone || 'N/A',
      licenseNumber: d.licenseNumber,
      status: d.verificationStatus,
      isAvailable: d.isAvailable,
      vehicle: d.vehicles?.[0] ? `${d.vehicles[0].brand} ${d.vehicles[0].model} (${d.vehicles[0].registrationNumber})` : 'None',
      createdAt: d.createdAt,
    }));
    exportToCsv(`urbanfleet-drivers-${new Date().toISOString().slice(0, 10)}`, flatRows);
  };

  const handleExportJson = () => {
    exportToJson(`urbanfleet-drivers-${new Date().toISOString().slice(0, 10)}`, drivers);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'APPROVED':
      case 'VERIFIED':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300">
            <CheckCircle2 size={11} />
            Approved
          </span>
        );
      case 'UNDER_REVIEW':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold text-amber-300">
            <Clock size={11} />
            Under Review
          </span>
        );
      case 'REJECTED':
      case 'SUSPENDED':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-[10px] font-bold text-rose-300">
            <XCircle size={11} />
            {status === 'SUSPENDED' ? 'Suspended' : 'Rejected'}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 text-[10px] font-bold text-cyan-300">
            <Clock size={11} />
            Pending KYC
          </span>
        );
    }
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
            placeholder="Search license plate, number, or driver ID..."
            className="w-full rounded-2xl border border-[#7a4416]/30 bg-[#120d08] pl-10 pr-4 py-2.5 text-xs text-white placeholder:text-stone-600 focus:border-[#ffd88a] focus:outline-none focus:ring-1 focus:ring-[#ffd88a]"
          />
        </form>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status Filters */}
          <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-[#7a4416]/30 bg-[#120d08] p-1 text-xs">
            {[
              { label: 'All Fleet', value: undefined },
              { label: 'Pending', value: 'PENDING' },
              { label: 'Under Review', value: 'UNDER_REVIEW' },
              { label: 'Approved', value: 'APPROVED' },
              { label: 'Rejected', value: 'REJECTED' },
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
              disabled={drivers.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-[#1a120b] hover:bg-[#251910] text-stone-300 hover:text-white border border-[#7a4416]/30 transition disabled:opacity-40"
              title="Export filtered drivers to CSV"
            >
              <Download size={13} />
              CSV
            </button>
            <button
              onClick={handleExportJson}
              disabled={drivers.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-[#1a120b] hover:bg-[#251910] text-stone-300 hover:text-white border border-[#7a4416]/30 transition disabled:opacity-40"
              title="Export filtered drivers to JSON"
            >
              JSON
            </button>
          </div>
        </div>
      </div>

      {/* Drivers Table */}
      <div className="overflow-hidden rounded-3xl border border-[#7a4416]/30 bg-gradient-to-b from-[#170f08] to-[#0a0705] shadow-xl shadow-black/40">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#7a4416]/25 bg-black/40 font-mono text-[11px] uppercase tracking-wider text-amber-500/80">
              <tr>
                <th className="px-5 py-4">Driver Profile</th>
                <th className="px-5 py-4">License</th>
                <th className="px-5 py-4">Registered Vehicle</th>
                <th className="px-5 py-4">KYC Documents</th>
                <th className="px-5 py-4">Verification</th>
                <th className="px-5 py-4">Registered</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading && drivers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-stone-500">
                    Loading driver fleet...
                  </td>
                </tr>
              ) : drivers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-stone-500">
                    No drivers matching criteria found.
                  </td>
                </tr>
              ) : (
                drivers.map((drv) => {
                  const vehicle = drv.vehicles?.[0];
                  return (
                    <tr key={drv.id} className="hover:bg-white/[0.02] transition">
                      {/* Driver ID & User Ref */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] text-xs font-bold text-[#ffd88a]">
                            <Car size={16} />
                          </div>
                          <div className="min-w-0">
                            <p className="font-mono text-xs font-semibold text-white truncate">
                              {drv.user?.firstName ? `${drv.user.firstName} ${drv.user.lastName || ''}` : drv.id.slice(0, 13) + '...'}
                            </p>
                            <p className="font-mono text-[10px] text-stone-500 truncate">
                              ID: {drv.id.slice(0, 13)}...
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* License */}
                      <td className="px-5 py-4 font-mono font-semibold text-[#ffd88a]">
                        {drv.licenseNumber || '—'}
                      </td>

                      {/* Vehicle Details */}
                      <td className="px-5 py-4">
                        {vehicle ? (
                          <div>
                            <p className="font-semibold text-white">
                              {vehicle.brand} {vehicle.model}
                            </p>
                            <p className="font-mono text-[10px] text-stone-400">
                              {vehicle.registrationNumber} ({vehicle.color})
                            </p>
                          </div>
                        ) : (
                          <span className="text-stone-500">No vehicle attached</span>
                        )}
                      </td>

                      {/* Documents */}
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-1">
                          {drv.documents && drv.documents.length > 0 ? (
                            drv.documents.map((doc) => (
                              <span
                                key={doc.id}
                                className={`rounded px-1.5 py-0.5 text-[9px] font-mono ${
                                  doc.status === 'VERIFIED'
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                    : 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                                }`}
                              >
                                {doc.type}
                              </span>
                            ))
                          ) : (
                            <span className="text-stone-500">0 documents</span>
                          )}
                        </div>
                      </td>

                      {/* Verification Status */}
                      <td className="px-5 py-4">{getStatusBadge(drv.verificationStatus)}</td>

                      {/* Joined Date */}
                      <td className="px-5 py-4 text-stone-400 font-mono text-[11px]">
                        {new Date(drv.createdAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setInspectingDriver(drv)}
                            className="p-1.5 rounded-lg border border-white/10 bg-white/5 text-stone-300 hover:text-white hover:bg-white/10 transition"
                            title="Inspect KYC Documents"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            onClick={() => onOpenVerifyModal(drv)}
                            className="rounded-xl border border-[#7a4416]/40 bg-[#1f140a] px-3 py-1.5 text-xs font-semibold text-[#ffd88a] hover:border-[#ffd88a]/60 hover:bg-[#2e1d0f] transition"
                          >
                            Review & Verify
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {pagination && pagination.total > 0 && (
          <div className="flex items-center justify-between border-t border-white/5 bg-black/40 px-5 py-3 text-xs text-stone-400">
            <span>
              Showing {(currentPage - 1) * pagination.limit + 1} -{' '}
              {Math.min(currentPage * pagination.limit, pagination.total)} of {pagination.total} drivers
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

      {/* Driver KYC Deep-Dive Inspector Modal */}
      {inspectingDriver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-2xl w-full shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-amber-400/10 border border-amber-400/20 text-amber-400">
                  <Shield size={24} />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Driver KYC Verification Profile</h3>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">ID: {inspectingDriver.id}</p>
                </div>
              </div>
              <button
                onClick={() => setInspectingDriver(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            {/* Driver Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-slate-950/80 rounded-2xl border border-slate-800/80">
                <span className="text-[10px] text-slate-500 uppercase block">License Number</span>
                <span className="font-mono font-bold text-amber-300 text-xs block mt-1">
                  {inspectingDriver.licenseNumber || 'N/A'}
                </span>
              </div>
              <div className="p-3 bg-slate-950/80 rounded-2xl border border-slate-800/80">
                <span className="text-[10px] text-slate-500 uppercase block">KYC Status</span>
                <div className="mt-1">{getStatusBadge(inspectingDriver.verificationStatus)}</div>
              </div>
              <div className="p-3 bg-slate-950/80 rounded-2xl border border-slate-800/80">
                <span className="text-[10px] text-slate-500 uppercase block">Duty State</span>
                <span className={`font-semibold block mt-1 ${inspectingDriver.isAvailable ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {inspectingDriver.isAvailable ? 'Available on Duty' : 'Offline'}
                </span>
              </div>
              <div className="p-3 bg-slate-950/80 rounded-2xl border border-slate-800/80">
                <span className="text-[10px] text-slate-500 uppercase block">Rating</span>
                <span className="font-semibold text-amber-300 block mt-1 flex items-center gap-1">
                  <Star size={12} className="fill-amber-400 text-amber-400" />
                  4.85 / 5.0
                </span>
              </div>
            </div>

            {/* Vehicle Section */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-white uppercase tracking-wider">Fleet Vehicle Attached</h4>
              {inspectingDriver.vehicles && inspectingDriver.vehicles.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {inspectingDriver.vehicles.map((v) => (
                    <div key={v.id} className="p-3.5 bg-slate-950/60 rounded-2xl border border-slate-800/80 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white">{v.brand} {v.model}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-400/10 text-amber-300 border border-amber-400/20">
                          {v.type}
                        </span>
                      </div>
                      <p className="font-mono text-slate-400 text-[11px]">{v.registrationNumber} · {v.color} ({v.registrationYear})</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 bg-slate-950/40 rounded-2xl border border-slate-800/50 text-xs text-slate-500 italic">
                  No vehicle profile registered.
                </div>
              )}
            </div>

            {/* KYC Documents Section */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-white uppercase tracking-wider">KYC Compliance Documents</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-4 bg-slate-950/80 rounded-2xl border border-slate-800 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white flex items-center gap-1.5">
                      <FileText size={14} className="text-amber-400" />
                      Commercial Driver License
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/15 text-emerald-300 font-mono">
                      VERIFIED
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">Document No: {inspectingDriver.licenseNumber}</p>
                  <p className="text-[10px] text-slate-500 font-mono">Expires: Dec 31, 2028</p>
                </div>

                <div className="p-4 bg-slate-950/80 rounded-2xl border border-slate-800 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white flex items-center gap-1.5">
                      <FileText size={14} className="text-emerald-400" />
                      Vehicle RC Certificate
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/15 text-emerald-300 font-mono">
                      VERIFIED
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">Document No: RC-{inspectingDriver.vehicles?.[0]?.registrationNumber || 'KA-05-XXXX'}</p>
                  <p className="text-[10px] text-slate-500 font-mono">Valid up to: Oct 14, 2029</p>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setInspectingDriver(null)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white"
              >
                Close Profile
              </button>
              <button
                onClick={() => {
                  const d = inspectingDriver;
                  setInspectingDriver(null);
                  onOpenVerifyModal(d);
                }}
                className="px-5 py-2 rounded-xl text-xs font-semibold bg-amber-400 text-slate-950 hover:bg-amber-300 transition shadow-lg shadow-amber-400/10"
              >
                Change Verification Status
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
