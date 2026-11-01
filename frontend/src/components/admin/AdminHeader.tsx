import React, { useState, useEffect } from 'react';
import {
  RefreshCw,
  LogOut,
  ArrowLeft,
  Menu,
  Activity,
  Shield,
  HelpCircle,
  Car,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '../../context/auth-context';

interface AdminHeaderProps {
  onRefresh: () => void;
  loading: boolean;
  onToggleMobileNav: () => void;
  onOpenShortcuts?: () => void;
  refreshInterval?: number;
  onIntervalChange?: (intervalSeconds: number) => void;
}

export const AdminHeader: React.FC<AdminHeaderProps> = ({
  onRefresh,
  loading,
  onToggleMobileNav,
  onOpenShortcuts,
  refreshInterval = 15,
  onIntervalChange,
}) => {
  const navigate = useNavigate();
  const { user, logout } = useAuthContext();
  const [timeString, setTimeString] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeString(
        now.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }) + ' UTC'
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-20 items-center justify-between border-b border-[#7a4416]/25 bg-[#0a0705]/90 px-6 backdrop-blur-xl lg:px-10">
      {/* Left: Mobile Nav Toggle + Title */}
      <div className="flex items-center gap-4">
        <button
          onClick={onToggleMobileNav}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#7a4416]/30 bg-[#170f08] text-amber-200 lg:hidden hover:border-[#ffd88a]/50"
          aria-label="Toggle Navigation"
        >
          <Menu size={18} />
        </button>

        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#ffd88a] via-[#e2b76a] to-[#c58a3a] text-[#1f1207] shadow-lg shadow-amber-950/40 font-bold">
            <Shield size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-serif text-lg font-black tracking-tight text-white lg:text-xl">
                UrbanFleet Operations
              </h1>
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                LIVE CLUSTER
              </span>
            </div>
            <p className="text-xs text-amber-200/60 hidden sm:block">
              Centralized Microservices Management & Operations Console
            </p>
          </div>
        </div>
      </div>

      {/* Right: Clock + Auto-Refresh + Shortcuts + Profile Menu */}
      <div className="flex items-center gap-3">
        {/* Real-time Clock */}
        <div className="hidden items-center gap-2 rounded-xl border border-white/5 bg-black/40 px-3 py-1.5 font-mono text-xs text-amber-300/80 xl:flex">
          <Activity size={13} className="text-emerald-400 animate-pulse" />
          <span>{timeString}</span>
        </div>

        {/* Refresh Interval Selector */}
        {onIntervalChange && (
          <div className="hidden sm:flex items-center gap-1.5 bg-[#170f08] border border-[#7a4416]/30 rounded-xl px-2.5 py-1 text-xs">
            <span className="text-[10px] text-stone-500 uppercase tracking-wider">Sync:</span>
            <select
              value={refreshInterval}
              onChange={(e) => onIntervalChange(parseInt(e.target.value, 10))}
              className="bg-transparent text-amber-300 text-xs font-semibold focus:outline-none cursor-pointer"
            >
              <option value={10} className="bg-slate-900 text-white">Live (10s)</option>
              <option value={30} className="bg-slate-900 text-white">30s</option>
              <option value={60} className="bg-slate-900 text-white">1m</option>
              <option value={0} className="bg-slate-900 text-white">Manual</option>
            </select>
          </div>
        )}

        {/* Refresh Button */}
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex h-10 items-center gap-2 rounded-xl border border-[#7a4416]/30 bg-[#170f08] px-3.5 text-xs font-semibold text-amber-200 hover:border-[#ffd88a]/50 hover:bg-[#20150b] active:scale-95 transition disabled:opacity-50"
          title="Refresh Operations Data (Ctrl+R)"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin text-amber-400' : ''} />
          <span className="hidden sm:inline">{loading ? 'Syncing...' : 'Sync Data'}</span>
        </button>

        {/* Keyboard Shortcuts Trigger */}
        {onOpenShortcuts && (
          <button
            onClick={onOpenShortcuts}
            className="hidden sm:flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-stone-300 hover:bg-white/10 hover:text-white transition"
            title="Keyboard Shortcuts (?)"
          >
            <HelpCircle size={16} />
          </button>
        )}

        {/* Back to Apps Buttons */}
        <div className="hidden md:flex items-center gap-1.5">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex h-10 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2.5 text-xs font-medium text-stone-300 hover:bg-white/10 hover:text-white transition"
            title="Switch to Passenger Dashboard"
          >
            <ArrowLeft size={13} />
            <span>Passenger</span>
          </button>
          <button
            onClick={() => navigate('/driver')}
            className="flex h-10 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2.5 text-xs font-medium text-stone-300 hover:bg-white/10 hover:text-white transition"
            title="Switch to Driver Dashboard"
          >
            <Car size={13} />
            <span>Driver</span>
          </button>
        </div>

        {/* Admin Profile Pill */}
        <div className="flex items-center gap-2.5 rounded-2xl border border-[#7a4416]/30 bg-[#170f08] p-1.5 pl-3">
          <div className="hidden text-right lg:block">
            <p className="text-xs font-bold text-white leading-tight">
              {user?.firstName ? `${user.firstName} ${user.lastName || ''}` : 'Administrator'}
            </p>
            <p className="text-[10px] font-mono font-bold text-[#ffd88a] uppercase tracking-wider">
              Super Admin
            </p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] text-xs font-black text-[#ffd88a]">
            {user?.firstName?.[0] || 'A'}
          </div>
          <button
            onClick={() => void logout()}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-stone-400 hover:bg-rose-950/20 hover:text-rose-400 transition"
            title="Sign out of Admin Console"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </header>
  );
};
