import React from 'react';
import {
  LayoutDashboard,
  Compass,
  Users,
  ShieldCheck,
  Car,
  CreditCard,
  Sliders,
  Laptop,
  Activity,
  CheckCircle2,
  X,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export type AdminSection =
  | 'overview'
  | 'radar'
  | 'users'
  | 'drivers'
  | 'rides'
  | 'payments'
  | 'settings'
  | 'sessions'
  | 'health'
  | 'audit';

interface NavItem {
  id: AdminSection;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'KPI metrics & revenue analytics',
    icon: LayoutDashboard,
  },
  {
    id: 'radar',
    label: 'Dispatch Radar',
    description: 'Live geospatial fleet map',
    icon: Compass,
    badge: 'LIVE',
  },
  {
    id: 'users',
    label: 'User Directory',
    description: 'Accounts, roles & suspension',
    icon: Users,
  },
  {
    id: 'drivers',
    label: 'Driver Fleet',
    description: 'KYC, vehicles & approval',
    icon: ShieldCheck,
  },
  {
    id: 'rides',
    label: 'Rides & Dispatch',
    description: 'Live trips & route state',
    icon: Car,
  },
  {
    id: 'payments',
    label: 'Payments & Ledger',
    description: 'Transactions & refunds',
    icon: CreditCard,
  },
  {
    id: 'settings',
    label: 'System Policies',
    description: 'Surge pricing & feature flags',
    icon: Sliders,
  },
  {
    id: 'sessions',
    label: 'Active Sessions',
    description: 'RFC token security & devices',
    icon: Laptop,
  },
  {
    id: 'health',
    label: 'System Health',
    description: 'Microservice mesh & latency',
    icon: Activity,
  },
  {
    id: 'audit',
    label: 'Audit Trail',
    description: 'Operations activity log',
    icon: CheckCircle2,
  },
];

interface AdminSidebarProps {
  currentSection: AdminSection;
  onSelectSection: (section: AdminSection) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const AdminSidebar: React.FC<AdminSidebarProps> = ({
  currentSection,
  onSelectSection,
  isOpen,
  onClose,
}) => {
  return (
    <>
      {/* Mobile Drawer Overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/80 backdrop-blur-md lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar Container */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-76 flex-col border-r border-[#7a4416]/25 bg-[#0a0705] p-5 transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Mobile Header with Close Button */}
        <div className="mb-6 flex items-center justify-between lg:hidden">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold uppercase tracking-widest text-[#ffd88a]">
              Navigation
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-stone-400 hover:bg-white/5 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Console Brand Pill */}
        <div className="mb-6 hidden rounded-2xl border border-[#7a4416]/30 bg-gradient-to-br from-[#1a120b] to-[#0a0705] p-4 lg:block">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#ffd88a] to-[#c58a3a] text-[#1f1207] font-bold">
              <ShieldAlert size={18} />
            </div>
            <div>
              <p className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#ffd88a]">
                Admin Gateway
              </p>
              <p className="text-xs font-semibold text-stone-300">Port 4006 / v1/admin</p>
            </div>
          </div>
        </div>

        {/* Section Label */}
        <p className="mb-2 px-3 text-[10px] font-mono font-bold uppercase tracking-widest text-amber-500/60">
          Operation Modules
        </p>

        {/* Navigation List */}
        <nav className="flex-1 space-y-1.5 overflow-y-auto pr-1">
          {NAV_ITEMS.map(({ id, label, description, icon: Icon, badge }) => {
            const isActive = currentSection === id;
            return (
              <button
                key={id}
                onClick={() => {
                  onSelectSection(id);
                  onClose();
                }}
                className={`group relative flex w-full items-center justify-between rounded-2xl p-2.5 text-left transition-all ${
                  isActive
                    ? 'border border-[#ffd88a]/40 bg-gradient-to-r from-[#2a1a0d] to-[#1a120b] text-white shadow-md shadow-amber-950/30'
                    : 'border border-transparent text-stone-400 hover:border-white/5 hover:bg-white/[0.03] hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition ${
                      isActive
                        ? 'bg-gradient-to-br from-[#ffd88a] to-[#c58a3a] text-[#1f1207] shadow-sm font-bold'
                        : 'bg-white/5 text-amber-300/80 group-hover:text-amber-200'
                    }`}
                  >
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0 flex-1 truncate">
                    <p className={`text-xs font-bold leading-tight ${isActive ? 'text-[#ffd88a]' : 'text-stone-200'}`}>
                      {label}
                    </p>
                    <p className="text-[10px] text-stone-500 truncate mt-0.5">{description}</p>
                  </div>
                </div>

                {badge && (
                  <span className="rounded-md bg-emerald-500/20 border border-emerald-500/30 px-1.5 py-0.5 text-[9px] font-mono font-bold text-emerald-300">
                    {badge}
                  </span>
                )}
                {isActive && (
                  <ChevronRight size={14} className="text-[#ffd88a] shrink-0 ml-1" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer Info */}
        <div className="mt-auto border-t border-white/5 pt-4">
          <div className="rounded-2xl border border-white/5 bg-black/40 p-3 text-[11px] text-stone-500">
            <p className="font-semibold text-stone-400">UrbanFleet Control Node</p>
            <p className="text-[10px] text-stone-600 mt-0.5">Strict RBAC · Session Bound · Encrypted</p>
          </div>
        </div>
      </aside>
    </>
  );
};
