import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X, CheckCircle2, ShieldCheck, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';

export interface AdminActionModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  targetId: string;
  actionType: 'SUSPEND_USER' | 'RESTORE_USER' | 'VERIFY_DRIVER' | 'REFUND_PAYMENT' | 'REVOKE_SESSION';
  initialStatus?: string;
  onClose: () => void;
  onConfirm: (payload: { reason: string; status?: string; amountPaise?: number; idempotencyKey?: string }) => Promise<void>;
}

export const AdminActionModal: React.FC<AdminActionModalProps> = ({
  isOpen,
  title,
  description,
  targetId,
  actionType,
  initialStatus = 'APPROVED',
  onClose,
  onConfirm,
}) => {
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState(initialStatus);
  const [amountRupees, setAmountRupees] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (reason.trim().length < 3) {
      setError('Please provide a reason with at least 3 characters.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const amountPaise = amountRupees.trim() ? Math.round(parseFloat(amountRupees) * 100) : undefined;
      const idempotencyKey =
        actionType === 'REFUND_PAYMENT'
          ? typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `idemp-${Date.now()}`
          : undefined;

      await onConfirm({
        reason: reason.trim(),
        status: actionType === 'VERIFY_DRIVER' ? status : undefined,
        amountPaise,
        idempotencyKey,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action execution failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/80 backdrop-blur-md"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="relative z-10 w-full max-w-lg overflow-hidden rounded-3xl border border-[#7a4416]/30 bg-gradient-to-b from-[#1a120b] via-[#120d08] to-[#0a0705] p-6 shadow-2xl shadow-black/80 text-amber-50"
        >
          {/* Top highlight bar */}
          <div className="pointer-events-none absolute inset-x-8 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#ffd88a]/60 to-transparent" />

          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] border border-[#ffd88a]/20 text-[#ffd88a]">
                {actionType === 'VERIFY_DRIVER' && <ShieldCheck size={20} />}
                {actionType === 'REFUND_PAYMENT' && <RefreshCw size={20} />}
                {actionType === 'SUSPEND_USER' && <AlertTriangle size={20} className="text-rose-400" />}
                {actionType === 'RESTORE_USER' && <CheckCircle2 size={20} className="text-emerald-400" />}
                {actionType === 'REVOKE_SESSION' && <AlertTriangle size={20} className="text-amber-400" />}
              </div>
              <div>
                <h3 className="font-serif text-lg font-bold tracking-tight text-white">{title}</h3>
                <p className="text-xs text-amber-200/70">{description}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={submitting}
              className="rounded-xl p-1.5 text-amber-400/60 hover:bg-white/5 hover:text-white transition"
            >
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {/* Target ID Identifier Pill */}
            <div className="rounded-2xl border border-white/5 bg-black/40 p-3 text-xs">
              <span className="text-stone-400 uppercase font-mono text-[10px]">Resource Reference</span>
              <p className="font-mono text-amber-300 break-all">{targetId}</p>
            </div>

            {/* Optional Status Selection for Driver Verification */}
            {actionType === 'VERIFY_DRIVER' && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-stone-300">
                  Verification Decision
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-black/50 px-3.5 py-2.5 text-xs text-white focus:border-[#ffd88a] focus:outline-none"
                >
                  <option value="APPROVED">APPROVE Driver (Verify all KYC documents)</option>
                  <option value="UNDER_REVIEW">Move to UNDER_REVIEW (Need clarification)</option>
                  <option value="REJECTED">REJECT Application (Deficient docs)</option>
                  <option value="SUSPENDED">SUSPEND Driver (Safety investigation)</option>
                </select>
              </div>
            )}

            {/* Optional Partial Amount for Refund */}
            {actionType === 'REFUND_PAYMENT' && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-stone-300">
                  Refund Amount (₹) <span className="text-stone-500 font-normal">(Leave blank for full refund)</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  placeholder="e.g. 250.00"
                  value={amountRupees}
                  onChange={(e) => setAmountRupees(e.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-black/50 px-3.5 py-2.5 text-xs text-white placeholder-stone-500 focus:border-[#ffd88a] focus:outline-none"
                />
              </div>
            )}

            {/* Mandatory Audit Justification Reason */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-stone-300">
                Action Reason <span className="text-amber-400">*</span>
              </label>
              <textarea
                rows={3}
                required
                placeholder="Enter formal justification for audit and compliance logs..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black/50 p-3 text-xs text-white placeholder-stone-500 focus:border-[#ffd88a] focus:outline-none"
              />
              <p className="text-[10px] text-stone-400">
                This explanation will be permanently recorded in the cryptographic audit journal.
              </p>
            </div>

            {error && (
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300">
                {error}
              </div>
            )}

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
                disabled={submitting}
                className="rounded-2xl border-white/10 bg-white/5 text-stone-300 hover:bg-white/10 hover:text-white"
              >
                Cancel
              </Button>

              <Button
                type="submit"
                variant="default"
                size="sm"
                disabled={submitting}
                className="rounded-2xl font-bold shadow-lg shadow-amber-500/20"
              >
                {submitting ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 size={13} className="animate-spin" />
                    Executing...
                  </span>
                ) : (
                  'Confirm & Authorize'
                )}
              </Button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
