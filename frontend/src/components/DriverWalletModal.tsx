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
} from "lucide-react";
import { appApi } from "../lib/api";

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
}

const DISPLAY_FONT = "'Fraunces', Georgia, serif";

export default function DriverWalletModal({ isOpen, onClose }: DriverWalletModalProps) {
  const payoutAmountInputId = useId();
  const upiIdInputId = useId();
  const accountNumberInputId = useId();
  const ifscCodeInputId = useId();

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
      // Fetch balance and payouts concurrently
      const [balRes, payoutsRes] = await Promise.all([
        appApi.get<{ success: boolean; data: DriverBalance }>("/payments/payouts/balance"),
        appApi.get<{ success: boolean; data: PayoutRecord[] }>("/payments/payouts"),
      ]);

      setBalance(balRes.data.data);
      setPayouts(payoutsRes.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to load wallet data. Please try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      fetchWalletData();
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
      // Refresh wallet & list
      fetchWalletData();
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to request payout. Please verify your details.");
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
        className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[2.5rem] border border-[#fff4dc]/80 bg-gradient-to-b from-[#fffaf0] via-[#fff4dc] to-[#f7e2b8] shadow-2xl text-[#2e1808]"
      >
        {/* Brass Header Rail */}
        <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

        {/* Modal Top Bar */}
        <div className="flex items-center justify-between border-b border-[#7a4416]/20 px-6 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffd88a] shadow-md">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight text-[#2e1808]" style={{ fontFamily: DISPLAY_FONT }}>
                  Driver Ledger Wallet
                </h2>
                <span className="rounded-full bg-[#3a1f0a] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#ffd88a]">
                  Real-time
                </span>
              </div>
              <p className="text-xs text-[#7a4416]">
                Double-entry ledger audited balances and direct bank payouts
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing || loading}
              className="grid h-9 w-9 place-items-center rounded-xl border border-[#7a4416]/25 bg-[#fffaf0] text-[#3a1f0a] shadow-sm hover:bg-[#fff4dc] active:scale-95 transition-all disabled:opacity-50"
              title="Refresh ledger balances"
            >
              <RefreshCw className={`h-4 w-4 text-[#b8722c] ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-xl border border-[#7a4416]/25 bg-[#fffaf0] text-[#3a1f0a] shadow-sm hover:bg-[#fff4dc] active:scale-95 transition-all"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="overflow-y-auto px-6 py-6 sm:px-8 space-y-6">
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

              {/* Dynamic Account / VPA fields */}
              {payoutMode === "UPI" ? (
                <div>
                  <label htmlFor={upiIdInputId} className="block text-xs font-semibold text-[#7a4416] mb-1">
                    UPI ID / VPA
                  </label>
                  <input
                    id={upiIdInputId}
                    type="text"
                    placeholder="e.g. driver@oksbi or mobile@upi"
                    value={upiId}
                    onChange={(e) => setUpiId(e.target.value)}
                    className="w-full rounded-xl border border-[#7a4416]/20 bg-white/90 px-3.5 py-2 text-xs font-medium text-[#2e1808] outline-none focus:border-[#b8722c]"
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor={accountNumberInputId} className="block text-xs font-semibold text-[#7a4416] mb-1">
                      Account Number
                    </label>
                    <input
                      id={accountNumberInputId}
                      type="text"
                      placeholder="Bank account number"
                      value={accountNumber}
                      onChange={(e) => setAccountNumber(e.target.value)}
                      className="w-full rounded-xl border border-[#7a4416]/20 bg-white/90 px-3.5 py-2 text-xs font-medium text-[#2e1808] outline-none focus:border-[#b8722c]"
                    />
                  </div>
                  <div>
                    <label htmlFor={ifscCodeInputId} className="block text-xs font-semibold text-[#7a4416] mb-1">
                      IFSC Code
                    </label>
                    <input
                      id={ifscCodeInputId}
                      type="text"
                      placeholder="e.g. SBIN0001234"
                      value={ifscCode}
                      onChange={(e) => setIfscCode(e.target.value.toUpperCase())}
                      className="w-full rounded-xl border border-[#7a4416]/20 bg-white/90 px-3.5 py-2 text-xs font-medium text-[#2e1808] outline-none focus:border-[#b8722c]"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting || (balance?.availablePaise || 0) <= 0}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] py-3 text-xs font-bold uppercase tracking-wider text-[#ffe9be] shadow-md transition hover:opacity-95 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Processing Payout…
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" />
                    Initiate Payout
                  </>
                )}
              </button>
            </form>
          </section>

          {/* Payout History Section */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-[#2e1808]">Recent Settlements & Status</h3>
              <span className="text-xs font-semibold text-[#7a4416]">
                {payouts.length} {payouts.length === 1 ? "record" : "records"}
              </span>
            </div>

            {payouts.length === 0 ? (
              <div className="rounded-2xl border border-[#7a4416]/15 bg-[#fffaf0]/60 p-6 text-center text-xs font-medium text-[#7a4416]">
                No payout transactions recorded yet. Your earnings accumulate in the ledger upon trip completion.
              </div>
            ) : (
              <div className="space-y-2.5">
                {payouts.map((payout) => {
                  const statusColors: Record<string, string> = {
                    PROCESSED: "bg-emerald-500/15 text-emerald-900 border-emerald-500/30",
                    PROCESSING: "bg-amber-500/15 text-amber-900 border-amber-500/30",
                    PENDING: "bg-amber-500/15 text-amber-900 border-amber-500/30",
                    FAILED: "bg-rose-500/15 text-rose-900 border-rose-500/30",
                    REVERSED: "bg-rose-500/15 text-rose-900 border-rose-500/30",
                  };

                  return (
                    <div
                      key={payout.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-[#7a4416]/15 bg-[#fffaf0] p-3.5 shadow-xs transition hover:border-[#b8722c]/50"
                    >
                      <div className="flex items-center gap-3">
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#3a1f0a] text-[#ffd88a]">
                          <IndianRupee className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-[#2e1808]">
                            Payout via {payout.mode || "IMPS"}
                          </p>
                          <p className="text-[11px] text-[#7a4416]">
                            Ref: UF-{payout.id.slice(-8).toUpperCase()} •{" "}
                            {new Date(payout.createdAt).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3">
                        <span className="text-sm font-black text-[#2e1808]">
                          {formatPaise(payout.amountPaise)}
                        </span>
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            statusColors[payout.status] || "bg-stone-500/10 text-stone-700 border-stone-500/20"
                          }`}
                        >
                          {payout.status}
                        </span>
                      </div>
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
