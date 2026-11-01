import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import {
  CheckCircle2,
  AlertTriangle,
  Info,
  X,
  LayoutDashboard,
  Radar,
  Users,
  Car,
  Route,
  CreditCard,
  ShieldCheck,
  Activity,
  FileSpreadsheet,
  Sliders,
  RefreshCw,
  Terminal,
  Sparkles,
  Clock,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import {
  adminApi,
  type OverviewMetrics,
  type ServiceHealthSummary,
  type AdminUser,
  type AdminDriver,
  type AdminRide,
  type AdminPayment,
  type AdminSession,
  type AdminAuditLog,
  type PaginatedResult,
} from './lib/adminApi';
import { AdminHeader } from './components/admin/AdminHeader';
import { AdminSidebar, type AdminSection } from './components/admin/AdminSidebar';
import { AdminOverviewTab } from './components/admin/AdminOverviewTab';
import { AdminFleetRadarTab } from './components/admin/AdminFleetRadarTab';
import { AdminSettingsTab } from './components/admin/AdminSettingsTab';
import { AdminUsersTab } from './components/admin/AdminUsersTab';
import { AdminDriversTab } from './components/admin/AdminDriversTab';
import { AdminRidesTab } from './components/admin/AdminRidesTab';
import { AdminPaymentsTab } from './components/admin/AdminPaymentsTab';
import { AdminSessionsTab } from './components/admin/AdminSessionsTab';
import { AdminSystemHealthTab } from './components/admin/AdminSystemHealthTab';
import { AdminAuditLogTab } from './components/admin/AdminAuditLogTab';
import { AdminActionModal, type AdminActionModalProps } from './components/admin/AdminActionModal';
import { KeyboardShortcutsModal } from './components/admin/KeyboardShortcutsModal';
import CityMapBackground from './components/CityMapBackground';

interface ToastNotice {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface SectionMeta {
  id: AdminSection;
  label: string;
  shortLabel: string;
  subtitle: string;
  shortcut: string;
  icon: LucideIcon;
}

const SECTION_CONFIG: Record<AdminSection, SectionMeta> = {
  overview: {
    id: 'overview',
    label: 'Executive Overview',
    shortLabel: 'Overview',
    subtitle: 'Real-time platform KPIs, dispatch throughput, and microservice telemetry.',
    shortcut: 'G O',
    icon: LayoutDashboard,
  },
  radar: {
    id: 'radar',
    label: 'Live Fleet Radar',
    shortLabel: 'Radar',
    subtitle: 'Geospatial H3 tracking of active captains, passenger pickups, and corridors.',
    shortcut: 'G M',
    icon: Radar,
  },
  users: {
    id: 'users',
    label: 'Passenger Directory',
    shortLabel: 'Users',
    subtitle: 'Manage rider accounts, role assignments, and access restrictions.',
    shortcut: 'G U',
    icon: Users,
  },
  drivers: {
    id: 'drivers',
    label: 'Captain KYC & Fleet',
    shortLabel: 'Drivers',
    subtitle: 'Audit commercial licenses, RC smart cards, insurance, and onboarding status.',
    shortcut: 'G D',
    icon: Car,
  },
  rides: {
    id: 'rides',
    label: 'Dispatch Monitor',
    shortLabel: 'Rides',
    subtitle: 'Live state-machine inspection of ongoing, completed, and cancelled trips.',
    shortcut: 'G R',
    icon: Route,
  },
  payments: {
    id: 'payments',
    label: 'Ledger & Settlements',
    shortLabel: 'Payments',
    subtitle: 'Double-entry paise ledger, Razorpay gateway orders, and instant refunds.',
    shortcut: 'G P',
    icon: CreditCard,
  },
  sessions: {
    id: 'sessions',
    label: 'Redis Session Guard',
    shortLabel: 'Sessions',
    subtitle: 'Monitor RFC 6819 device tokens and force-revoke compromised endpoints.',
    shortcut: 'G E',
    icon: ShieldCheck,
  },
  health: {
    id: 'health',
    label: 'System Telemetry',
    shortLabel: 'Health',
    subtitle: 'PostgreSQL, Redis, Kafka outbox, and WebSocket cluster diagnostics.',
    shortcut: 'G H',
    icon: Activity,
  },
  audit: {
    id: 'audit',
    label: 'Immutable Audit Log',
    shortLabel: 'Audit',
    subtitle: 'Cryptographic trail of administrative mutations and security events.',
    shortcut: 'G A',
    icon: FileSpreadsheet,
  },
  settings: {
    id: 'settings',
    label: 'Platform Configuration',
    shortLabel: 'Settings',
    subtitle: 'Dynamic surge multipliers, commission splits, and dispatch parameters.',
    shortcut: 'G S',
    icon: Sliders,
  },
};

const ORDERED_SECTIONS: AdminSection[] = [
  'overview',
  'radar',
  'users',
  'drivers',
  'rides',
  'payments',
  'sessions',
  'health',
  'audit',
  'settings',
];

const DISPLAY_FONT = "'Fraunces', Georgia, serif";
const MONO_FONT = "'JetBrains Mono', ui-monospace, 'SF Mono', monospace";

const tabTransitionVariants: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.995 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
  },
  exit: {
    opacity: 0,
    y: -8,
    scale: 0.995,
    transition: { duration: 0.16, ease: 'easeIn' },
  },
};

export default function AdminDashboard() {
  const [section, setSection] = useState<AdminSection>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshInterval, setRefreshInterval] = useState<number>(15);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date>(() => new Date());
  const [awaitingChord, setAwaitingChord] = useState(false);
  const [toasts, setToasts] = useState<ToastNotice[]>([]);

  // Data states
  const [overview, setOverview] = useState<OverviewMetrics | null>(null);
  const [health, setHealth] = useState<Record<string, ServiceHealthSummary> | null>(null);
  const [usersData, setUsersData] = useState<PaginatedResult<AdminUser>>({
    success: true,
    data: [],
  });
  const [driversData, setDriversData] = useState<PaginatedResult<AdminDriver>>({
    success: true,
    data: [],
  });
  const [ridesData, setRidesData] = useState<PaginatedResult<AdminRide>>({
    success: true,
    data: [],
  });
  const [paymentsData, setPaymentsData] = useState<PaginatedResult<AdminPayment>>({
    success: true,
    data: [],
  });
  const [sessionsData, setSessionsData] = useState<PaginatedResult<AdminSession>>({
    success: true,
    data: [],
  });
  const [auditData, setAuditData] = useState<PaginatedResult<AdminAuditLog>>({
    success: true,
    data: [],
  });

  // Pagination & filter query state
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState<string | undefined>(undefined);
  const [filterStatus, setFilterStatus] = useState<string | undefined>(undefined);

  const pendingKeyRef = useRef<string | null>(null);
  const chordTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mainScrollRef = useRef<HTMLElement | null>(null);

  const showToast = useCallback(
    (message: string, type: 'success' | 'error' | 'info' = 'success') => {
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((prev) => [...prev.slice(-3), { id, message, type }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    []
  );

  // Modal state
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    targetId: string;
    actionType: AdminActionModalProps['actionType'];
    initialStatus?: string;
    onConfirm: (payload: {
      reason: string;
      status?: string;
      amountPaise?: number;
      idempotencyKey?: string;
    }) => Promise<void>;
  }>({
    isOpen: false,
    title: '',
    description: '',
    targetId: '',
    actionType: 'SUSPEND_USER',
    onConfirm: async () => {},
  });

  // Load section-specific data
  const loadSectionData = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      if (section === 'overview') {
        const [ovData, hlData] = await Promise.all([
          adminApi.getOverview().catch(() => ({
            users: { total: 0 },
            drivers: { total: 0 },
            rides: { total: 0 },
            payments: { total: 0 },
          })),
          adminApi.getSystemHealth().catch(() => ({})),
        ]);
        setOverview(ovData);
        setHealth(hlData);
      } else if (section === 'users') {
        const res = await adminApi.getUsers({
          page: currentPage,
          limit: 15,
          search: searchQuery || undefined,
          role: filterRole,
        });
        setUsersData(res);
      } else if (section === 'drivers') {
        const res = await adminApi.getDrivers({
          page: currentPage,
          limit: 15,
          search: searchQuery || undefined,
          status: filterStatus,
        });
        setDriversData(res);
      } else if (section === 'rides') {
        const res = await adminApi.getRides({
          page: currentPage,
          limit: 15,
          search: searchQuery || undefined,
          status: filterStatus,
        });
        setRidesData(res);
      } else if (section === 'payments') {
        const res = await adminApi.getPayments({
          page: currentPage,
          limit: 15,
          status: filterStatus,
        });
        setPaymentsData(res);
      } else if (section === 'sessions') {
        const res = await adminApi.getSessions({
          page: currentPage,
          limit: 15,
        });
        setSessionsData(res);
      } else if (section === 'health') {
        const hlData = await adminApi.getSystemHealth();
        setHealth(hlData);
      } else if (section === 'audit') {
        const res = await adminApi.getAuditLogs({
          page: currentPage,
          limit: 20,
        });
        setAuditData(res);
      }
      setLastSyncedAt(new Date());
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Unable to synchronize administrator records'
      );
    } finally {
      setLoading(false);
    }
  }, [section, currentPage, searchQuery, filterRole, filterStatus]);

  useEffect(() => {
    void loadSectionData();
  }, [loadSectionData]);

  // Periodic Auto-Refresh (Pauses when an action modal is open)
  useEffect(() => {
    if (refreshInterval <= 0 || modalConfig.isOpen) return;
    const timer = setInterval(() => {
      void loadSectionData();
    }, refreshInterval * 1000);
    return () => clearInterval(timer);
  }, [refreshInterval, loadSectionData, modalConfig.isOpen]);

  // Section Change Handler
  const handleSectionChange = useCallback((newSection: AdminSection) => {
    setSection(newSection);
    setCurrentPage(1);
    setSearchQuery('');
    setFilterRole(undefined);
    setFilterStatus(undefined);
    setErrorMessage(null);
    setMobileNavOpen(false);
    mainScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Keyboard navigation shortcuts (with visual chord HUD)
  useEffect(() => {
    const clearChord = () => {
      pendingKeyRef.current = null;
      setAwaitingChord(false);
      if (chordTimeoutRef.current) {
        clearTimeout(chordTimeoutRef.current);
        chordTimeoutRef.current = null;
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        if (e.key === 'Escape') target.blur();
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        setShortcutsModalOpen((prev) => !prev);
        return;
      }

      if (e.key === 'Escape') {
        clearChord();
        setShortcutsModalOpen(false);
        setMobileNavOpen(false);
        return;
      }

      if ((e.key === 'g' || e.key === 'G') && pendingKeyRef.current !== 'g') {
        pendingKeyRef.current = 'g';
        setAwaitingChord(true);
        if (chordTimeoutRef.current) clearTimeout(chordTimeoutRef.current);
        chordTimeoutRef.current = setTimeout(() => {
          pendingKeyRef.current = null;
          setAwaitingChord(false);
        }, 1400);
        return;
      }

      if (pendingKeyRef.current === 'g') {
        clearChord();
        switch (e.key.toLowerCase()) {
          case 'o':
            handleSectionChange('overview');
            break;
          case 'm':
            handleSectionChange('radar');
            break;
          case 'u':
            handleSectionChange('users');
            break;
          case 'd':
            handleSectionChange('drivers');
            break;
          case 'r':
            handleSectionChange('rides');
            break;
          case 'p':
            handleSectionChange('payments');
            break;
          case 'e':
            handleSectionChange('sessions');
            break;
          case 's':
            handleSectionChange('settings');
            break;
          case 'h':
            handleSectionChange('health');
            break;
          case 'a':
            handleSectionChange('audit');
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (chordTimeoutRef.current) clearTimeout(chordTimeoutRef.current);
    };
  }, [handleSectionChange]);

  // Search & Filter handlers
  const handleUserSearch = (query: string, role?: string) => {
    setSearchQuery(query);
    setFilterRole(role);
    setCurrentPage(1);
  };

  const handleDriverSearch = (query: string, status?: string) => {
    setSearchQuery(query);
    setFilterStatus(status);
    setCurrentPage(1);
  };

  const handleRideSearch = (query: string, status?: string) => {
    setSearchQuery(query);
    setFilterStatus(status);
    setCurrentPage(1);
  };

  const handlePaymentFilter = (status?: string) => {
    setFilterStatus(status);
    setCurrentPage(1);
  };

  // Bridge from Fleet Radar -> Inspect Ride in Rides Tab
  const handleSelectRideFromRadar = (rideId: string) => {
    setSection('rides');
    setSearchQuery(rideId);
    setCurrentPage(1);
    showToast(`Filtering dispatch monitor for ride ${rideId.slice(0, 8)}...`, 'info');
  };

  // Modal Openers
  const openSuspendUserModal = (targetUser: AdminUser) => {
    const isSuspending = !targetUser.isSuspended;
    setModalConfig({
      isOpen: true,
      title: isSuspending ? 'Suspend User Account' : 'Restore User Account',
      description: isSuspending
        ? 'Restricting this user revokes active sessions and prevents logins until restored.'
        : 'Restoring this user re-enables login and platform access.',
      targetId: `${targetUser.email} (${targetUser.id})`,
      actionType: isSuspending ? 'SUSPEND_USER' : 'RESTORE_USER',
      onConfirm: async ({ reason }) => {
        await adminApi.setUserSuspension(targetUser.id, isSuspending, reason);
        showToast(
          `User ${targetUser.email} ${isSuspending ? 'suspended' : 'restored'} successfully`,
          'success'
        );
        await loadSectionData();
      },
    });
  };

  const openVerifyDriverModal = (targetDriver: AdminDriver) => {
    setModalConfig({
      isOpen: true,
      title: 'Review Driver Onboarding & KYC',
      description:
        'Update the driver verification status. Approved drivers can go online and receive ride dispatches.',
      targetId: `Driver ${targetDriver.id} (License: ${targetDriver.licenseNumber})`,
      actionType: 'VERIFY_DRIVER',
      initialStatus:
        targetDriver.verificationStatus === 'APPROVED' ? 'APPROVED' : 'APPROVED',
      onConfirm: async ({ reason, status }) => {
        if (!status) return;
        await adminApi.verifyDriver(targetDriver.id, status, reason);
        showToast(`Driver verification status changed to ${status}`, 'success');
        await loadSectionData();
      },
    });
  };

  const openRefundModal = (payment: AdminPayment) => {
    setModalConfig({
      isOpen: true,
      title: 'Initiate Ledger & Gateway Refund',
      description:
        'Issues a compensating ledger entry and contacts Razorpay to return passenger funds.',
      targetId: `Payment Order ${payment.id} (Ride: ${payment.rideId || 'Direct'})`,
      actionType: 'REFUND_PAYMENT',
      onConfirm: async ({ reason, amountPaise }) => {
        await adminApi.refundPayment(payment.id, reason, amountPaise);
        showToast('Refund processed successfully', 'success');
        await loadSectionData();
      },
    });
  };

  const openRevokeSessionModal = (targetSession: AdminSession) => {
    setModalConfig({
      isOpen: true,
      title: 'Force Revoke Device Session',
      description:
        'Immediately removes the session from Redis. The user will be required to re-authenticate on that device.',
      targetId: `Session ${targetSession.id} (${targetSession.browser || 'Client'} @ ${targetSession.ipAddress || 'IP'})`,
      actionType: 'REVOKE_SESSION',
      onConfirm: async () => {
        await adminApi.revokeSession(targetSession.id);
        showToast('Device session revoked from Redis cache', 'success');
        await loadSectionData();
      },
    });
  };

  const activeMeta = SECTION_CONFIG[section];
  const ActiveSectionIcon = activeMeta.icon;
  const hasActiveFilters = Boolean(searchQuery || filterRole || filterStatus);

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-[#080503] text-stone-100 flex flex-col font-sans selection:bg-[#ffd88a] selection:text-[#1f1207]">
      <style>{`
        .uf-admin-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
        .uf-admin-scroll::-webkit-scrollbar-track { background: transparent; }
        .uf-admin-scroll::-webkit-scrollbar-thumb { background: rgba(197, 138, 58, 0.35); border-radius: 999px; }
        .uf-admin-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255, 216, 138, 0.55); }
      `}</style>

      {/* Dark-Obsidian Cartographic Map Ambience (Tinted so light text stays ultra-crisp) */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute inset-0 opacity-[0.14] mix-blend-luminosity saturate-50">
          <CityMapBackground />
        </div>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(197,138,58,0.16)_0%,rgba(12,8,4,0.88)_55%,rgba(7,5,3,0.97)_100%)]" />
        <div
          className="absolute inset-0 opacity-[0.15]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(255,216,138,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,216,138,0.06) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
          }}
        />
      </div>

      {/* Top Synchronizing Laser Shimmer Bar */}
      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[2.5px] overflow-hidden bg-[#c58a3a]/20"
          >
            <motion.div
              className="h-full w-1/3 bg-gradient-to-r from-transparent via-[#ffd88a] to-transparent shadow-[0_0_12px_#ffd88a]"
              animate={{ x: ['-100%', '350%'] }}
              transition={{ duration: 1.15, repeat: Infinity, ease: 'easeInOut' }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Admin Top Navigation Bar */}
      <div className="relative z-30 shrink-0">
        <AdminHeader
          onRefresh={() => void loadSectionData()}
          loading={loading}
          onToggleMobileNav={() => setMobileNavOpen((prev) => !prev)}
          onOpenShortcuts={() => setShortcutsModalOpen(true)}
          refreshInterval={refreshInterval}
          onIntervalChange={setRefreshInterval}
        />
      </div>

      {/* Main Split Workspace */}
      <div className="relative z-10 flex flex-1 overflow-hidden">
        {/* Navigation Sidebar */}
        <AdminSidebar
          currentSection={section}
          onSelectSection={handleSectionChange}
          isOpen={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
        />

        {/* Scrollable Content Viewport */}
        <main
          ref={mainScrollRef}
          className="uf-admin-scroll flex-1 overflow-y-auto px-3.5 sm:px-6 lg:px-10 py-4 sm:py-7"
        >
          <div className="mx-auto max-w-[1480px] w-full space-y-5 sm:space-y-6 pb-16">
            {/* MOBILE & TABLET QUICK SECTION SWITCHER DOCK (lg:hidden) */}
            <div className="lg:hidden -mx-3.5 px-3.5 sm:mx-0 sm:px-0 overflow-x-auto uf-admin-scroll pb-1">
              <div className="inline-flex items-center gap-1.5 rounded-2xl border border-[#c58a3a]/25 bg-[#120b06]/90 p-1.5 backdrop-blur-xl shadow-lg">
                {ORDERED_SECTIONS.map((secKey) => {
                  const meta = SECTION_CONFIG[secKey];
                  const Icon = meta.icon;
                  const isActive = section === secKey;
                  return (
                    <button
                      key={secKey}
                      type="button"
                      onClick={() => handleSectionChange(secKey)}
                      className={`relative flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold whitespace-nowrap transition-colors ${
                        isActive
                          ? 'text-[#1c0f05]'
                          : 'text-stone-300 hover:text-[#ffd88a]'
                      }`}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="adminMobileSectionPill"
                          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                          className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-r from-[#ffd88a] via-[#f4c668] to-[#d99b3c] shadow-[0_4px_15px_rgba(244,198,104,0.35)]"
                        />
                      )}
                      <span className="relative z-10 flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span>{meta.shortLabel}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* EXECUTIVE CONTEXT BANNER & LIVE TELEMETRY STATUS BAR */}
            <motion.section
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className="relative overflow-hidden rounded-[1.75rem] border border-[#c58a3a]/25 bg-gradient-to-r from-[#160d06]/95 via-[#1c1008]/90 to-[#120a05]/95 p-4 sm:p-6 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.7)] backdrop-blur-2xl"
            >
              {/* Top Brass Highlight Line */}
              <div className="pointer-events-none absolute inset-x-10 top-0 h-[2px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a]/70 to-transparent" />

              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                {/* Left: Active Module Identity */}
                <div className="flex items-start sm:items-center gap-3.5 sm:gap-4 min-w-0">
                  <div className="relative flex h-11 w-11 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-2xl border border-[#c58a3a]/40 bg-gradient-to-br from-[#3a1f0a] via-[#261407] to-[#120903] text-[#ffd88a] shadow-inner">
                    <ActiveSectionIcon className="h-5 w-5 sm:h-6 sm:w-6 text-[#ffd88a]" />
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#120903] ${
                        loading
                          ? 'bg-amber-400 animate-ping'
                          : 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                      }`}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="inline-flex items-center gap-1 rounded-md border border-[#c58a3a]/30 bg-[#c58a3a]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#ffd88a]"
                        style={{ fontFamily: MONO_FONT }}
                      >
                        <Sparkles className="h-2.5 w-2.5" />
                        Admin Console
                      </span>
                      <span
                        className="hidden sm:inline-block rounded-md border border-stone-700/70 bg-stone-900/80 px-2 py-0.5 text-[10px] font-bold text-stone-300"
                        style={{ fontFamily: MONO_FONT }}
                      >
                        Shortcut: {activeMeta.shortcut}
                      </span>
                      {currentPage > 1 && (
                        <span
                          className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-300"
                          style={{ fontFamily: MONO_FONT }}
                        >
                          Page {currentPage}
                        </span>
                      )}
                    </div>

                    <h1
                      className="mt-1 truncate text-xl sm:text-2xl font-black tracking-tight text-stone-100"
                      style={{ fontFamily: DISPLAY_FONT }}
                    >
                      {activeMeta.label}
                    </h1>
                    <p className="mt-0.5 text-xs font-medium text-stone-400 line-clamp-1">
                      {activeMeta.subtitle}
                    </p>
                  </div>
                </div>

                {/* Right: Telemetry Sync Readout & Active Filter Reset */}
                <div className="flex flex-wrap items-center justify-between md:justify-end gap-2.5 border-t md:border-t-0 border-stone-800/80 pt-3 md:pt-0 shrink-0">
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        setFilterRole(undefined);
                        setFilterStatus(undefined);
                        setCurrentPage(1);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-500/20 active:scale-95 transition-all"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Clear Filters
                    </button>
                  )}

                  <div
                    className="flex items-center gap-2 rounded-xl border border-stone-800 bg-black/40 px-3 py-1.5 text-[11px] font-semibold text-stone-300"
                    style={{ fontFamily: MONO_FONT }}
                  >
                    <Clock className="h-3.5 w-3.5 text-[#c58a3a]" />
                    <span>
                      Synced{' '}
                      {lastSyncedAt.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                    {refreshInterval > 0 && (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300 border border-emerald-500/25">
                        {refreshInterval}s
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => void loadSectionData()}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#c58a3a]/40 bg-gradient-to-br from-[#3a1f0a] to-[#1f1005] px-3.5 py-1.5 text-xs font-bold text-[#ffd88a] shadow-md hover:border-[#ffd88a]/60 active:scale-95 transition-all disabled:opacity-50"
                    title="Force synchronize section data"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
                    />
                    <span>{loading ? 'Syncing…' : 'Sync'}</span>
                  </button>
                </div>
              </div>
            </motion.section>

            {/* Dismissible Error Banner with Instant Retry */}
            <AnimatePresence>
              {errorMessage && (
                <motion.div
                  initial={{ opacity: 0, y: -10, scale: 0.99 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.99 }}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-rose-500/40 bg-rose-950/60 p-4 text-xs font-semibold text-rose-100 shadow-xl backdrop-blur-xl"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-rose-500/20 text-rose-300 border border-rose-500/30">
                      <AlertTriangle className="h-4 w-4" />
                    </div>
                    <span className="break-words leading-relaxed">{errorMessage}</span>
                  </div>
                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    <button
                      type="button"
                      onClick={() => void loadSectionData()}
                      className="rounded-xl bg-rose-500/20 border border-rose-400/30 px-3 py-1.5 text-xs font-bold text-rose-100 hover:bg-rose-500/30 transition-colors"
                    >
                      Retry Sync
                    </button>
                    <button
                      type="button"
                      onClick={() => setErrorMessage(null)}
                      className="rounded-lg p-1.5 text-rose-300 hover:bg-rose-500/20 transition-colors"
                      aria-label="Dismiss error"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Animated Tab Workspace */}
            <AnimatePresence mode="wait">
              <motion.div
                key={section}
                variants={tabTransitionVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="w-full"
              >
                {section === 'overview' && (
                  <AdminOverviewTab
                    overview={overview}
                    health={health}
                    onNavigateSection={handleSectionChange}
                  />
                )}

                {section === 'radar' && (
                  <AdminFleetRadarTab onSelectRide={handleSelectRideFromRadar} />
                )}

                {section === 'settings' && (
                  <AdminSettingsTab onNotify={(msg, type) => showToast(msg, type)} />
                )}

                {section === 'users' && (
                  <AdminUsersTab
                    usersData={usersData}
                    loading={loading}
                    onSearch={handleUserSearch}
                    onOpenSuspendModal={openSuspendUserModal}
                    onPageChange={(page) => setCurrentPage(page)}
                  />
                )}

                {section === 'drivers' && (
                  <AdminDriversTab
                    driversData={driversData}
                    loading={loading}
                    onSearch={handleDriverSearch}
                    onOpenVerifyModal={openVerifyDriverModal}
                    onPageChange={(page) => setCurrentPage(page)}
                  />
                )}

                {section === 'rides' && (
                  <AdminRidesTab
                    ridesData={ridesData}
                    loading={loading}
                    onSearch={handleRideSearch}
                    onPageChange={(page) => setCurrentPage(page)}
                  />
                )}

                {section === 'payments' && (
                  <AdminPaymentsTab
                    paymentsData={paymentsData}
                    loading={loading}
                    onFilterStatus={handlePaymentFilter}
                    onOpenRefundModal={openRefundModal}
                    onPageChange={(page) => setCurrentPage(page)}
                  />
                )}

                {section === 'sessions' && (
                  <AdminSessionsTab
                    sessionsData={sessionsData}
                    loading={loading}
                    onOpenRevokeModal={openRevokeSessionModal}
                    onPageChange={(page) => setCurrentPage(page)}
                  />
                )}

                {section === 'health' && (
                  <AdminSystemHealthTab
                    health={health}
                    loading={loading}
                    onRefreshHealth={() => void loadSectionData()}
                  />
                )}

                {section === 'audit' && (
                  <AdminAuditLogTab
                    auditData={auditData}
                    loading={loading}
                    onPageChange={(page) => setCurrentPage(page)}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Linear / Raycast Style Keychord HUD (Visible when pressing 'G') */}
      <AnimatePresence>
        {awaitingChord && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.95 }}
            transition={{ duration: 0.16 }}
            className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 hidden md:flex items-center gap-3 rounded-2xl border border-[#c58a3a]/50 bg-[#140b05]/95 px-5 py-3 text-xs font-bold text-[#ffe9be] shadow-[0_24px_60px_rgba(0,0,0,0.85)] backdrop-blur-2xl"
            style={{ fontFamily: MONO_FONT }}
          >
            <Terminal className="h-4 w-4 text-[#ffd88a] animate-pulse" />
            <span>Chord [G] active → Press</span>
            <div className="flex items-center gap-1.5">
              {[
                ['O', 'Overview'],
                ['M', 'Radar'],
                ['U', 'Users'],
                ['D', 'Drivers'],
                ['R', 'Rides'],
                ['P', 'Pay'],
                ['H', 'Health'],
                ['A', 'Audit'],
              ].map(([k, label]) => (
                <span
                  key={k}
                  className="rounded-md border border-[#c58a3a]/40 bg-white/10 px-1.5 py-0.5 text-[10px] text-[#ffd88a]"
                >
                  {k}:{label}
                </span>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile & Desktop Responsive Toast Notification Stack */}
      <div className="fixed inset-x-4 bottom-4 sm:left-auto sm:right-6 sm:bottom-6 z-50 flex flex-col gap-2.5 pointer-events-none sm:max-w-sm sm:w-full">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 380, damping: 28 }}
              className={`pointer-events-auto relative overflow-hidden flex items-center justify-between gap-3 p-4 rounded-2xl border shadow-2xl backdrop-blur-2xl text-xs font-semibold ${
                toast.type === 'success'
                  ? 'bg-emerald-950/95 border-emerald-500/40 text-emerald-100 shadow-emerald-950/50'
                  : toast.type === 'error'
                    ? 'bg-rose-950/95 border-rose-500/40 text-rose-100 shadow-rose-950/50'
                    : 'bg-[#1a0f07]/95 border-[#c58a3a]/45 text-[#ffe9be] shadow-black/60'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {toast.type === 'success' && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                )}
                {toast.type === 'error' && (
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                {toast.type === 'info' && (
                  <Info className="w-4 h-4 text-[#ffd88a] shrink-0" />
                )}
                <span className="break-words leading-snug">{toast.message}</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  setToasts((prev) => prev.filter((t) => t.id !== toast.id))
                }
                className="text-stone-400 hover:text-white p-1 rounded-lg hover:bg-white/10 shrink-0 transition-colors"
                aria-label="Close notification"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Keyboard Shortcuts Modal */}
      <KeyboardShortcutsModal
        isOpen={shortcutsModalOpen}
        onClose={() => setShortcutsModalOpen(false)}
      />

      {/* Global Administrative Confirmation Modal */}
      <AdminActionModal
        isOpen={modalConfig.isOpen}
        title={modalConfig.title}
        description={modalConfig.description}
        targetId={modalConfig.targetId}
        actionType={modalConfig.actionType}
        initialStatus={modalConfig.initialStatus}
        onClose={() => setModalConfig((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={modalConfig.onConfirm}
      />
    </div>
  );
}