import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import {
  ChevronLeft,
  Clock,
  MapPin,
  IndianRupee,
  Car,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Inbox,
  Search,
  Filter,
  Download,
  HelpCircle,
  Receipt,
  ArrowUpRight,
  Sparkles,
  X
} from "lucide-react";
import LoadingScreen from "./components/LoadingScreen";
import { Button } from "./components/ui/button";
import { appApi } from "./lib/api";
import {
  createPaymentOrder,
  loadRazorpayCheckout,
  verifyPaymentSignature,
  type FareBreakdownPayload,
  type PaymentStatus,
} from "./lib/payment";
import { useAuthContext } from "./context/auth-context";
import CityMapBackground from "./components/CityMapBackground";

interface RideHistoryRide {
  _id: string;
  pickup: { address: string };
  destination: { address: string };
  fare: { estimated: number; final?: number | null; breakdown?: FareBreakdownPayload | null };
  distance: { estimated: number | null };
  duration: { estimated: number | null };
  status: string;
  paymentStatus?: PaymentStatus;
  driver?: { _id?: string; firstName?: string; lastName?: string; vehicleNumber?: string | null } | string | null;
  createdAt: string;
}

// ---------- Form / Container animations ----------
const containerVariants: Variants = {
  hidden: { opacity: 0, y: 24, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.2,
      duration: 0.8,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  },
};


// ---------- Theme Styles (Golden Brown & Parchment) ----------
const RIDE_STATUS_STYLES: Record<string, string> = {
  COMPLETED: "bg-emerald-500/15 text-emerald-900 border-emerald-500/30",
  ONGOING: "bg-amber-500/20 text-amber-950 border-amber-500/40 animate-pulse",
  IN_PROGRESS: "bg-amber-500/20 text-amber-950 border-amber-500/40 animate-pulse",
  CANCELLED: "bg-stone-500/15 text-stone-700 border-stone-500/30",
};

const PAYMENT_STATUS_STYLES: Record<string, string> = {
  PAID: "bg-emerald-500/15 text-emerald-900 border-emerald-500/30",
  CAPTURED: "bg-emerald-500/15 text-emerald-900 border-emerald-500/30",
  COMPLETED: "bg-emerald-500/15 text-emerald-900 border-emerald-500/30",
  PENDING: "bg-amber-500/20 text-amber-950 border-amber-500/40",
  FAILED: "bg-rose-500/15 text-rose-900 border-rose-500/30",
};

const DEFAULT_BADGE_STYLE = "bg-[#fffaf0] text-[#3a1f0a] border-[#7a4416]/20";

function getBadgeStyle(map: Record<string, string>, key?: string | null) {
  if (!key) return DEFAULT_BADGE_STYLE;
  return map[key] ?? DEFAULT_BADGE_STYLE;
}

function driverInitial(ride: RideHistoryRide) {
  if (typeof ride.driver === "string" || !ride.driver?.firstName) return "D";
  return ride.driver.firstName.charAt(0).toUpperCase();
}

function driverDisplayName(ride: RideHistoryRide) {
  if (typeof ride.driver === "string") return "Driver assigned";
  if (ride.driver?.firstName) return `${ride.driver.firstName} ${ride.driver.lastName ?? ""}`.trim();
  return "Driver assigned";
}

export default function RideHistory() {
  const { user } = useAuthContext();
  const navigate = useNavigate();
  const [rides, setRides] = useState<RideHistoryRide[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [processingRideId, setProcessingRideId] = useState<string | null>(null);

  // Interactive feature states
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [selectedRideForModal, setSelectedRideForModal] = useState<RideHistoryRide | null>(null);

  useEffect(() => {
    async function loadRideHistory() {
      try {
        const response = await appApi.get<{ totalRides: number; rides: RideHistoryRide[] }>("/ride/history");
        setRides(response.data.rides);
      } catch {
        setError("Unable to load ride history. Please refresh the page.");
      } finally {
        setLoading(false);
      }
    }

    void loadRideHistory();
  }, []);

  // Filter and Search logic
  const filteredRides = useMemo(() => {
    return rides.filter((ride) => {
      const matchesSearch =
        ride.pickup.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ride.destination.address.toLowerCase().includes(searchQuery.toLowerCase());

      if (statusFilter === "ALL") return matchesSearch;
      if (statusFilter === "PENDING_PAYMENT") {
        return matchesSearch && ride.status === "COMPLETED" && ride.paymentStatus === "PENDING";
      }
      return matchesSearch && ride.status === statusFilter;
    });
  }, [rides, searchQuery, statusFilter]);

  // Quick statistics calculation
  const stats = useMemo(() => {
    const totalRides = rides.length;
    const completedRides = rides.filter(r => r.status === "COMPLETED").length;
    const totalSpent = rides.reduce((acc, curr) => acc + (curr.fare.final ?? curr.fare.estimated ?? 0), 0);
    return { totalRides, completedRides, totalSpent };
  }, [rides]);

  const handlePay = async (ride: RideHistoryRide) => {
    if (!user?._id) {
      setError("Unable to determine your account. Please sign in again.");
      return;
    }

    if (ride.status !== "COMPLETED") {
      setError("Payment is only available for completed rides.");
      return;
    }

    if (ride.paymentStatus !== "PENDING") {
      setError("This ride payment has already been processed.");
      return;
    }

    let currentRide = ride;

    if (!currentRide.fare.breakdown || currentRide.fare.final == null) {
      try {
        const response = await appApi.get<{ message: string; ride: RideHistoryRide }>(
          `/ride/${currentRide._id}/fare-preview`
        );
        currentRide = response.data.ride;
      } catch (err: any) {
        const serverMsg = err?.response?.data?.message;
        setError(serverMsg || "Unable to calculate the final fare. Please try again.");
        return;
      }
    }

    if (!currentRide.fare.breakdown) {
      setError("Ride fare breakdown is not available for payment.");
      return;
    }

    const driverId = typeof currentRide.driver === "string" ? currentRide.driver : currentRide.driver?._id;
    if (!driverId) {
      setError("Unable to determine the assigned driver for this ride.");
      return;
    }

    setProcessingRideId(currentRide._id);
    setError("");
    setMessage("");

    try {
      const paymentOrder = await createPaymentOrder({
        rideId: currentRide._id,
        driverId,
        fareBreakdown: currentRide.fare.breakdown,
        idempotencyKey: `${currentRide._id}-${user._id}`,
      });

      const Razorpay = await loadRazorpayCheckout();
      const options = {
        key: paymentOrder.razorpayKeyId,
        amount: paymentOrder.amountPaise,
        currency: paymentOrder.currency,
        order_id: paymentOrder.gatewayOrderId,
        name: "Aura Luxury Rides",
        description: "Complete your premium ride payment",
        handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          try {
            const verifyResult = await verifyPaymentSignature(response);
            setRides((current) =>
              current.map((entry) =>
                entry._id === ride._id
                  ? { ...entry, paymentStatus: verifyResult.status }
                  : entry,
              ),
            );
            setMessage("Payment verified successfully. Thank you for riding with us.");
          } catch {
            setError("Payment succeeded, but verification failed. Please contact support.");
          }
        },
        prefill: {
          name: `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim(),
          email: user?.email,
        },
        theme: { color: "#b8722c" },
        modal: {
          ondismiss: () => {
            setMessage("Payment window closed. You can retry this ride payment anytime.");
          },
        },
      };

      const razorpayInstance = new Razorpay(options);
      razorpayInstance.open();
    } catch {
      setError("Unable to launch payment checkout. Please try again later.");
    } finally {
      setProcessingRideId(null);
    }
  };

  if (loading) {
    return <LoadingScreen label="Loading your travel history..." />;
  }

  return (
    <div className="relative min-h-screen bg-[#f5e6c8] font-sans text-[#2e1808] p-4 md:p-8 overflow-hidden">
      <CityMapBackground />

      <div className="relative z-10 mx-auto max-w-6xl space-y-8">

        {/* Header Section (Ticket Styled) */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="relative overflow-hidden rounded-[2rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/90 via-[#fff4dc]/85 to-[#f7e2b8]/85 p-6 md:p-8 shadow-[0_30px_90px_-20px_rgba(80,40,10,0.4),inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-2xl"
        >
          {/* Brass top rail */}
          <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative z-10">
            <div className="space-y-1">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#3a1f0a] to-[#7a4416] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-[#ffd88a] shadow-[0_8px_20px_-8px_rgba(58,31,10,0.6)]">
                <Sparkles size={12} />
                Travel Journal
              </div>
              <h1 className="font-serif text-3xl md:text-4xl font-bold tracking-tight text-[#2e1808]">Ride History</h1>
              <p className="text-sm font-medium text-[#6b3a12]/80">
                Review your journeys and settle invoices in pristine golden style.
              </p>
            </div>

            <Button
              variant="outline"
              className="border-[#7a4416]/30 bg-[#fffaf0]/80 text-[#3a1f0a] hover:bg-[#fff4dc] hover:text-[#2e1808] transition-all rounded-2xl shadow-sm"
              onClick={() => navigate("/dashboard")}
            >
              <ChevronLeft className="mr-2 h-4 w-4" /> Dashboard
            </Button>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8 pt-6 border-t border-[#7a4416]/20">
            <div className="flex items-center gap-4 bg-[#fffaf0]/90 p-4 rounded-2xl border border-[#7a4416]/20 shadow-sm">
              <div className="p-3 rounded-xl bg-[#3a1f0a] text-[#ffd88a]">
                <Car className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold text-[#6b3a12]/70 uppercase tracking-wider">Total Trips</p>
                <p className="font-serif text-xl font-bold text-[#2e1808]">{stats.totalRides}</p>
              </div>
            </div>

            <div className="flex items-center gap-4 bg-[#fffaf0]/90 p-4 rounded-2xl border border-[#7a4416]/20 shadow-sm">
              <div className="p-3 rounded-xl bg-[#2e5a36] text-emerald-200">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold text-[#6b3a12]/70 uppercase tracking-wider">Completed</p>
                <p className="font-serif text-xl font-bold text-[#2e1808]">{stats.completedRides}</p>
              </div>
            </div>
          </div>

          {/* Brass bottom rail */}
          <div className="pointer-events-none absolute inset-x-8 bottom-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
        </motion.div>

        {/* Alerts */}
        {error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-950/20 p-4 text-sm text-rose-900 shadow-lg backdrop-blur-md">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
            <span>{error}</span>
          </motion.div>
        )}

        {message && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-start gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-4 text-sm text-emerald-900 shadow-lg backdrop-blur-md">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <span>{message}</span>
          </motion.div>
        )}

        {/* Interactive Search and Filter Toolbar */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-[#fffaf0]/90 p-4 rounded-2xl border border-[#7a4416]/20 shadow-md backdrop-blur-md">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-3.5 top-3 h-4 w-4 text-[#7a4416]/60" />
            <input
              type="text"
              placeholder="Search by pickup or drop location..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-[#7a4416]/20 bg-white/90 pl-10 pr-4 py-2.5 text-sm text-[#2e1808] placeholder-[#7a4416]/45 focus:border-[#b8722c] focus:outline-none focus:ring-2 focus:ring-[#b8722c]/20 transition-all"
            />
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
            <Filter className="h-4 w-4 text-[#b8722c] shrink-0 ml-1" />
            {["ALL", "COMPLETED", "ONGOING", "PENDING_PAYMENT", "CANCELLED"].map((filterKey) => (
              <button
                key={filterKey}
                onClick={() => setStatusFilter(filterKey)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${statusFilter === filterKey
                    ? "bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffd88a] font-semibold shadow-md"
                    : "bg-white/70 text-[#6b3a12] border border-[#7a4416]/20 hover:bg-[#fff4dc]"
                  }`}
              >
                {filterKey.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>

        {/* Ride List */}
        {filteredRides.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-[#7a4416]/30 bg-[#fffaf0]/60 p-16 text-center shadow-inner">
            <div className="rounded-2xl bg-[#7a4416]/10 p-4 text-[#7a4416] border border-[#7a4416]/20">
              <Inbox className="h-8 w-8" />
            </div>
            <div className="space-y-1">
              <p className="font-serif text-xl text-[#2e1808]">No matching itineraries found</p>
              <p className="text-sm text-[#6b3a12]/80">Try tweaking your search filters or book a new journey.</p>
            </div>
            <Button
              onClick={() => navigate("/dashboard")}
              className="mt-2 bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffd88a] hover:opacity-95 font-semibold rounded-xl shadow-md"
            >
              Book New Ride <ArrowUpRight className="ml-1.5 h-4 w-4" />
            </Button>
          </motion.div>
        ) : (
          <div className="grid gap-5">
            {filteredRides.map((ride, index) => {
              const isProcessing = processingRideId === ride._id;
              const canPay = ride.status === "COMPLETED" && ride.paymentStatus === "PENDING";
              const displayFare = ride.fare.final ? `₹${ride.fare.final / 100}` : `₹${ride.fare.estimated}`;

              return (
                <motion.div
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  key={ride._id}
                  className="group overflow-hidden rounded-3xl border border-[#7a4416]/25 bg-gradient-to-b from-[#fffaf0] via-[#fff4dc]/90 to-[#f7e2b8]/90 shadow-lg transition-all hover:border-[#b8722c] hover:shadow-xl"
                >
                  <div className="grid gap-6 p-6 md:grid-cols-[1.6fr_1fr_1fr] items-center">

                    {/* Route Info */}
                    <div className="flex gap-4">
                      <div className="flex flex-col items-center pt-1">
                        <span className="h-3 w-3 rounded-full bg-[#b8722c] shadow-sm shadow-[#b8722c]/50" />
                        <span className="my-1.5 w-px flex-1 border-l border-dashed border-[#7a4416]/40" />
                        <span className="h-3 w-3 rounded-full border-2 border-[#b8722c] bg-[#fffaf0]" />
                      </div>
                      <div className="flex flex-1 flex-col justify-between gap-3">
                        <div className="flex items-start gap-2.5 text-sm text-[#2e1808]">
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#b8722c]" />
                          <span className="font-medium line-clamp-1">{ride.pickup.address}</span>
                        </div>
                        <div className="flex items-start gap-2.5 text-sm text-[#6b3a12]">
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#7a4416]/60" />
                          <span className="line-clamp-1">{ride.destination.address}</span>
                        </div>
                        <div className="text-xs text-[#7a4416]/70 flex items-center gap-2">
                          <Clock className="h-3.5 w-3.5 text-[#b8722c]" />
                          {new Date(ride.createdAt).toLocaleDateString(undefined, {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}{" "}
                          &middot; {new Date(ride.createdAt).toLocaleTimeString(undefined, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Fare / Meta Details */}
                    <div className="grid gap-3 rounded-2xl border border-[#7a4416]/15 bg-[#fffaf0]/80 p-4 shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-xs text-[#6b3a12]/80 uppercase tracking-wider">
                          <IndianRupee className="h-3.5 w-3.5 text-[#b8722c]" />
                          Total Fare
                        </span>
                        <span className="font-serif text-lg font-bold text-[#b8722c]">{displayFare}</span>
                      </div>
                      <div className="border-t border-[#7a4416]/15" />
                      <div className="flex items-center justify-between text-xs text-[#6b3a12]/80">
                        <span>Estimated Duration</span>
                        <span className="text-[#2e1808] font-medium">{ride.duration.estimated ?? 0} mins</span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-[#6b3a12]/80">
                        <span>Chauffeur</span>
                        <span className="flex items-center gap-2 text-[#2e1808] font-medium">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#3a1f0a] text-[10px] font-bold text-[#ffd88a] border border-[#c58a3a]/40">
                            {driverInitial(ride)}
                          </span>
                          {driverDisplayName(ride)}
                        </span>
                      </div>
                    </div>

                    {/* Status Badges & Action Buttons */}
                    <div className="flex flex-col justify-between gap-4">
                      <div className="flex flex-wrap gap-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider ${getBadgeStyle(
                            RIDE_STATUS_STYLES,
                            ride.status,
                          )}`}
                        >
                          {ride.status}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider ${getBadgeStyle(
                            PAYMENT_STATUS_STYLES,
                            ride.paymentStatus,
                          )}`}
                        >
                          {ride.paymentStatus ?? "N/A"}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          disabled={!canPay || isProcessing}
                          className={`flex-1 rounded-xl text-xs font-semibold py-2.5 transition-all shadow-md ${canPay
                              ? "bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffd88a] hover:opacity-95"
                              : "bg-[#fffaf0] text-[#6b3a12] border border-[#7a4416]/25 hover:bg-[#fff4dc]"
                            }`}
                          onClick={() => handlePay(ride)}
                        >
                          {isProcessing ? (
                            <span className="flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Processing...
                            </span>
                          ) : canPay ? (
                            "Pay Now"
                          ) : (
                            <span onClick={(e) => { e.stopPropagation(); setSelectedRideForModal(ride); }} className="flex items-center gap-1.5 w-full justify-center">
                              <Receipt className="h-3.5 w-3.5" /> View Receipt
                            </span>
                          )}
                        </Button>

                        <button
                          title="Support / Report Issue"
                          onClick={() => alert(`Support ticket requested for ride #${ride._id.slice(-6).toUpperCase()}`)}
                          className="p-2.5 rounded-xl border border-[#7a4416]/20 bg-[#fffaf0] text-[#7a4416] hover:text-[#2e1808] hover:border-[#b8722c] transition-colors shadow-sm"
                        >
                          <HelpCircle className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Modal for Ride Details / Receipt Preview */}
        <AnimatePresence>
          {selectedRideForModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative w-full max-w-lg rounded-[2rem] border border-[#fff4dc] bg-gradient-to-b from-[#fffaf0] via-[#fff4dc] to-[#f7e2b8] p-6 shadow-2xl text-[#2e1808]"
              >
                <div className="flex items-center justify-between border-b border-[#7a4416]/20 pb-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-[#b8722c]" />
                    <h3 className="font-serif text-xl font-bold">Journey Summary & Receipt</h3>
                  </div>
                  <button
                    onClick={() => setSelectedRideForModal(null)}
                    className="p-2 rounded-full bg-[#7a4416]/10 text-[#7a4416] hover:bg-[#7a4416]/20 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-4 py-4 text-sm">
                  <div className="bg-[#fffaf0] p-4 rounded-2xl border border-[#7a4416]/20 space-y-2 shadow-sm">
                    <div className="flex justify-between text-[#6b3a12]/80">
                      <span>Ride ID</span>
                      <span className="font-mono text-[#2e1808]">#{selectedRideForModal._id.toUpperCase()}</span>
                    </div>
                    <div className="flex justify-between text-[#6b3a12]/80">
                      <span>Booking Status</span>
                      <span className="text-[#b8722c] font-semibold">{selectedRideForModal.status}</span>
                    </div>
                    <div className="flex justify-between text-[#6b3a12]/80">
                      <span>Payment Status</span>
                      <span className="text-emerald-800 font-semibold">{selectedRideForModal.paymentStatus ?? "Completed"}</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#6b3a12]/70">Route breakdown</p>
                    <div className="space-y-2 rounded-2xl border border-[#7a4416]/20 p-4 bg-[#fffaf0]/80 shadow-sm">
                      <p className="text-[#2e1808]"><strong>From:</strong> {selectedRideForModal.pickup.address}</p>
                      <p className="text-[#2e1808]"><strong>To:</strong> {selectedRideForModal.destination.address}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#6b3a12]/70">Fare breakdown</p>
                    <div className="rounded-2xl border border-[#7a4416]/20 p-4 bg-[#fffaf0]/80 space-y-2 shadow-sm">
                      <div className="flex justify-between text-[#2e1808]">
                        <span>Base / Estimated Fare</span>
                        <span>₹{selectedRideForModal.fare.estimated}</span>
                      </div>
                      {selectedRideForModal.fare.final && (
                        <div className="flex justify-between font-bold text-[#b8722c] pt-2 border-t border-[#7a4416]/20">
                          <span>Final Total Charged</span>
                          <span>₹{selectedRideForModal.fare.final / 100}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-4 border-t border-[#7a4416]/20">
                  <Button
                    onClick={() => {
                      alert("Simulating receipt download as PDF...");
                      setSelectedRideForModal(null);
                    }}
                    className="flex-1 bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffd88a] hover:opacity-95 font-semibold rounded-xl shadow-md"
                  >
                    <Download className="mr-2 h-4 w-4" /> Download PDF Receipt
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setSelectedRideForModal(null)}
                    className="border-[#7a4416]/30 bg-[#fffaf0] text-[#3a1f0a] hover:bg-[#fff4dc] rounded-xl"
                  >
                    Close
                  </Button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}