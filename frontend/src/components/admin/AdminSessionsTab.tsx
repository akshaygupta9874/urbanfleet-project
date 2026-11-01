import React from 'react';
import {
  Laptop,
  Smartphone,
  Tablet,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Download,
} from 'lucide-react';
import {
  type AdminSession,
  type PaginatedResult,
  exportToCsv,
  exportToJson,
} from '../../lib/adminApi';

interface AdminSessionsTabProps {
  sessionsData: PaginatedResult<AdminSession> | null;
  loading: boolean;
  onOpenRevokeModal: (session: AdminSession) => void;
  onPageChange: (page: number) => void;
}

export const AdminSessionsTab: React.FC<AdminSessionsTabProps> = ({
  sessionsData,
  loading,
  onOpenRevokeModal,
  onPageChange,
}) => {
  const sessions = sessionsData?.data ?? [];
  const pagination = sessionsData?.pagination;
  const currentPage = pagination?.page ?? 1;
  const totalPages = pagination ? Math.ceil(pagination.total / pagination.limit) : 1;

  const handleExportCsv = () => {
    const flatRows = sessions.map((s) => ({
      id: s.id,
      userId: s.userId,
      deviceType: s.deviceType || 'UNKNOWN',
      browser: s.browser || 'Unknown',
      os: s.os || 'Unknown',
      ipAddress: s.ipAddress || '127.0.0.1',
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    }));
    exportToCsv(`urbanfleet-sessions-${new Date().toISOString().slice(0, 10)}`, flatRows);
  };

  const handleExportJson = () => {
    exportToJson(`urbanfleet-sessions-${new Date().toISOString().slice(0, 10)}`, sessions);
  };

  const getDeviceIcon = (deviceType?: string) => {
    switch (deviceType?.toUpperCase()) {
      case 'MOBILE':
        return <Smartphone size={16} className="text-cyan-400" />;
      case 'TABLET':
        return <Tablet size={16} className="text-purple-400" />;
      default:
        return <Laptop size={16} className="text-amber-400" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-[#ffd88a]" />
            <h3 className="font-serif text-base font-bold text-white">Active Device Sessions</h3>
          </div>
          <p className="text-xs text-stone-400 mt-0.5">
            Real-time RFC 6819 Redis session tracking with remote instant token revocation
          </p>
        </div>

        {/* Export Actions */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleExportCsv}
            disabled={sessions.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-[#1a120b] hover:bg-[#251910] text-stone-300 hover:text-white border border-[#7a4416]/30 transition disabled:opacity-40"
            title="Export sessions to CSV"
          >
            <Download size={13} />
            CSV
          </button>
          <button
            onClick={handleExportJson}
            disabled={sessions.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-[#1a120b] hover:bg-[#251910] text-stone-300 hover:text-white border border-[#7a4416]/30 transition disabled:opacity-40"
            title="Export sessions to JSON"
          >
            JSON
          </button>
        </div>
      </div>

      {/* Sessions Table */}
      <div className="overflow-hidden rounded-3xl border border-[#7a4416]/30 bg-gradient-to-b from-[#170f08] to-[#0a0705] shadow-xl shadow-black/40">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#7a4416]/25 bg-black/40 font-mono text-[11px] uppercase tracking-wider text-amber-500/80">
              <tr>
                <th className="px-5 py-4">Device & Client</th>
                <th className="px-5 py-4">User Reference</th>
                <th className="px-5 py-4">IP Address</th>
                <th className="px-5 py-4">Created</th>
                <th className="px-5 py-4">Expires</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading && sessions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-stone-500">
                    Loading active sessions...
                  </td>
                </tr>
              ) : sessions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-stone-500">
                    No active sessions found.
                  </td>
                </tr>
              ) : (
                sessions.map((sess) => (
                  <tr key={sess.id} className="hover:bg-white/[0.02] transition">
                    {/* Device & Client */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5 border border-white/5">
                          {getDeviceIcon(sess.deviceType)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-white truncate">
                            {sess.browser || 'Modern Browser'} · {sess.os || 'Desktop OS'}
                          </p>
                          <p className="font-mono text-[10px] text-stone-500 truncate max-w-xs">
                            {sess.id}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* User ID */}
                    <td className="px-5 py-4 font-mono text-stone-300">
                      {sess.userId ? `${sess.userId.slice(0, 13)}...` : '—'}
                    </td>

                    {/* IP Address */}
                    <td className="px-5 py-4 font-mono text-amber-300/80 text-[11px]">
                      {sess.ipAddress || '127.0.0.1'}
                    </td>

                    {/* Created */}
                    <td className="px-5 py-4 font-mono text-stone-400 text-[11px]">
                      {new Date(sess.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>

                    {/* Expires */}
                    <td className="px-5 py-4 font-mono text-stone-500 text-[11px]">
                      {new Date(sess.expiresAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>

                    {/* Actions */}
                    <td className="px-5 py-4 text-right">
                      <button
                        onClick={() => onOpenRevokeModal(sess)}
                        className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition"
                      >
                        Revoke
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
              {Math.min(currentPage * pagination.limit, pagination.total)} of {pagination.total} sessions
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
