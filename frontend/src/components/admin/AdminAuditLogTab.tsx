import React, { useState } from 'react';
import {
  FileText,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Download,
} from 'lucide-react';
import {
  type AdminAuditLog,
  type PaginatedResult,
  exportToCsv,
  exportToJson,
} from '../../lib/adminApi';

interface AdminAuditLogTabProps {
  auditData: PaginatedResult<AdminAuditLog> | null;
  loading: boolean;
  onPageChange: (page: number) => void;
}

export const AdminAuditLogTab: React.FC<AdminAuditLogTabProps> = ({
  auditData,
  loading,
  onPageChange,
}) => {
  const [filterAction, setFilterAction] = useState<string>('ALL');

  const rawLogs = auditData?.data ?? [];
  const pagination = auditData?.pagination;
  const currentPage = pagination?.page ?? 1;
  const totalPages = pagination ? Math.ceil(pagination.total / pagination.limit) : 1;

  const logs = rawLogs.filter((log) => {
    if (filterAction === 'ALL') return true;
    if (filterAction === 'DRIVER') return log.action.includes('DRIVER');
    if (filterAction === 'USER') return log.action.includes('USER');
    if (filterAction === 'PAYMENT') return log.action.includes('REFUND') || log.action.includes('PAYMENT');
    if (filterAction === 'SYSTEM') return log.action.includes('SYSTEM');
    return true;
  });

  const handleExportCsv = () => {
    const flatRows = logs.map((l) => ({
      id: l.id,
      action: l.action,
      resource: l.resource,
      resourceId: l.resourceId || 'N/A',
      adminUserId: l.adminUserId,
      reason: l.reason,
      ipAddress: l.ipAddress || '127.0.0.1',
      createdAt: l.createdAt,
    }));
    exportToCsv(`urbanfleet-audit-log-${new Date().toISOString().slice(0, 10)}`, flatRows);
  };

  const handleExportJson = () => {
    exportToJson(`urbanfleet-audit-log-${new Date().toISOString().slice(0, 10)}`, logs);
  };

  const getActionBadge = (action: string) => {
    if (action.includes('APPROVED') || action.includes('RESTORED')) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-300">
          <CheckCircle2 size={11} />
          {action}
        </span>
      );
    }
    if (action.includes('SUSPENDED') || action.includes('REJECTED')) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-mono font-bold text-rose-300">
          <AlertTriangle size={11} />
          {action}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono font-bold text-amber-300">
        <Lock size={11} />
        {action}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header Info & Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-[#ffd88a]" />
            <h3 className="font-serif text-base font-bold text-white">Cryptographic Audit Trail</h3>
          </div>
          <p className="text-xs text-stone-400 mt-0.5">
            Immutable log of all administrative actions, target entities, caller IPs, and stated justifications
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Action Filter Pills */}
          <div className="flex items-center gap-1 bg-[#120d08] border border-[#7a4416]/30 rounded-2xl p-1 text-xs">
            {['ALL', 'DRIVER', 'USER', 'PAYMENT', 'SYSTEM'].map((cat) => (
              <button
                key={cat}
                onClick={() => setFilterAction(cat)}
                className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                  filterAction === cat
                    ? 'bg-gradient-to-r from-[#ffd88a] to-[#c58a3a] text-[#1f1207] shadow-xs'
                    : 'text-stone-400 hover:text-white'
                }`}
              >
                {cat === 'ALL' ? 'All Logs' : cat}
              </button>
            ))}
          </div>

          {/* Export Actions */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleExportCsv}
              disabled={logs.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-[#1a120b] hover:bg-[#251910] text-stone-300 hover:text-white border border-[#7a4416]/30 transition disabled:opacity-40"
              title="Export audit logs to CSV"
            >
              <Download size={13} />
              CSV
            </button>
            <button
              onClick={handleExportJson}
              disabled={logs.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-[#1a120b] hover:bg-[#251910] text-stone-300 hover:text-white border border-[#7a4416]/30 transition disabled:opacity-40"
              title="Export audit logs to JSON"
            >
              JSON
            </button>
          </div>
        </div>
      </div>

      {/* Audit Table */}
      <div className="overflow-hidden rounded-3xl border border-[#7a4416]/30 bg-gradient-to-b from-[#170f08] to-[#0a0705] shadow-xl shadow-black/40">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#7a4416]/25 bg-black/40 font-mono text-[11px] uppercase tracking-wider text-amber-500/80">
              <tr>
                <th className="px-5 py-4">Action</th>
                <th className="px-5 py-4">Resource & Target</th>
                <th className="px-5 py-4">Administrator ID</th>
                <th className="px-5 py-4">Reason / Justification</th>
                <th className="px-5 py-4">IP Address</th>
                <th className="px-5 py-4 text-right">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading && logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-stone-500">
                    Loading audit trail...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-stone-500">
                    No audit records logged yet.
                  </td>
                </tr>
              ) : (
                logs.map((item) => (
                  <tr key={item.id} className="hover:bg-white/[0.02] transition">
                    {/* Action */}
                    <td className="px-5 py-4">{getActionBadge(item.action)}</td>

                    {/* Target Resource */}
                    <td className="px-5 py-4 font-mono">
                      <span className="font-bold text-stone-200">{item.resource}</span>
                      {item.resourceId && (
                        <span className="block text-[10px] text-stone-500 truncate max-w-xs">
                          {item.resourceId}
                        </span>
                      )}
                    </td>

                    {/* Admin User */}
                    <td className="px-5 py-4 font-mono text-stone-400 text-[11px]">
                      {item.adminUserId ? `${item.adminUserId.slice(0, 13)}...` : 'System Bootstrap'}
                    </td>

                    {/* Justification */}
                    <td className="px-5 py-4 max-w-xs">
                      <p className="text-stone-300 truncate" title={item.reason}>
                        {item.reason}
                      </p>
                    </td>

                    {/* IP */}
                    <td className="px-5 py-4 font-mono text-[11px] text-stone-500">
                      {item.ipAddress || '127.0.0.1'}
                    </td>

                    {/* Timestamp */}
                    <td className="px-5 py-4 font-mono text-[11px] text-stone-400 text-right">
                      {new Date(item.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
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
              {Math.min(currentPage * pagination.limit, pagination.total)} of {pagination.total} audit logs
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
