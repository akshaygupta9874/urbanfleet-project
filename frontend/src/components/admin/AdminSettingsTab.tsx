import { useEffect, useState } from 'react';
import {
  Sliders,
  ShieldAlert,
  Zap,
  Clock,
  Car,
  AlertTriangle,
  Save,
  CheckCircle2,
  RefreshCw,
  Lock,
  Layers,
  Activity,
} from 'lucide-react';
import { adminApi, type SystemSettings } from '../../lib/adminApi';

interface AdminSettingsTabProps {
  onNotify?: (msg: string, type: 'success' | 'error') => void;
}

export function AdminSettingsTab({ onNotify }: AdminSettingsTabProps) {
  const [settings, setSettings] = useState<SystemSettings>({
    surgeMultiplier: 1.0,
    autoDriverVerification: false,
    maintenanceMode: false,
    maintenanceNotice: 'Scheduled platform maintenance in progress. Services will resume shortly.',
    sessionTimeoutMins: 1440,
    maxActiveRidesPerDriver: 1,
    updatedAt: new Date().toISOString(),
  });

  const [initialSettings, setInitialSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [justification, setJustification] = useState('');

  const fetchSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await adminApi.getSettings();
      setSettings(data);
      setInitialSettings(data);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to fetch system policies');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (justification.trim().length < 3) {
      setError('Audit justification must be at least 3 characters');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const updated = await adminApi.updateSettings({
        surgeMultiplier: settings.surgeMultiplier,
        autoDriverVerification: settings.autoDriverVerification,
        maintenanceMode: settings.maintenanceMode,
        maintenanceNotice: settings.maintenanceNotice,
        sessionTimeoutMins: settings.sessionTimeoutMins,
        maxActiveRidesPerDriver: settings.maxActiveRidesPerDriver,
        reason: justification.trim(),
      });
      setSettings(updated);
      setInitialSettings(updated);
      setConfirmModalOpen(false);
      setJustification('');
      if (onNotify) onNotify('System settings and dispatch policies updated successfully', 'success');
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to apply system policy update');
      if (onNotify) onNotify('Failed to apply system policies', 'error');
    } finally {
      setSaving(false);
    }
  };

  const hasChanges =
    initialSettings &&
    (settings.surgeMultiplier !== initialSettings.surgeMultiplier ||
      settings.autoDriverVerification !== initialSettings.autoDriverVerification ||
      settings.maintenanceMode !== initialSettings.maintenanceMode ||
      settings.maintenanceNotice !== initialSettings.maintenanceNotice ||
      settings.sessionTimeoutMins !== initialSettings.sessionTimeoutMins ||
      settings.maxActiveRidesPerDriver !== initialSettings.maxActiveRidesPerDriver);

  // Fare simulation calculation
  const sampleBaseFare = 50;
  const sampleDistanceFare = 150;
  const sampleSubtotal = (sampleBaseFare + sampleDistanceFare) * settings.surgeMultiplier;
  const samplePlatformFee = sampleSubtotal * 0.15;
  const sampleDriverEarning = sampleSubtotal * 0.85;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-semibold text-white">System Policies & Dispatch Controls</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Configure dynamic pricing multipliers, security parameters, and fleet dispatch thresholds.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchSettings}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Reload
          </button>
          <button
            onClick={() => setConfirmModalOpen(true)}
            disabled={!hasChanges || saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-medium bg-amber-400 text-slate-950 hover:bg-amber-300 transition shadow-lg shadow-amber-400/10 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            {hasChanges ? 'Apply Configuration Changes' : 'Saved to Cluster'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-4 flex items-center gap-3 text-rose-300 text-xs">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Dynamic Pricing & Simulation */}
        <div className="lg:col-span-2 space-y-6">
          {/* Dynamic Surge Pricing Multiplier */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-400/10 border border-amber-400/20 text-amber-400">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Dynamic Surge Multiplier</h3>
                  <p className="text-xs text-slate-400">Fleet pricing elasticity based on city demand pressure.</p>
                </div>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold font-mono text-amber-400">{settings.surgeMultiplier.toFixed(1)}x</span>
                <span className="block text-[10px] text-slate-500 uppercase tracking-wider">Active Multiplier</span>
              </div>
            </div>

            {/* Slider */}
            <div className="space-y-2 pt-2">
              <input
                type="range"
                min="1.0"
                max="3.0"
                step="0.1"
                value={settings.surgeMultiplier}
                onChange={e => setSettings(s => ({ ...s, surgeMultiplier: parseFloat(e.target.value) }))}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
              />
              <div className="flex justify-between text-[11px] font-mono text-slate-500">
                <span>1.0x (Standard)</span>
                <span>1.5x (Moderate)</span>
                <span>2.0x (High Peak)</span>
                <span>3.0x (Emergency Max)</span>
              </div>
            </div>

            {/* Live Pricing Simulation Box */}
            <div className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-4 text-xs space-y-3">
              <div className="flex items-center justify-between text-slate-400 border-b border-slate-800 pb-2">
                <span className="font-medium text-slate-300">Live Fare Simulation (Sample 8 km Trip)</span>
                <span className="font-mono text-[11px] text-amber-400">Rate: ₹{sampleSubtotal.toFixed(0)}</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800/60">
                  <span className="text-[10px] text-slate-500 uppercase block">Rider Charge</span>
                  <span className="text-sm font-bold font-mono text-white">₹{sampleSubtotal.toFixed(0)}</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Base + {settings.surgeMultiplier}x Surge</span>
                </div>
                <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800/60">
                  <span className="text-[10px] text-slate-500 uppercase block">Driver Payout (85%)</span>
                  <span className="text-sm font-bold font-mono text-emerald-400">₹{sampleDriverEarning.toFixed(0)}</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Direct settlement</span>
                </div>
                <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800/60">
                  <span className="text-[10px] text-slate-500 uppercase block">Platform Net (15%)</span>
                  <span className="text-sm font-bold font-mono text-amber-300">₹{samplePlatformFee.toFixed(0)}</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">UrbanFleet commission</span>
                </div>
              </div>
            </div>
          </div>

          {/* Operational Policy Toggles */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-6 space-y-5">
            <h3 className="text-sm font-semibold text-white">Operational Flags & Security Governance</h3>

            <div className="space-y-4">
              {/* Maintenance Mode */}
              <div className="flex items-start justify-between p-4 bg-slate-950/60 border border-slate-800/80 rounded-2xl">
                <div className="space-y-1 pr-4">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-rose-400" />
                    <span className="text-xs font-semibold text-white">Platform Maintenance Window</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    When active, riders and drivers see an advisory banner. Dispatches operate in restricted mode.
                  </p>
                  {settings.maintenanceMode && (
                    <input
                      type="text"
                      value={settings.maintenanceNotice}
                      onChange={e => setSettings(s => ({ ...s, maintenanceNotice: e.target.value }))}
                      className="w-full mt-2 bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white"
                      placeholder="Maintenance banner message..."
                    />
                  )}
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.maintenanceMode}
                    onChange={e => setSettings(s => ({ ...s, maintenanceMode: e.target.checked }))}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-500"></div>
                </label>
              </div>

              {/* Auto Driver KYC Verification Sandbox */}
              <div className="flex items-start justify-between p-4 bg-slate-950/60 border border-slate-800/80 rounded-2xl">
                <div className="space-y-1 pr-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-semibold text-white">Driver Auto-Verification Sandbox</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Bypasses manual KYC queue for instant driver onboarding during testing and load staging.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.autoDriverVerification}
                    onChange={e => setSettings(s => ({ ...s, autoDriverVerification: e.target.checked }))}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>

              {/* Session Inactivity Timeout */}
              <div className="p-4 bg-slate-950/60 border border-slate-800/80 rounded-2xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <div>
                    <span className="text-xs font-semibold text-white block">Session Inactivity Timeout</span>
                    <span className="text-[11px] text-slate-400">Idle JWT & Redis token revocation threshold</span>
                  </div>
                </div>
                <select
                  value={settings.sessionTimeoutMins}
                  onChange={e => setSettings(s => ({ ...s, sessionTimeoutMins: parseInt(e.target.value) }))}
                  className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none"
                >
                  <option value={15}>15 Minutes</option>
                  <option value={60}>1 Hour</option>
                  <option value={360}>6 Hours</option>
                  <option value={1440}>24 Hours (Standard)</option>
                  <option value={10080}>7 Days</option>
                </select>
              </div>

              {/* Max Active Dispatches per Driver */}
              <div className="p-4 bg-slate-950/60 border border-slate-800/80 rounded-2xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Car className="w-4 h-4 text-emerald-400" />
                  <div>
                    <span className="text-xs font-semibold text-white block">Max Active Rides per Driver</span>
                    <span className="text-[11px] text-slate-400">Disallow multiple simultaneous ride assignments</span>
                  </div>
                </div>
                <select
                  value={settings.maxActiveRidesPerDriver}
                  onChange={e => setSettings(s => ({ ...s, maxActiveRidesPerDriver: parseInt(e.target.value) }))}
                  className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none"
                >
                  <option value={1}>1 Ride (Strict Isolation)</option>
                  <option value={2}>2 Rides (Carpooling Demo)</option>
                  <option value={3}>3 Rides</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Cluster Architecture Policy Card */}
        <div className="space-y-6">
          <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-white">Cluster Security Standards</h3>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/80 space-y-1">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">JWT Signing Algorithm</div>
                <div className="text-emerald-400 font-mono font-medium flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" />
                  RS256 (2048-bit Asymmetric Keypair)
                </div>
                <div className="text-[11px] text-slate-400">Public key verified statelessly by edge proxies.</div>
              </div>

              <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/80 space-y-1">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Kafka Durability Guarantee</div>
                <div className="text-amber-300 font-mono font-medium flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5" />
                  acks = -1 (all ISR replicas)
                </div>
                <div className="text-[11px] text-slate-400">Dead Letter Queue (DLQ) triggers after 5 failed deliveries.</div>
              </div>

              <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/80 space-y-1">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Session Validation Mode</div>
                <div className="text-sky-300 font-mono font-medium">
                  Redis Dual-Check + PostgreSQL Store
                </div>
                <div className="text-[11px] text-slate-400">Fail-closed session state with real-time remote revocation.</div>
              </div>

              <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/80 space-y-1">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">API Gateway Rate Limit</div>
                <div className="text-slate-200 font-mono font-medium">
                  60 requests / minute / IP
                </div>
                <div className="text-[11px] text-slate-400">Managed via Kong Declarative Proxy Plugin.</div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-500 font-mono">
              Last configuration sync: {new Date(settings.updatedAt).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-amber-400/10 border border-amber-400/20 text-amber-400">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">Confirm Policy Changes</h3>
                <p className="text-xs text-slate-400">This action modifies cluster-wide operational behavior.</p>
              </div>
            </div>

            <form onSubmit={handleSaveSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300 block">
                  Mandatory Audit Justification <span className="text-rose-400">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={justification}
                  onChange={e => setJustification(e.target.value)}
                  placeholder="Explain why these operational policies are being adjusted (e.g. Peak hour surge activation, scheduled maintenance)..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || justification.trim().length < 3}
                  className="px-5 py-2 rounded-xl text-xs font-medium bg-amber-400 text-slate-950 hover:bg-amber-300 transition shadow-lg shadow-amber-400/10 disabled:opacity-50"
                >
                  {saving ? 'Recording Audit...' : 'Confirm & Apply'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
