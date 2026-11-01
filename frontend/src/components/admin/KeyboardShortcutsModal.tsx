import { Command, X } from 'lucide-react';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  if (!isOpen) return null;

  const shortcuts = [
    { key: 'G then O', desc: 'Navigate to Overview & Command Center' },
    { key: 'G then M', desc: 'Open Live Dispatch Radar (Fleet Map)' },
    { key: 'G then U', desc: 'Open Users & Permissions Directory' },
    { key: 'G then D', desc: 'Open Drivers Fleet & KYC Review' },
    { key: 'G then R', desc: 'Open Live Rides & Dispatches' },
    { key: 'G then P', desc: 'Open Payments & Financial Ledger' },
    { key: 'G then S', desc: 'Open System Policies & Surge Settings' },
    { key: 'G then H', desc: 'Open Cluster Diagnostics & Health' },
    { key: 'G then A', desc: 'Open Cryptographic Audit Logs' },
    { key: '/', desc: 'Focus active search bar in current tab' },
    { key: 'Esc', desc: 'Close any active modal or side inspector' },
    { key: '?', desc: 'Toggle keyboard shortcuts quick reference' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-400/10 border border-amber-400/20 text-amber-400">
              <Command className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Keyboard Navigation</h3>
              <p className="text-xs text-slate-400">Hotkeys for high-speed administrative operations</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          {shortcuts.map(s => (
            <div
              key={s.key}
              className="flex items-center justify-between p-2.5 bg-slate-950/60 rounded-xl border border-slate-800/80"
            >
              <span className="text-slate-300 truncate pr-2">{s.desc}</span>
              <kbd className="px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-700/80 text-[11px] font-mono text-amber-300 flex-shrink-0">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>

        <div className="pt-2 text-center text-[11px] text-slate-500">
          Press <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">Esc</kbd> anytime to exit.
        </div>
      </div>
    </div>
  );
}
