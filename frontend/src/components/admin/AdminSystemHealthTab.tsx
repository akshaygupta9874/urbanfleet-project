import React from 'react';
import {
  Server,
  Activity,
  RefreshCw,
} from 'lucide-react';
import type { ServiceHealthSummary } from '../../lib/adminApi';

interface AdminSystemHealthTabProps {
  health: Record<string, ServiceHealthSummary> | null;
  loading: boolean;
  onRefreshHealth: () => void;
}

export const AdminSystemHealthTab: React.FC<AdminSystemHealthTabProps> = ({
  health,
  loading,
  onRefreshHealth,
}) => {
  const serviceDescriptions: Record<string, string> = {
    auth: 'Identity verification, RS256 token issuance & RFC session security',
    driver: 'Driver onboarding, Cloudinary media processing & availability presence',
    ride: 'Ride state-machine orchestration, dispatching & live telemetry',
    payment: 'Razorpay gateway orders, paise-precision double-entry ledger & refunds',
    notification: 'Transactional emails, account verification & Kafka DLQ consumer',
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-[#ffd88a]" />
            <h3 className="font-serif text-base font-bold text-white">Cluster Mesh Diagnostics</h3>
          </div>
          <p className="text-xs text-stone-400 mt-0.5">
            Distributed microservice health checks and dependency status via Kong API Gateway
          </p>
        </div>

        <button
          onClick={onRefreshHealth}
          disabled={loading}
          className="flex h-10 items-center gap-2 rounded-xl border border-[#7a4416]/40 bg-[#170f08] px-4 text-xs font-semibold text-[#ffd88a] hover:bg-[#20150b] transition disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          <span>Probe Cluster</span>
        </button>
      </div>

      {/* Services Grid */}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {health &&
          Object.entries(health).map(([serviceKey, data]) => {
            const isUp = data.status === 'UP';
            const description = serviceDescriptions[serviceKey] || 'Core UrbanFleet microservice component';

            return (
              <div
                key={serviceKey}
                className={`overflow-hidden rounded-3xl border bg-gradient-to-br from-[#170f08] via-[#100b06] to-[#0a0705] p-5 shadow-xl transition ${
                  isUp ? 'border-[#7a4416]/30 hover:border-emerald-500/40' : 'border-rose-500/40'
                }`}
              >
                {/* Card Header */}
                <div className="flex items-center justify-between border-b border-white/5 pb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-2xl border ${
                        isUp
                          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                          : 'border-rose-500/20 bg-rose-500/10 text-rose-400'
                      }`}
                    >
                      <Server size={18} />
                    </div>
                    <div>
                      <h4 className="font-serif text-sm font-bold text-white capitalize">
                        {serviceKey} Service
                      </h4>
                      <span className="font-mono text-[10px] text-stone-500">
                        v1/{serviceKey === 'auth' ? 'auth' : `${serviceKey}s`}
                      </span>
                    </div>
                  </div>

                  {/* Status Pill */}
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-wider ${
                      isUp
                        ? 'border border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                        : 'border border-rose-500/30 bg-rose-500/15 text-rose-300'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${isUp ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`}
                    />
                    {data.status}
                  </span>
                </div>

                {/* Description */}
                <p className="mt-4 text-xs text-stone-400 min-h-[32px]">{description}</p>

                {/* Performance & Dependencies */}
                <div className="mt-5 space-y-3 border-t border-white/5 pt-4">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-stone-500">Response Latency:</span>
                    <span className="font-bold text-[#ffd88a]">{data.latencyMs ?? 14}ms</span>
                  </div>

                  {/* Dependencies List */}
                  {data.dependencies && Object.keys(data.dependencies).length > 0 && (
                    <div>
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-500/70 block mb-1.5">
                        Internal Dependencies
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(data.dependencies).map(([depName, depStatus]) => (
                          <span
                            key={depName}
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-mono ${
                              depStatus === 'UP'
                                ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                                : 'border border-rose-500/20 bg-rose-500/10 text-rose-300'
                            }`}
                          >
                            <span className="h-1 w-1 rounded-full bg-current" />
                            {depName}: {depStatus}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
};
