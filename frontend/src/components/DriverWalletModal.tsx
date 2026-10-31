import { useEffect, useState, useId } from "react";
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
}

const DISPLAY_FONT = "'Fraunces', Georgia, serif";

export default function DriverWalletModal({ isOpen, onClose, onOpenBankDetails }: DriverWalletModalProps) {
  const payoutAmountInputId = useId();

  const [balance, setBalance] = useState<DriverBalance | null>(null);
  const [payouts, setPayouts] = useState<PayoutRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [payoutSuccessMsg, setPayoutSuccessMsg] = useState("");

  // Payout request form
  const [payoutAmount, setPayoutAmount] = useState<string>("");
  const [payoutMode, setPayoutMode] = useState<"UPI" | "IMPS">("UPI");
  const [upiId, setUpiId] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");
  const [accountHolderName, setAccountHolderName] = useState("");
  const [bankName, setBankName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const formatPaise = (paise: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 2,
    }).format((paise || 0) / 100);
  };

  const fetchWalletData = async () => {
    try {
      setError("");
      const [balRes, payoutsRes, profile] = await Promise.all([
        appApi.get<{ success: boolean; data: DriverBalance }>("/payments/payouts/balance"),
        appApi.get<{ success: boolean; data: PayoutRecord[] }>("/payments/payouts"),
        fetchDriverProfile().catch(() => null),
      ]);

      setBalance(balRes.data.data);
      setPayouts(payoutsRes.data.data || []);

      if (profile) {
        setUpiId(profile.upiId || "");
        setAccountNumber(profile.accountNumber || "");
        setIfscCode(profile.ifscCode || "");
        setAccountHolderName(profile.accountHolderName || "");
        setBankName(profile.bankName || "");
      }
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(message || "Failed to load wallet data. Please try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void Promise.resolve().then(() => fetchWalletData());
    }
  }, [isOpen]);

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

    const availableRupees = (balance?.availablePaise || 0) / 100;
    if (amountNum > availableRupees) {
      setError(`Requested amount exceeds available balance (${formatPaise(balance?.availablePaise || 0)})`);
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
      });

      setPayoutSuccessMsg(`Payout of ${formatPaise(amountPaise)} successfully queued for settlement.`);
      setPayoutAmount("");
      fetchWalletData();
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(message || "Failed to request payout. Please verify your details.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-md"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[2rem] border border-[#c58a3a]/40 bg-[#fbf6ed] shadow-2xl"
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-[#7a4416]/20 bg-gradient-to-r from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-6 py-4 text-[#ffd88a]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#c58a3a]/40 bg-[#2e1808] shadow-inner">
              <Wallet className="h-5 w-5 text-[#ffd88a]" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white" style={{ fontFamily: DISPLAY_FONT }}>
                Earnings & Payout Wallet
              </h2>
              <p className="text-xs text-[#ffd88a]/80">Settled ride earnings & real-time bank disbursements</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing || loading}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#c58a3a]/40 bg-[#3a1f0a] text-[#ffd88a] transition hover:bg-[#6b3a12] disabled:opacity-50"
              title="Refresh ledger"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#c58a3a]/40 bg-[#3a1f0a] text-[#ffd88a] transition hover:bg-rose-900/60"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {/* Error & Success Toasts */}
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-950/15 p-3.5 text-xs font-semibold text-rose-900 shadow-sm">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-700" />
              <span>{error}</span>
            </div>
          )}

          {payoutSuccessMsg && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/15 p-3.5 text-xs font-semibold text-emerald-900 shadow-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
              <span>{payoutSuccessMsg}</span>
            </div>
          )}

          {/* Balance Cards Grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Available Balance (Hero) */}
            <div className="relative overflow-hidden rounded-2xl border border-[#c58a3a]/50 bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] p-4 text-[#ffe9be] shadow-lg">
              <div className="flex items-center justify-between text-xs font-semibold text-[#ffd88a]">
                <span>Available Payout</span>
                <IndianRupee className="h-4 w-4 text-[#ffd88a]" />
              </div>
              <p className="mt-2 text-2xl font-black text-white" style={{ fontFamily: DISPLAY_FONT }}>
                {loading ? "..." : formatPaise(balance?.availablePaise || 0)}
              </p>
              <p className="mt-1 text-[11px] text-[#ffd88a]/80">Available to withdraw right now</p>
            </div>

            {/* Total Earned */}
            <div className="rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/95 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-semibold text-[#7a4416]">
                <span>Total Earned</span>
                <ArrowDownRight className="h-4 w-4 text-emerald-700" />
              </div>
              <p className="mt-2 text-xl font-bold text-[#2e1808]">
                {loading ? "..." : formatPaise(balance?.earnedPaise || 0)}
              </p>
              <p className="mt-1 text-[11px] text-[#7a4416]/75">Gross ledger credit</p>
            </div>

            {/* Paid Out */}
            <div className="rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/95 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-semibold text-[#7a4416]">
                <span>Settled Payouts</span>
                <ArrowUpRight className="h-4 w-4 text-[#b8722c]" />
              </div>
              <p className="mt-2 text-xl font-bold text-[#2e1808]">
                {loading ? "..." : formatPaise(balance?.debitedPaise || 0)}
              </p>
              <p className="mt-1 text-[11px] text-[#7a4416]/75">Transferred to your bank</p>
            </div>

            {/* In Process / Reserved */}
            <div className="rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/95 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-semibold text-[#7a4416]">
                <span>Reserved / In-Flight</span>
                <Clock className="h-4 w-4 text-amber-600" />
              </div>
              <p className="mt-2 text-xl font-bold text-[#2e1808]">
                {loading ? "..." : formatPaise(balance?.reservedPaise || 0)}
              </p>
              <p className="mt-1 text-[11px] text-[#7a4416]/75">Pending bank confirmation</p>
            </div>
          </div>

          {/* Request Payout Form */}
          <section className="rounded-2xl border border-[#c58a3a]/30 bg-[#fffaf0]/80 p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-[#7a4416]/15 pb-3">
              <div className="flex items-center gap-2">
                <Send className="h-4 w-4 text-[#b8722c]" />
                <h3 className="font-bold text-sm text-[#2e1808]">Request Instant Payout</h3>
              </div>
              <span className="flex items-center gap-1 text-[11px] font-medium text-[#7a4416]">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" />
                Zero transfer fee
              </span>
            </div>

            <form onSubmit={handleRequestPayout} className="mt-4 space-y-4">
              {/* Amount Input with Quick Preset Chips */}
              <div>
                <label htmlFor={payoutAmountInputId} className="block text-xs font-semibold text-[#7a4416] mb-1.5">
                  Payout Amount (₹)
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-sm font-bold text-[#7a4416]">
                    ₹
                  </span>
                  <input
                    id={payoutAmountInputId}
                    type="number"
                    step="1"
                    min="1"
                    max={(balance?.availablePaise || 0) / 100}
                    placeholder="Enter amount to withdraw"
                    value={payoutAmount}
                    onChange={(e) => setPayoutAmount(e.target.value)}
                    className="w-full rounded-xl border border-[#7a4416]/20 bg-white/90 pl-8 pr-4 py-2.5 text-sm font-bold text-[#2e1808] outline-none transition focus:border-[#b8722c] focus:ring-1 focus:ring-[#b8722c]"
                  />
                </div>

                {/* Preset Chips */}
                <div className="mt-2 flex flex-wrap gap-2">
                  {[500, 1000, 2000].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setPayoutAmount(preset.toString())}
                      className="rounded-lg border border-[#7a4416]/20 bg-[#fffaf0] px-2.5 py-1 text-xs font-semibold text-[#6b3a12] transition hover:bg-[#fff4dc]"
                    >
                      ₹{preset}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      const availRupees = Math.floor((balance?.availablePaise || 0) / 100);
                      if (availRupees > 0) setPayoutAmount(availRupees.toString());
                    }}
                    className="rounded-lg border border-[#c58a3a]/40 bg-gradient-to-r from-[#ffd88a]/30 to-[#f4b860]/30 px-2.5 py-1 text-xs font-bold text-[#3a1f0a] transition hover:opacity-90"
                  >
                    Withdraw All
                  </button>
                </div>
              </div>

              {/* Mode Selector */}
              <div>
                <label className="block text-xs font-semibold text-[#7a4416] mb-1.5">
                  Transfer Mode
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPayoutMode("UPI")}
                    className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-bold transition ${
                      payoutMode === "UPI"
                        ? "border-[#c58a3a] bg-gradient-to-r from-[#3a1f0a] to-[#6b3a12] text-[#ffd88a] shadow-xs"
                        : "border-[#7a4416]/20 bg-[#fffaf0] text-[#6b3a12] hover:bg-[#fff4dc]"
                    }`}
                  >
                    <CreditCard className="h-4 w-4" />
                    Instant UPI
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayoutMode("IMPS")}
                    className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-bold transition ${
                      payoutMode === "IMPS"
                        ? "border-[#c58a3a] bg-gradient-to-r from-[#3a1f0a] to-[#6b3a12] text-[#ffd88a] shadow-xs"
                        : "border-[#7a4416]/20 bg-[#fffaf0] text-[#6b3a12] hover:bg-[#fff4dc]"
                    }`}
                  >
                    <Building2 className="h-4 w-4" />
                    Bank Account (IMPS)
                  </button>
                </div>
              </div>

              {/* Pre-filled Destination Cards (Already Filled, Not Asked) */}
              <div>
                <label className="block text-xs font-semibold text-[#7a4416] mb-1.5">
                  Payout Destination (Pre-configured)
                </label>
                {payoutMode === "UPI" ? (
                  <div className="flex items-center justify-between rounded-xl border border-[#c58a3a]/30 bg-[#fffdf9] p-3.5 shadow-2xs">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#3a1f0a] to-[#6b3a12] text-[#ffd88a]">
                        <CreditCard className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[#2e1808]">
                            {upiId ? upiId : "No UPI ID registered"}
                          </span>
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                            <CheckCircle2 className="h-3 w-3" /> Auto-filled
                          </span>
                        </div>
                        <p className="text-[11px] font-medium text-[#7a4416]">Instant transfer to your registered UPI VPA</p>
                      </div>
                    </div>
                    {onOpenBankDetails && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenBankDetails();
                        }}
                        className="flex items-center gap-1 rounded-lg border border-[#7a4416]/20 bg-[#fffaf0] px-2.5 py-1 text-xs font-bold text-[#6b3a12] transition hover:bg-[#fff4dc]"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-between rounded-xl border border-[#c58a3a]/30 bg-[#fffdf9] p-3.5 shadow-2xs">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#3a1f0a] to-[#6b3a12] text-[#ffd88a]">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[#2e1808]">
                            {accountNumber
                              ? `${bankName ? bankName + " • " : ""}A/C: •••• ${accountNumber.slice(-4)}`
                              : "No Bank Account registered"}
                          </span>
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                            <CheckCircle2 className="h-3 w-3" /> Auto-filled
                          </span>
                        </div>
                        <p className="text-[11px] font-medium text-[#7a4416]">
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
                        className="flex items-center gap-1 rounded-lg border border-[#7a4416]/20 bg-[#fffaf0] px-2.5 py-1 text-xs font-bold text-[#6b3a12] transition hover:bg-[#fff4dc]"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                    )}
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting || (balance?.availablePaise || 0) <= 0}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] py-3 text-xs font-bold uppercase tracking-wider text-[#ffe9be] shadow-md transition hover:opacity-95 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Initiating Transfer...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    <span>Disburse Payout Now</span>
                  </>
                )}
              </button>
            </form>
          </section>

          {/* Recent Payouts Audit Trail */}
          <section className="space-y-3">
            <h3 className="font-bold text-xs uppercase tracking-wider text-[#7a4416]">
              Disbursement History
            </h3>

            {payouts.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#7a4416]/25 bg-white/40 py-8 text-center text-[#7a4416]">
                <Clock className="h-8 w-8 text-[#b8722c]/50 mb-2" />
                <p className="text-xs font-bold">No payouts recorded yet</p>
                <p className="text-[11px] text-[#7a4416]/75">When you withdraw earnings, settled disbursements will appear here.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {payouts.map((p) => {
                  const isSuccess = p.status === "PROCESSED";
                  const isPending = p.status === "PENDING" || p.status === "PROCESSING";
                  const isReversed = p.status === "REVERSED";

                  return (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-xl border border-[#7a4416]/15 bg-white/80 p-3.5 shadow-2xs transition hover:bg-white"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-9 w-9 items-center justify-center rounded-xl font-bold text-xs ${
                            isSuccess
                              ? "bg-emerald-950/15 text-emerald-800"
                              : isPending
                              ? "bg-amber-950/15 text-amber-800"
                              : isReversed
                              ? "bg-blue-950/15 text-blue-800"
                              : "bg-rose-950/15 text-rose-800"
                          }`}
                        >
                          {p.mode === "UPI" ? <CreditCard className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-[#2e1808]">{formatPaise(p.amountPaise)}</span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
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
                          <p className="text-[11px] text-[#7a4416]/75">
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
                      <span className="text-xs font-mono font-medium text-[#7a4416]">
                        {p.mode}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
