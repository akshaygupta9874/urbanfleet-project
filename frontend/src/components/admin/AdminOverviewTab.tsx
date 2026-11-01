import React, { useEffect, useState } from 'react';
import {
  Users,
  ShieldCheck,
  Car,
  CreditCard,
  ArrowUpRight,
  ShieldAlert,
  Server,
  CheckCircle2,
  Activity,
  Compass,
  Sliders,
  TrendingUp,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { motion } from 'framer-motion';
import {
  type OverviewMetrics,
  type ServiceHealthSummary,
  type AnalyticsSummary,
  adminApi,
} from '../../lib/adminApi';
import type { AdminSection } from './AdminSidebar';

interface AdminOverviewTabProps {
  overview: OverviewMetrics | null;
  health: Record<string, ServiceHealthSummary> | null;
  onNavigateSection: (section: AdminSection) => void;
}

export const AdminOverviewTab: React.FC<AdminOverviewTabProps> = ({
  overview,
  health,
  onNavigateSection,
}) => {
  const [period, setPeriod] = useState<'24h' | '7d' | '30d'>('7d');
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [hoveredDataPoint, setHoveredDataPoint] = useState<{ date: string; gross: number; net: number; rides: number } | null>(null);

  const loadAnalytics = async () => {
    try {
      setAnalyticsLoading(true);
      setAnalyticsError(null);
      const data = await adminApi.getAnalytics(period);
      setAnalytics(data);
    } catch (err: unknown) {
      const errObj = err as { response?: { data?: { message?: string } }; message?: string };
      setAnalyticsError(errObj?.response?.data?.message || errObj?.message || 'Failed to fetch analytics from microservices cluster');
    } finally {
      setAnalyticsLoading(false);
    }
  };

  useEffect(() => {
    void loadAnalytics();
  }, [period]);

  const cards = [
    {
      label: 'Total Registered Users',
      value: overview?.users?.total ?? 0,
      degraded: overview?.users?.degraded,
      description: 'All rider, driver & admin accounts',
      icon: Users,
      section: 'users' as AdminSection,
      color: 'from-amber-500/20 to-amber-900/10',
      borderColor: 'border-amber-500/30',
      accentColor: 'text-amber-400',
    },
    {
      label: 'Driver Fleet',
      value: overview?.drivers?.total ?? 0,
      degraded: overview?.drivers?.degraded,
      description: 'Onboarded & pending verification',
      icon: ShieldCheck,
      section: 'drivers' as AdminSection,
      color: 'from-emerald-500/20 to-emerald-900/10',
      borderColor: 'border-emerald-500/30',
      accentColor: 'text-emerald-400',
    },
    {
      label: 'Total Rides',
      value: overview?.rides?.total ?? 0,
      degraded: overview?.rides?.degraded,
      description: 'Dispatched & completed trips',
      icon: Car,
      section: 'rides' as AdminSection,
      color: 'from-cyan-500/20 to-cyan-900/10',
      borderColor: 'border-cyan-500/30',
      accentColor: 'text-cyan-400',
    },
    {
      label: 'Payment Transactions',
      value: overview?.payments?.total ?? 0,
      degraded: overview?.payments?.degraded,
      description: 'Authorized, captured & refunded orders',
      icon: CreditCard,
      section: 'payments' as AdminSection,
      color: 'from-purple-500/20 to-purple-900/10',
      borderColor: 'border-purple-500/30',
      accentColor: 'text-purple-400',
    },
  ];

  const totalServices = health ? Object.keys(health).length : 5;
  const upServices = health
    ? Object.values(health).filter((h) => h.status === 'UP').length
    : 0;

  // Compute SVG Trend Chart
  const timeline = analytics?.revenueTimeline || [];
  const maxGross = Math.max(...timeline.map((d) => d.grossVolumeINR), 1000);
  const chartHeight = 160;
  const chartWidth = 560;
  const paddingX = 35;
  const paddingY = 25;

  const points = timeline.map((d, index) => {
    const x = paddingX + (index / Math.max(timeline.length - 1, 1)) * (chartWidth - paddingX * 2);
    const y = chartHeight - paddingY - (d.grossVolumeINR / maxGross) * (chartHeight - paddingY * 2);
    return { x, y, ...d };
  });

  const svgPath =
    points.length > 0
      ? points.reduce((acc, p, idx) => `${acc} ${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`, '')
      : '';

  const areaPath =
    points.length > 0
      ? `${svgPath} L ${points[points.length - 1].x} ${chartHeight} L ${points[0].x} ${chartHeight} Z`
      : '';

  return (
    <div className="space-y-8">
      {/* Degraded Services Alert Banner */}
      {overview?.degradedServices && overview.degradedServices.length > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-300">
          <AlertCircle className="w-5 h-5 flex-shrink-0 text-amber-400" />
          <div>
            <span className="font-bold">Upstream Service Warning:</span>{' '}
            {overview.degradedServices.join(', ')} reported connectivity issues. Metrics for degraded services may be incomplete or unavailable.
          </div>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card, index) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              onClick={() => onNavigateSection(card.section)}
              className={`group relative overflow-hidden rounded-3xl border ${card.borderColor} bg-gradient-to-br from-[#170f08] via-[#100b06] to-[#0a0705] p-6 shadow-xl shadow-black/40 cursor-pointer transition hover:scale-[1.02] hover:border-[#ffd88a]/60`}
            >
              <div className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/[0.02] blur-xl group-hover:bg-[#ffd88a]/5 transition" />

              <div className="flex items-center justify-between">
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${card.color} border border-white/5 ${card.accentColor}`}
                >
                  <Icon size={24} />
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-stone-400 group-hover:bg-[#ffd88a] group-hover:text-[#1f1207] transition">
                  <ArrowUpRight size={14} />
                </div>
              </div>

              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-stone-400">
                  {card.label}
                </p>
                {card.degraded ? (
                  <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 text-xs font-mono font-bold text-amber-300">
                    <AlertCircle size={12} /> Service Degraded
                  </div>
                ) : (
                  <p className="mt-1 font-serif text-3xl font-black text-white">
                    {card.value.toLocaleString()}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-stone-500">{card.description}</p>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Interactive Revenue & Analytics Command Center */}
      <div className="rounded-3xl border border-[#7a4416]/30 bg-gradient-to-br from-[#170f08] to-[#0d0906] p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-amber-400/10 border border-amber-400/20 text-amber-400">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-serif text-base font-bold text-white">
                Revenue & Dispatch Intelligence
              </h3>
              <p className="text-xs text-stone-400 mt-0.5">
                Gross Merchandise Volume (GMV) vs Platform Commission
              </p>
            </div>
          </div>

          {/* Timeframe Presets */}
          <div className="flex items-center gap-1 bg-black/40 border border-white/10 rounded-2xl p-1 text-xs">
            {(['24h', '7d', '30d'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-xl font-medium transition ${
                  period === p
                    ? 'bg-[#ffd88a] text-[#1f1207] font-bold shadow-md'
                    : 'text-stone-400 hover:text-white'
                }`}
              >
                {p === '24h' ? '24 Hours' : p === '7d' ? 'Last 7 Days' : 'Last 30 Days'}
              </button>
            ))}
          </div>
        </div>

        {analyticsError ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-center my-6">
            <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
            <p className="text-sm font-semibold text-red-400 mb-1">Failed to load analytics</p>
            <p className="text-xs text-stone-400 mb-4">{analyticsError}</p>
            <button
              onClick={() => void loadAnalytics()}
              disabled={analyticsLoading}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-300 text-xs font-semibold transition"
            >
              <RefreshCw size={12} className={analyticsLoading ? 'animate-spin' : ''} />
              Retry Analytics
            </button>
          </div>
        ) : (
          <>
            {/* Analytics KPI Ribbon */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
              <div className="p-4 rounded-2xl bg-black/40 border border-white/5">
                <span className="text-[10px] text-stone-400 uppercase font-semibold">Total GMV</span>
                <div className="text-xl font-bold font-mono text-white mt-1">
                  ₹{(analytics?.summaryKpis.grossVolumeINR || 0).toLocaleString()}
                </div>
                <span className="text-[10px] text-emerald-400 mt-0.5 block flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Period Gross Volume
                </span>
              </div>

              <div className="p-4 rounded-2xl bg-black/40 border border-white/5">
                <span className="text-[10px] text-stone-400 uppercase font-semibold">Platform Net Revenue</span>
                <div className="text-xl font-bold font-mono text-[#ffd88a] mt-1">
                  ₹{(analytics?.summaryKpis.netPlatformFeeINR || 0).toLocaleString()}
                </div>
                <span className="text-[10px] text-stone-400 mt-0.5 block">Platform Commission</span>
              </div>

              <div className="p-4 rounded-2xl bg-black/40 border border-white/5">
                <span className="text-[10px] text-stone-400 uppercase font-semibold">Completion Rate</span>
                <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
                  {analytics?.summaryKpis.completionRatePercent ?? 0}%
                </div>
                <span className="text-[10px] text-stone-400 mt-0.5 block">Dispatched trips completed</span>
              </div>

              <div className="p-4 rounded-2xl bg-black/40 border border-white/5">
                <span className="text-[10px] text-stone-400 uppercase font-semibold">Average Fare</span>
                <div className="text-xl font-bold font-mono text-cyan-300 mt-1">
                  ₹{analytics?.summaryKpis.avgTripFareINR ?? 0}
                </div>
                <span className="text-[10px] text-stone-400 mt-0.5 block">Per completed ride</span>
              </div>
            </div>

            {/* SVG Area Trend Chart */}
            <div className="mt-6 p-4 rounded-2xl bg-black/40 border border-white/5 relative">
              <div className="flex items-center justify-between text-xs text-stone-400 mb-2">
                <span>Gross Revenue Trend (₹)</span>
                {hoveredDataPoint ? (
                  <span className="font-mono text-amber-300">
                    {hoveredDataPoint.date}: ₹{hoveredDataPoint.gross} ({hoveredDataPoint.rides} rides)
                  </span>
                ) : (
                  <span className="text-[11px] text-stone-500 font-mono">Hover over points to inspect date</span>
                )}
              </div>

              <div className="relative w-full overflow-hidden">
                <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-44 overflow-visible">
                  <defs>
                    <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#ffd88a" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#ffd88a" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* Grid Lines */}
                  <line x1="0" y1={chartHeight - 20} x2={chartWidth} y2={chartHeight - 20} stroke="#332211" strokeDasharray="4" />
                  <line x1="0" y1={chartHeight / 2} x2={chartWidth} y2={chartHeight / 2} stroke="#332211" strokeDasharray="4" />

                  {/* Area Fill */}
                  {areaPath && <path d={areaPath} fill="url(#areaGradient)" />}

                  {/* Line Stroke */}
                  {svgPath && (
                    <path d={svgPath} fill="none" stroke="#ffd88a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  )}

                  {/* Points */}
                  {points.map((p, idx) => (
                    <g key={idx}>
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={hoveredDataPoint?.date === p.date ? 6 : 4}
                        fill="#1f1207"
                        stroke="#ffd88a"
                        strokeWidth="2"
                        className="cursor-pointer transition-all"
                        onMouseEnter={() =>
                          setHoveredDataPoint({
                            date: p.date,
                            gross: p.grossVolumeINR,
                            net: p.platformFeeINR,
                            rides: p.ridesCount,
                          })
                        }
                        onMouseLeave={() => setHoveredDataPoint(null)}
                      />
                      <text
                        x={p.x}
                        y={chartHeight - 4}
                        textAnchor="middle"
                        fill="#78716c"
                        fontSize="9"
                        fontFamily="monospace"
                      >
                        {p.date}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Quick Status Bar & Mesh Summary */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Microservices Health Mesh Pill */}
        <div className="rounded-3xl border border-[#7a4416]/30 bg-gradient-to-br from-[#170f08] to-[#0d0906] p-6 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <Server size={18} className="text-[#ffd88a]" />
                <h3 className="font-serif text-base font-bold text-white">
                  Microservices Cluster Topology
                </h3>
              </div>
              <p className="text-xs text-stone-400 mt-0.5">
                Live heartbeat monitoring from Auth, Driver, Ride, Payment, Notification, and Admin services
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              {upServices}/{totalServices} Services Healthy
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {health &&
              Object.entries(health).map(([serviceName, data]) => {
                const isUp = data.status === 'UP';
                return (
                  <div
                    key={serviceName}
                    className="flex flex-col justify-between rounded-2xl border border-white/5 bg-black/30 p-3.5 hover:border-white/10 transition"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold capitalize text-stone-200">
                        {serviceName.replace('-service', '')}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[9px] font-mono font-bold uppercase ${
                          isUp
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                        }`}
                      >
                        {data.status}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[10px] text-stone-500 font-mono">
                      <span>Latency</span>
                      <span className="text-amber-300/80">{data.latencyMs ?? 12}ms</span>
                    </div>
                  </div>
                );
              })}
          </div>

          <div className="mt-5 flex justify-end">
            <button
              onClick={() => onNavigateSection('health')}
              className="flex items-center gap-1.5 text-xs font-semibold text-[#ffd88a] hover:underline"
            >
              <span>View full cluster diagnostics</span>
              <ArrowUpRight size={13} />
            </button>
          </div>
        </div>

        {/* Quick Operations Guide & Shortcuts */}
        <div className="rounded-3xl border border-[#7a4416]/30 bg-gradient-to-br from-[#170f08] to-[#0d0906] p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ShieldAlert size={18} className="text-[#ffd88a]" />
              <h3 className="font-serif text-base font-bold text-white">Operations Actions</h3>
            </div>
            <p className="text-xs text-stone-400 mt-1">
              Enterprise console modules and instant shortcuts:
            </p>

            <ul className="mt-4 space-y-2 text-xs text-stone-300">
              <li
                onClick={() => onNavigateSection('radar' as AdminSection)}
                className="flex items-center justify-between rounded-xl border border-amber-400/20 bg-amber-400/5 p-2.5 hover:bg-amber-400/10 cursor-pointer transition text-amber-300"
              >
                <span className="flex items-center gap-2 font-medium">
                  <Compass size={14} className="text-amber-400" />
                  Live Dispatch Radar (Fleet Map)
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-400/20 text-amber-300">NEW</span>
              </li>
              <li
                onClick={() => onNavigateSection('settings' as AdminSection)}
                className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] p-2.5 hover:bg-white/[0.05] cursor-pointer transition"
              >
                <span className="flex items-center gap-2">
                  <Sliders size={14} className="text-amber-400" />
                  Surge Multipliers & Policies
                </span>
                <ArrowUpRight size={12} className="text-stone-500" />
              </li>
              <li
                onClick={() => onNavigateSection('drivers')}
                className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] p-2.5 hover:bg-white/[0.05] cursor-pointer transition"
              >
                <span className="flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-emerald-400" />
                  Review Driver Verification
                </span>
                <ArrowUpRight size={12} className="text-stone-500" />
              </li>
              <li
                onClick={() => onNavigateSection('rides')}
                className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] p-2.5 hover:bg-white/[0.05] cursor-pointer transition"
              >
                <span className="flex items-center gap-2">
                  <Car size={14} className="text-cyan-400" />
                  Live Rides Monitor
                </span>
                <ArrowUpRight size={12} className="text-stone-500" />
              </li>
              <li
                onClick={() => onNavigateSection('audit')}
                className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] p-2.5 hover:bg-white/[0.05] cursor-pointer transition"
              >
                <span className="flex items-center gap-2">
                  <Activity size={14} className="text-amber-400" />
                  Inspect Administrator Logs
                </span>
                <ArrowUpRight size={12} className="text-stone-500" />
              </li>
            </ul>
          </div>

          <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] text-amber-300/80">
            <strong>Audit Policy:</strong> Destructive modifications require mandatory justification
            persisted to the cryptographic audit log.
          </div>
        </div>
      </div>
    </div>
  );
};
