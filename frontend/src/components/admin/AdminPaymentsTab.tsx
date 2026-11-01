import React, { useState } from 'react';
import {
  CreditCard,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
  Receipt,
  Download,
} from 'lucide-react';
import {
  type AdminPayment,
  type PaginatedResult,
  exportToCsv,
  exportToJson,
} from '../../lib/adminApi';

interface AdminPaymentsTabProps {
  paymentsData: PaginatedResult<AdminPayment> | null;
  loading: boolean;
  onFilterStatus: (status?: string) => void;
  onOpenRefundModal: (payment: AdminPayment) => void;
  onPageChange: (page: number) => void;
}

export const AdminPaymentsTab: React.FC<AdminPaymentsTabProps> = ({
  paymentsData,
  loading,
  onFilterStatus,
  onOpenRefundModal,
  onPageChange,
}) => {
  const [selectedStatus, setSelectedStatus] = useState<string | undefined>(undefined);

  const payments = paymentsData?.data ?? [];
  const pagination = paymentsData?.pagination;
  const currentPage = pagination?.page ?? 1;
  const totalPages = pagination ? Math.ceil(pagination.total / pagination.limit) : 1;

  const handleStatusFilter = (status?: string) => {
    setSelectedStatus(status);
    onFilterStatus(status);
  };

  const handleExportCsv = () => {
    const flatRows = payments.map((p) => ({
      id: p.id,
      rideId: p.rideId || 'None',
      amountINR: (p.amountPaise / 100).toFixed(2),
      currency: p.currency,
      status: p.status,
      gatewayOrderId: p.gatewayOrderId || 'None',
      gatewayPaymentId: p.gatewayPaymentId || 'None',
      createdAt: p.createdAt,
    }));
    exportToCsv(`urbanfleet-payments-${new Date().toISOString().slice(0, 10)}`, flatRows);
  };

  const handleExportJson = () => {
    exportToJson(`urbanfleet-payments-${new Date().toISOString().slice(0, 10)}`, payments);
  };

  const formatAmount = (paise: number) => {
    return `₹${(paise / 100).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'CAPTURED':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300">
            <CheckCircle2 size={11} />
            Captured
          </span>
        );
      case 'REFUNDED':
      case 'PARTIALLY_REFUNDED':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-0.5 text-[10px] font-bold text-purple-300">
            <RefreshCw size={11} />
            Refunded
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-[10px] font-bold text-rose-300">
            <XCircle size={11} />
            Failed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold text-amber-300">
            <Clock size={11} />
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Filter Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Receipt size={18} className="text-[#ffd88a]" />
          <h3 className="font-serif text-base font-bold text-white">Payment Ledger Transactions</h3>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status Filters */}
          <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-[#7a4416]/30 bg-[#120d08] p-1 text-xs">
            {[
              { label: 'All Transactions', value: undefined },
              { label: 'Captured', value: 'CAPTURED' },
              { label: 'Refunded', value: 'REFUNDED' },
              { label: 'Pending', value: 'PENDING' },
              { label: 'Failed', value: 'FAILED' },
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
              disabled={payments.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-[#1a120b] hover:bg-[#251910] text-stone-300 hover:text-white border border-[#7a4416]/30 transition disabled:opacity-40"
              title="Export payments to CSV"
            >
              <Download size={13} />
              CSV
            </button>
            <button
              onClick={handleExportJson}
              disabled={payments.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-[#1a120b] hover:bg-[#251910] text-stone-300 hover:text-white border border-[#7a4416]/30 transition disabled:opacity-40"
              title="Export payments to JSON"
            >
              JSON
            </button>
          </div>
        </div>
      </div>

      {/* Payments Table */}
      <div className="overflow-hidden rounded-3xl border border-[#7a4416]/30 bg-gradient-to-b from-[#170f08] to-[#0a0705] shadow-xl shadow-black/40">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#7a4416]/25 bg-black/40 font-mono text-[11px] uppercase tracking-wider text-amber-500/80">
              <tr>
                <th className="px-5 py-4">Transaction / Order</th>
                <th className="px-5 py-4">Ride Reference</th>
                <th className="px-5 py-4">Amount</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4">Gateway IDs</th>
                <th className="px-5 py-4">Date</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading && payments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-stone-500">
                    Loading transactions ledger...
                  </td>
                </tr>
              ) : payments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-stone-500">
                    No payment records found.
                  </td>
                </tr>
              ) : (
                payments.map((p) => (
                  <tr key={p.id} className="hover:bg-white/[0.02] transition">
                    {/* Payment ID */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
                          <CreditCard size={15} />
                        </div>
                        <div>
                          <p className="font-mono font-bold text-white">{p.id.slice(0, 13)}...</p>
                          <p className="text-[10px] text-stone-500 font-mono">{p.currency || 'INR'}</p>
                        </div>
                      </div>
                    </td>

                    {/* Ride ID */}
                    <td className="px-5 py-4 font-mono text-stone-300">
                      {p.rideId ? `${p.rideId.slice(0, 13)}...` : '—'}
                    </td>

                    {/* Amount */}
                    <td className="px-5 py-4 font-mono font-black text-sm text-[#ffd88a]">
                      {formatAmount(p.amountPaise)}
                    </td>

                    {/* Status */}
                    <td className="px-5 py-4">{getStatusBadge(p.status)}</td>

                    {/* Gateway IDs */}
                    <td className="px-5 py-4 font-mono text-[11px] text-stone-400">
                      <p className="truncate max-w-[120px]">{p.gatewayPaymentId || p.gatewayOrderId || 'Direct CAS'}</p>
                    </td>

                    {/* Date */}
                    <td className="px-5 py-4 font-mono text-[11px] text-stone-400">
                      {new Date(p.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>

                    {/* Action */}
                    <td className="px-5 py-4 text-right">
                      {p.status === 'CAPTURED' && (
                        <button
                          onClick={() => onOpenRefundModal(p)}
                          className="rounded-xl border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-xs font-semibold text-purple-300 hover:bg-purple-500/20 transition"
                        >
                          Refund
                        </button>
                      )}
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
              {Math.min(currentPage * pagination.limit, pagination.total)} of {pagination.total} records
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
    </div>
  );
};
