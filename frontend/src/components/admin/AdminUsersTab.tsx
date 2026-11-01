import React, { useState } from 'react';
import {
  Search,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Download,
} from 'lucide-react';
import {
  type AdminUser,
  type PaginatedResult,
  exportToCsv,
  exportToJson,
} from '../../lib/adminApi';

interface AdminUsersTabProps {
  usersData: PaginatedResult<AdminUser> | null;
  loading: boolean;
  onSearch: (query: string, role?: string) => void;
  onOpenSuspendModal: (user: AdminUser) => void;
  onPageChange: (page: number) => void;
}

export const AdminUsersTab: React.FC<AdminUsersTabProps> = ({
  usersData,
  loading,
  onSearch,
  onOpenSuspendModal,
  onPageChange,
}) => {
  const [searchInput, setSearchInput] = useState('');
  const [selectedRole, setSelectedRole] = useState<string | undefined>(undefined);

  const users = usersData?.data ?? [];
  const pagination = usersData?.pagination;
  const currentPage = pagination?.page ?? 1;
  const totalPages = pagination ? Math.ceil(pagination.total / pagination.limit) : 1;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(searchInput.trim(), selectedRole);
  };

  const handleRoleFilter = (role?: string) => {
    setSelectedRole(role);
    onSearch(searchInput.trim(), role);
  };

  const handleExportCsv = () => {
    const flatRows = users.map((u) => ({
      id: u.id,
      fullName: `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'N/A',
      email: u.email,
      phone: u.phone || 'N/A',
      roles: (u.roles || []).join('; '),
      isEmailVerified: u.isEmailVerified,
      isSuspended: u.isSuspended,
      suspensionReason: u.suspensionReason || 'None',
      createdAt: u.createdAt,
    }));
    exportToCsv(`urbanfleet-users-${new Date().toISOString().slice(0, 10)}`, flatRows);
  };

  const handleExportJson = () => {
    exportToJson(`urbanfleet-users-${new Date().toISOString().slice(0, 10)}`, users);
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
            placeholder="Search by name, email, or user ID..."
            className="w-full rounded-2xl border border-[#7a4416]/30 bg-[#120d08] pl-10 pr-4 py-2.5 text-xs text-white placeholder:text-stone-600 focus:border-[#ffd88a] focus:outline-none focus:ring-1 focus:ring-[#ffd88a]"
          />
        </form>

        <div className="flex flex-wrap items-center gap-2">
          {/* Role Filters */}
          <div className="flex items-center gap-1.5 rounded-2xl border border-[#7a4416]/30 bg-[#120d08] p-1 text-xs">
            {[
              { label: 'All Roles', value: undefined },
              { label: 'Riders', value: 'RIDER' },
              { label: 'Drivers', value: 'DRIVER' },
              { label: 'Admins', value: 'ADMIN' },
            ].map((item) => (
              <button
                key={item.label}
                onClick={() => handleRoleFilter(item.value)}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                  selectedRole === item.value
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
              disabled={users.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-[#1a120b] hover:bg-[#251910] text-stone-300 hover:text-white border border-[#7a4416]/30 transition disabled:opacity-40"
              title="Export users to CSV"
            >
              <Download size={13} />
              CSV
            </button>
            <button
              onClick={handleExportJson}
              disabled={users.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-[#1a120b] hover:bg-[#251910] text-stone-300 hover:text-white border border-[#7a4416]/30 transition disabled:opacity-40"
              title="Export users to JSON"
            >
              JSON
            </button>
          </div>
        </div>
      </div>

      {/* Users Table */}
      <div className="overflow-hidden rounded-3xl border border-[#7a4416]/30 bg-gradient-to-b from-[#170f08] to-[#0a0705] shadow-xl shadow-black/40">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#7a4416]/25 bg-black/40 font-mono text-[11px] uppercase tracking-wider text-amber-500/80">
              <tr>
                <th className="px-5 py-4">User</th>
                <th className="px-5 py-4">Contact</th>
                <th className="px-5 py-4">Roles</th>
                <th className="px-5 py-4">Verification</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4">Joined</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading && users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-stone-500">
                    Loading users database...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-stone-500">
                    No users matching criteria found.
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'UrbanFleet Member';
                  const initial = u.firstName?.[0] || u.email[0].toUpperCase();
                  const isSuspended = u.isSuspended;

                  return (
                    <tr key={u.id} className="hover:bg-white/[0.02] transition">
                      {/* Name & Avatar */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] text-xs font-bold text-[#ffd88a]">
                            {initial}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-white truncate">{fullName}</p>
                            <p className="font-mono text-[10px] text-stone-500 truncate">{u.id}</p>
                          </div>
                        </div>
                      </td>

                      {/* Email & Phone */}
                      <td className="px-5 py-4">
                        <p className="text-stone-300 font-mono">{u.email}</p>
                        <p className="text-[11px] text-stone-500">{u.phone || 'No phone'}</p>
                      </td>

                      {/* Role Badges */}
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-1">
                          {u.roles?.map((role) => (
                            <span
                              key={role}
                              className={`rounded-md px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider ${
                                role === 'ADMIN'
                                  ? 'bg-amber-500/20 text-[#ffd88a] border border-amber-500/40'
                                  : role === 'DRIVER'
                                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                                  : 'bg-stone-500/15 text-stone-300 border border-stone-500/30'
                              }`}
                            >
                              {role}
                            </span>
                          ))}
                        </div>
                      </td>

                      {/* Email Verification */}
                      <td className="px-5 py-4">
                        {u.isEmailVerified ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                            <CheckCircle2 size={13} />
                            Verified
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-stone-500">
                            <XCircle size={13} />
                            Unverified
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-5 py-4">
                        {isSuspended ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-[10px] font-bold text-rose-300">
                            <XCircle size={11} />
                            Suspended
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300">
                            <CheckCircle2 size={11} />
                            Active
                          </span>
                        )}
                      </td>

                      {/* Joined Date */}
                      <td className="px-5 py-4 text-stone-400 font-mono text-[11px]">
                        {new Date(u.createdAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => onOpenSuspendModal(u)}
                          className={`rounded-xl px-3 py-1 text-xs font-semibold transition ${
                            isSuspended
                              ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                              : 'border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
                          }`}
                        >
                          {isSuspended ? 'Restore' : 'Suspend'}
                        </button>
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
              {Math.min(currentPage * pagination.limit, pagination.total)} of {pagination.total} users
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
