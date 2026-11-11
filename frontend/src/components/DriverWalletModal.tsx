import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Wallet,
  ArrowDownRight,
  ArrowUpRight,
  IndianRupee,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  CreditCard,
  Building2,
  Pencil,
} from "lucide-react";
import { appApi } from "../lib/api";
import { fetchDriverProfile } from "../lib/driverApi";

export interface DriverBalance {
  earnedPaise: number;
  debitedPaise: number;
  balancePaise: number;
  reservedPaise: number;
  availablePaise: number;
}

export interface PayoutRecord {
  id: string;
  driverId: string;
  rideId?: string;
  amountPaise: number;
  status: "PENDING" | "PROCESSING" | "PROCESSED" | "FAILED" | "REVERSED";
  mode: string;
  createdAt: string;
  updatedAt?: string;
}

interface DriverWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenBankDetails?: () => void;
  initialBalance?: DriverBalance | null;
  driverId?: string;
  effectiveEarningsPaise?: number;
}

const DISPLAY_FONT = "'Fraunces', Georgia, serif";
const MONO_FONT = "'JetBrains Mono', ui-monospace, 'SF Mono', monospace";

export default function DriverWalletModal({
  isOpen,
  onClose,
  onOpenBankDetails,
  initialBalance,
  driverId,
  effectiveEarningsPaise,
}: DriverWalletModalProps) {
  const [balance, setBalance] = useState<DriverBalance | null>(initialBalance ?? null);
  const [payouts, setPayouts] = useState<PayoutRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [payoutSuccessMsg, setPayoutSuccessMsg] = useState("");

  useEffect(() => {
    if (initialBalance) {
      setBalance(initialBalance);
    }
  }, [initialBalance]);

  // Payout request form
  const [payoutAmount, setPayoutAmount] = useState<string>("");
  const [payoutMode, setPayoutMode] = useState<"UPI" | "IMPS">("UPI");
  const [upiId, setUpiId] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");
  const [accountHolderName, setAccountHolderName] = useState("");
  const [bankName, setBankName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const modalRef = useRef<HTMLDivElement | null>(null);

  const formatPaise = (paise: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 2,
    }).format((paise || 0) / 100);
  };

  const effectiveTotalEarned = Math.max(
    Number(balance?.earnedPaise ?? 0),
    Number(initialBalance?.earnedPaise ?? 0),
    Number(effectiveEarningsPaise ?? 0)
  );

  const effectiveDebited = Number(
    balance?.debitedPaise ?? initialBalance?.debitedPaise ?? 0
  );

  const effectiveReserved = Number(
    balance?.reservedPaise ?? initialBalance?.reservedPaise ?? 0
  );

  const rawAvailable = Number(
    balance?.availablePaise ?? initialBalance?.availablePaise ?? 0
  );

  const effectiveAvailable =
    rawAvailable > 0
      ? rawAvailable
      : Math.max(0, effectiveTotalEarned - effectiveDebited - effectiveReserved);

  const fetchWalletData = useCallback(async () => {
    try {
      setError("");
      const payoutsUrl = driverId ? `/payments/payouts?driverId=${encodeURIComponent(driverId)}` : "/payments/payouts";
      const [balResult, payoutsResult, profileResult] = await Promise.allSettled([
        appApi.get<{ success: boolean; data: DriverBalance }>("/payments/payouts/balance"),
        appApi.get<{ success: boolean; data: PayoutRecord[] }>(payoutsUrl),
        fetchDriverProfile(),
      ]);

      if (balResult.status === "fulfilled" && balResult.value?.data?.data) {
        setBalance(balResult.value.data.data);
      }

      if (payoutsResult.status === "fulfilled" && payoutsResult.value?.data?.data) {
        setPayouts(payoutsResult.value.data.data || []);
      }

      if (profileResult.status === "fulfilled" && profileResult.value) {
        const profile = profileResult.value;
        setUpiId(profile.upiId || "");
        setAccountNumber(profile.accountNumber || "");
        setIfscCode(profile.ifscCode || "");
        setAccountHolderName(profile.accountHolderName || "");
        setBankName(profile.bankName || "");
      }
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data
        ?.message;
      setError(message || "Failed to load wallet data. Please try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [driverId]);

  useEffect(() => {
    if (isOpen) {
      void Promise.resolve().then(() => fetchWalletData());
    }
  }, [isOpen, fetchWalletData]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchWalletData();
  };

  const handleRequestPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(payoutAmount);
    if (!amountNum || amountNum <= 0) {
      setError("Please enter a valid amount greater than ₹0");
      return;
    }

    const availableRupees = effectiveAvailable / 100;
    if (amountNum > availableRupees) {
      setError(
        `Requested amount exceeds available balance (${formatPaise(effectiveAvailable)})`
      );
      return;
    }

    if (payoutMode === "UPI" && !upiId.trim()) {
      setError("No registered UPI ID found. Please update your bank details first.");
      return;
    }

    if (payoutMode === "IMPS" && (!accountNumber.trim() || !ifscCode.trim())) {
      setError("No registered Bank Account/IFSC found. Please update your bank details first.");
      return;
    }

    setIsSubmitting(true);
    setError("");
    setPayoutSuccessMsg("");

    try {
      const amountPaise = Math.round(amountNum * 100);
      await appApi.post<{ success: boolean; data: PayoutRecord }>("/payments/payouts/request", {
        amountPaise,
        mode: payoutMode,
        ...(driverId ? { driverId } : {}),
      });

      setPayoutSuccessMsg(`Payout of ${formatPaise(amountPaise)} successfully queued for settlement.`);
      setPayoutAmount("");
      fetchWalletData();
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data
        ?.message;
      setError(message || "Failed to request payout. Please verify your details.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div
        onClick={onClose}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-6 backdrop-blur-md"
      >
        <style>{`
          .dw-scroll::-webkit-scrollbar { width: 5px; height: 5px; }
          .dw-scroll::-webkit-scrollbar-thumb { background: #c58a3a; border-radius: 999px; }
        `}</style>

        <motion.div
          ref={modalRef}
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[2rem] sm:rounded-[2.25rem] border border-[#fff4dc]/80 bg-gradient-to-b from-[#fffdf9]/98 via-[#fff4dc]/95 to-[#f7e2b8]/95 shadow-[0_24px_70px_rgba(28,15,5,0.45)] backdrop-blur-2xl transform-gpu"
        >
          {/* Top Shimmer Accent */}
          <div className="pointer-events-none absolute inset-x-10 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

          {/* Header Bar */}
          <div className="flex items-center justify-between border-b border-[#7a4416]/20 bg-gradient-to-r from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-5 sm:px-7 py-4 text-[#ffd88a]">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#c58a3a]/40 bg-gradient-to-br from-[#3a1f0a] to-[#241205] text-[#ffd88a] shadow-inner">
                <Wallet className="h-5 w-5" />
              </div>
              <div>
                <h2
                  className="text-lg sm:text-xl font-black text-white tracking-tight"
                  style={{ fontFamily: DISPLAY_FONT }}
                >
                  Driver Wallet & Payouts
                </h2>
                <p className="text-[11px] sm:text-xs text-[#ffd88a]/80">
                  Instant UPI disbursements & audited ledger
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing || loading}
                className="grid h-9 w-9 place-items-center rounded-xl border border-[#c58a3a]/40 bg-[#3a1f0a] text-[#ffd88a] transition hover:bg-[#6b3a12] active:scale-95 disabled:opacity-50"
                title="Refresh Ledger"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="grid h-9 w-9 place-items-center rounded-xl border border-[#c58a3a]/40 bg-[#3a1f0a] text-[#ffd88a] transition hover:bg-rose-950/60 active:scale-95"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Scrollable Content */}
          <div className="dw-scroll flex-1 space-y-6 overflow-y-auto p-4 sm:p-7">
            {/* Error & Success Toasts */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="flex items-center gap-2.5 rounded-2xl border border-rose-500/40 bg-rose-950/20 p-4 text-xs font-semibold text-rose-950 shadow-sm"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-700" />
                  <span>{error}</span>
                </motion.div>
              )}

              {payoutSuccessMsg && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="flex items-center gap-2.5 rounded-2xl border border-emerald-500/40 bg-emerald-950/15 p-4 text-xs font-semibold text-emerald-950 shadow-sm"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
                  <span>{payoutSuccessMsg}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Balance Cards Grid — Responsive 2x2 on Mobile / 4-Col on Desktop */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {/* Available Balance (Hero Card) */}
              <div className="relative overflow-hidden rounded-2xl border border-[#c58a3a]/50 bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] p-4 text-[#ffe9be] shadow-lg">
                <div className="flex items-center justify-between text-[10px] sm:text-xs font-bold uppercase tracking-wider text-[#ffd88a]">
                  <span>Available Payout</span>
                  <IndianRupee className="h-3.5 w-3.5 text-[#ffd88a]" />
                </div>
                <p
                  className="mt-2.5 text-xl sm:text-2xl font-black text-white console-readout tracking-tight"
                  style={{ fontFamily: DISPLAY_FONT }}
                >
                  {loading && !balance && !initialBalance && !effectiveEarningsPaise ? "..." : formatPaise(effectiveAvailable)}
                </p>
                <p className="mt-1 text-[10.5px] text-[#ffd88a]/80">Ready to withdraw</p>
              </div>

              {/* Total Earned */}
              <div className="rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9] p-4 shadow-xs">
                <div className="flex items-center justify-between text-[10px] sm:text-xs font-bold uppercase tracking-wider text-[#7a4416]">
                  <span>Total Earned</span>
                  <ArrowDownRight className="h-3.5 w-3.5 text-emerald-700" />
                </div>
                <p className="mt-2.5 text-lg sm:text-xl font-black text-[#2e1808] console-readout">
                  {loading && !balance && !initialBalance && !effectiveEarningsPaise ? "..." : formatPaise(effectiveTotalEarned)}
                </p>
                <p className="mt-1 text-[10.5px] font-medium text-[#6b3a12]">Gross ledger credit</p>
              </div>

              {/* Settled Payouts */}
              <div className="rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9] p-4 shadow-xs">
                <div className="flex items-center justify-between text-[10px] sm:text-xs font-bold uppercase tracking-wider text-[#7a4416]">
                  <span>Settled Payouts</span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-[#b8722c]" />
                </div>
                <p className="mt-2.5 text-lg sm:text-xl font-black text-[#2e1808] console-readout">
                  {formatPaise(effectiveDebited)}
                </p>
                <p className="mt-1 text-[10.5px] font-medium text-[#6b3a12]">Transferred to bank</p>
              </div>

              {/* Reserved / In-Flight */}
              <div className="rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9] p-4 shadow-xs">
                <div className="flex items-center justify-between text-[10px] sm:text-xs font-bold uppercase tracking-wider text-[#7a4416]">
                  <span>In-Flight</span>
                  <Clock className="h-3.5 w-3.5 text-amber-600" />
                </div>
                <p className="mt-2.5 text-lg sm:text-xl font-black text-[#2e1808] console-readout">
                  {formatPaise(effectiveReserved)}
                </p>
                <p className="mt-1 text-[10.5px] font-medium text-[#6b3a12]">Pending bank gateway</p>
              </div>
            </div>

            {/* Request Payout Form Section */}
            <section className="rounded-2xl border border-[#c58a3a]/40 bg-gradient-to-br from-[#fffdf9] via-[#fff4dc] to-[#f7e2b8] p-5 shadow-md">
              <div className="flex items-center justify-between border-b border-[#7a4416]/20 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-[#3a1f0a] text-[#ffd88a]">
                    <Send className="h-4 w-4" />
                  </div>
                  <div>
                    <h3
                      className="text-base font-black text-[#2e1808]"
                      style={{ fontFamily: DISPLAY_FONT }}
                    >
                      Instant Bank Disbursement
                    </h3>
                    <p className="text-[11px] text-[#7a4416]">
                      Zero transfer fees • Processed instantly via Razorpay Payouts
                    </p>
                  </div>
                </div>
                <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-950/15 border border-emerald-600/35 px-2.5 py-0.5 text-[10px] font-bold text-emerald-900">
                  <ShieldCheck className="h-3 w-3 text-emerald-700" /> Secure
                </span>
              </div>

              <form onSubmit={handleRequestPayout} className="space-y-4">
                {/* Amount Input with Preset Chips */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#3a1f0a] mb-1.5">
                    Withdrawal Amount (₹)
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-base font-black text-[#7a4416]">
                      ₹
                    </span>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      max={effectiveAvailable / 100}
                      placeholder="Enter amount to withdraw"
                      value={payoutAmount}
                      onChange={(e) => setPayoutAmount(e.target.value)}
                      className="h-12 w-full rounded-xl border border-[#7a4416]/30 bg-[#fffdf9] pl-9 pr-4 text-base font-extrabold text-[#2e1808] outline-none transition focus:border-[#3a1f0a] focus:ring-2 focus:ring-[#c58a3a]/25 console-readout shadow-2xs"
                    />
                  </div>

                  {/* Preset Chips */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    {[500, 1000, 2000].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setPayoutAmount(preset.toString())}
                        className="rounded-xl border border-[#7a4416]/25 bg-[#fffaf0] px-3 py-1 text-xs font-bold text-[#6b3a12] transition hover:bg-[#fff4dc] active:scale-95 shadow-2xs"
                      >
                        ₹{preset}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        const availRupees = Math.floor(effectiveAvailable / 100);
                        if (availRupees > 0) setPayoutAmount(availRupees.toString());
                      }}
                      className="rounded-xl border border-[#c58a3a]/40 bg-gradient-to-r from-[#ffd88a]/40 to-[#f4b860]/40 px-3.5 py-1 text-xs font-black text-[#3a1f0a] transition hover:opacity-95 active:scale-95 shadow-2xs"
                    >
                      Withdraw All ({formatPaise(effectiveAvailable)})
                    </button>
                  </div>
                </div>

                {/* Transfer Mode Selector */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#3a1f0a] mb-1.5">
                    Transfer Mode
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setPayoutMode("UPI")}
                      className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-xs font-bold transition active:scale-95 ${
                        payoutMode === "UPI"
                          ? "border-[#c58a3a] bg-gradient-to-br from-[#3a1f0a] to-[#6b3a12] text-[#ffd88a] shadow-md"
                          : "border-[#7a4416]/25 bg-[#fffaf0] text-[#6b3a12] hover:bg-[#fff4dc]"
                      }`}
                    >
                      <CreditCard className="h-4 w-4" />
                      Instant UPI VPA
                    </button>
                    <button
                      type="button"
                      onClick={() => setPayoutMode("IMPS")}
                      className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-xs font-bold transition active:scale-95 ${
                        payoutMode === "IMPS"
                          ? "border-[#c58a3a] bg-gradient-to-br from-[#3a1f0a] to-[#6b3a12] text-[#ffd88a] shadow-md"
                          : "border-[#7a4416]/25 bg-[#fffaf0] text-[#6b3a12] hover:bg-[#fff4dc]"
                      }`}
                    >
                      <Building2 className="h-4 w-4" />
                      Bank Account (IMPS)
                    </button>
                  </div>
                </div>

                {/* Pre-configured Destination Preview Card */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#3a1f0a] mb-1.5">
                    Payout Destination (Pre-Configured)
                  </label>
                  {payoutMode === "UPI" ? (
                    <div className="flex items-center justify-between rounded-xl border border-[#c58a3a]/40 bg-[#fffdf9] p-3.5 shadow-2xs">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#3a1f0a] to-[#6b3a12] text-[#ffd88a]">
                          <CreditCard className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-xs font-bold text-[#2e1808]">
                              {upiId || "No UPI ID registered"}
                            </span>
                            <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                              <CheckCircle2 className="h-3 w-3" /> Ready
                            </span>
                          </div>
                          <p className="text-[11px] text-[#7a4416]">
                            Instant transfer to your VPA
                          </p>
                        </div>
                      </div>
                      {onOpenBankDetails && (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onOpenBankDetails();
                          }}
                          className="flex shrink-0 items-center gap-1 rounded-lg border border-[#7a4416]/25 bg-[#fffaf0] px-3 py-1.5 text-xs font-bold text-[#6b3a12] hover:bg-[#fff4dc] transition-colors"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between rounded-xl border border-[#c58a3a]/40 bg-[#fffdf9] p-3.5 shadow-2xs">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#3a1f0a] to-[#6b3a12] text-[#ffd88a]">
                          <Building2 className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-xs font-bold text-[#2e1808]">
                              {accountNumber
                                ? `${bankName ? bankName + " • " : ""}A/C: •••• ${accountNumber.slice(-4)}`
                                : "No Bank Account registered"}
                            </span>
                            <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                              <CheckCircle2 className="h-3 w-3" /> Ready
                            </span>
                          </div>
                          <p className="text-[11px] text-[#7a4416]">
                            IFSC: {ifscCode || "N/A"} • Holder: {accountHolderName || "Driver"}
                          </p>
                        </div>
                      </div>
                      {onOpenBankDetails && (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onOpenBankDetails();
                          }}
                          className="flex shrink-0 items-center gap-1 rounded-lg border border-[#7a4416]/25 bg-[#fffaf0] px-3 py-1.5 text-xs font-bold text-[#6b3a12] hover:bg-[#fff4dc] transition-colors"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || effectiveAvailable <= 0}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] py-3.5 text-xs font-bold uppercase tracking-wider text-[#ffe9be] shadow-lg transition hover:opacity-95 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin text-[#ffd88a]" />
                      <span>Initiating Transfer...</span>
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 text-[#ffd88a]" />
                      <span>Disburse Payout Now</span>
                    </>
                  )}
                </button>
              </form>
            </section>

            {/* Disbursement History Audit Trail */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-xs uppercase tracking-wider text-[#7a4416]">
                  Recent Disbursement History
                </h3>
                <span className="text-xs font-semibold text-[#7a4416] console-readout">
                  {payouts.length} {payouts.length === 1 ? "Payout" : "Payouts"}
                </span>
              </div>

              {payouts.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#7a4416]/25 bg-[#fffdf9]/60 py-10 text-center text-[#7a4416]">
                  <Clock className="h-8 w-8 text-[#b8722c]/50 mb-2" />
                  <p className="text-xs font-bold">No payouts recorded yet</p>
                  <p className="text-[11px] text-[#7a4416]/75 mt-0.5">
                    When you withdraw earnings, settled disbursements will appear here.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {payouts.map((p) => {
                    const isSuccess = p.status === "PROCESSED";
                    const isPending = p.status === "PENDING" || p.status === "PROCESSING";
                    const isReversed = p.status === "REVERSED";

                    return (
                      <div
                        key={p.id}
                        className="flex items-center justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9] p-3.5 shadow-2xs transition hover:border-[#b8722c]"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl font-bold text-xs ${
                              isSuccess
                                ? "bg-emerald-950/15 text-emerald-800 border border-emerald-600/30"
                                : isPending
                                  ? "bg-amber-950/15 text-amber-800 border border-amber-600/30"
                                  : isReversed
                                    ? "bg-blue-950/15 text-blue-800 border border-blue-600/30"
                                    : "bg-rose-950/15 text-rose-800 border border-rose-600/30"
                            }`}
                          >
                            {p.mode === "UPI" ? (
                              <CreditCard className="h-4 w-4" />
                            ) : (
                              <Building2 className="h-4 w-4" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-black text-[#2e1808] console-readout">
                                {formatPaise(p.amountPaise)}
                              </span>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold ${
                                  isSuccess
                                    ? "bg-emerald-500/15 text-emerald-800"
                                    : isPending
                                      ? "bg-amber-500/15 text-amber-800"
                                      : isReversed
                                        ? "bg-blue-500/15 text-blue-800"
                                        : "bg-rose-500/15 text-rose-800"
                                }`}
                              >
                                {p.status}
                              </span>
                            </div>
                            <p className="text-[11px] text-[#7a4416] mt-0.5">
                              {new Date(p.createdAt).toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </p>
                          </div>
                        </div>
                        <span
                          className="text-xs console-readout font-bold text-[#6b3a12] shrink-0 bg-[#fffaf0] border border-[#7a4416]/20 px-2 py-1 rounded-lg"
                          style={{ fontFamily: MONO_FONT }}
                        >
                          {p.mode}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}