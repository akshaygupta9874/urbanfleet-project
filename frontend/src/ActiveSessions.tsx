import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import {
  ShieldCheck,
  ChevronLeft,
  Laptop,
  Smartphone,
  Tablet,
  Globe,
  Clock,
  Calendar,
  LogOut,
  Trash2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Info,
  ArrowUpRight,
} from "lucide-react";
import { sessionApi, type DeviceSession } from "./lib/sessionApi";
import LoadingScreen from "./components/LoadingScreen";
import { Button } from "./components/ui/button";
import CityMapBackground from "./components/CityMapBackground";

export interface ActiveSessionsProps {
  embedded?: boolean;
  compact?: boolean;
  onExpandView?: () => void;
}

const containerVariants: Variants = {
  hidden: { opacity: 0, y: 15 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: "easeOut" },
  },
};

const cardVariants: Variants = {
  hidden: { opacity: 0, scale: 0.98 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.3 },
  },
};

function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return "Just now";
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 30) return `${diffInDays}d ago`;
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateString;
  }
}

function formatFullDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateString;
  }
}

export default function ActiveSessions({
  embedded = false,
  compact = false,
  onExpandView,
}: ActiveSessionsProps) {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Revocation loading states
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [isRevokingAll, setIsRevokingAll] = useState(false);

  // Confirmation Modal state
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    type: "single" | "all";
    session?: DeviceSession;
  }>({ isOpen: false, type: "single" });

  const loadSessions = async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const data = await sessionApi.listSessions();
      setSessions(data.sessions || []);
      setCurrentSessionId(data.currentSessionId || null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load active sessions.";
      setError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void Promise.resolve().then(() => loadSessions());
  }, []);

  const currentSession = useMemo(() => {
    return sessions.find((s) => s.isCurrent || s.id === currentSessionId);
  }, [sessions, currentSessionId]);

  const otherSessions = useMemo(() => {
    return sessions.filter((s) => !s.isCurrent && s.id !== currentSessionId);
  }, [sessions, currentSessionId]);

  const handleRevokeSingle = async (session: DeviceSession) => {
    setRevokingSessionId(session.id);
    setError(null);
    setSuccessMessage(null);

    try {
      await sessionApi.revokeSession(session.id);
      setSuccessMessage(`Session on ${session.browser} (${session.os}) has been logged out.`);
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to revoke session.";
      setError(msg);
    } finally {
      setRevokingSessionId(null);
      setConfirmModal({ isOpen: false, type: "single" });
    }
  };

  const handleRevokeAllOther = async () => {
    setIsRevokingAll(true);
    setError(null);
    setSuccessMessage(null);

    try {
      await sessionApi.logoutAllOtherSessions();
      setSuccessMessage("All other active devices have been logged out successfully.");
      setSessions((prev) => prev.filter((s) => s.isCurrent || s.id === currentSessionId));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to log out all other devices.";
      setError(msg);
    } finally {
      setIsRevokingAll(false);
      setConfirmModal({ isOpen: false, type: "all" });
    }
  };

  const getDeviceIcon = (deviceType: string) => {
    switch (deviceType?.toLowerCase()) {
      case "mobile":
        return <Smartphone className="h-5 w-5 text-[#ffd88a]" />;
      case "tablet":
        return <Tablet className="h-5 w-5 text-[#ffd88a]" />;
      default:
        return <Laptop className="h-5 w-5 text-[#ffd88a]" />;
    }
  };

  if (loading && !embedded) {
    return <LoadingScreen label="Loading device security sessions..." />;
  }

  const content = (
    <div className="w-full space-y-5">
      {/* Standalone Header Section (Only shown when not compact) */}
      {!compact && (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="relative overflow-hidden rounded-[2.25rem] border border-[#fff4dc]/80 bg-gradient-to-b from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-6 md:p-8 shadow-xl backdrop-blur-2xl"
        >
          <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative z-10">
            <div className="space-y-1.5">
              <div className="mb-1 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#3a1f0a] to-[#7a4416] px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[#ffd88a] shadow-sm">
                <ShieldCheck size={12} />
                Account security
              </div>
              <h1
                className="text-2xl md:text-3xl font-black tracking-tight text-[#2e1808]"
                style={{ fontFamily: "'Fraunces', Georgia, serif" }}
              >
                Active Device Sessions
              </h1>
              <p className="text-xs sm:text-sm font-medium text-[#6b3a12]/85 max-w-xl">
                Review all browsers and mobile devices currently authorized on your UrbanFleet account.
                Revoke any unrecognized endpoints immediately.
              </p>
            </div>

            <div className="flex items-center gap-2.5">
              <Button
                variant="outline"
                className="border-[#7a4416]/30 bg-[#fffaf0] text-[#3a1f0a] hover:bg-[#fff4dc] rounded-xl text-xs font-bold shadow-2xs"
                onClick={() => void loadSessions(true)}
                disabled={refreshing}
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 text-[#b8722c] ${refreshing ? "animate-spin" : ""}`} />
                Refresh
              </Button>

              {!embedded && (
                <Button
                  variant="outline"
                  className="border-[#7a4416]/30 bg-[#fffaf0] text-[#3a1f0a] hover:bg-[#fff4dc] rounded-xl text-xs font-bold shadow-2xs"
                  onClick={() => navigate("/dashboard")}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" /> Dashboard
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Alerts */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center justify-between rounded-2xl border border-rose-500/35 bg-rose-950/15 px-4 py-3 text-rose-950 shadow-sm backdrop-blur-md"
          >
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="h-4 w-4 text-rose-700 shrink-0" />
              <p className="text-xs font-semibold">{error}</p>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-rose-800 hover:text-rose-950 text-xs font-bold ml-4"
            >
              Dismiss
            </button>
          </motion.div>
        )}

        {successMessage && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center justify-between rounded-2xl border border-emerald-500/35 bg-emerald-950/15 px-4 py-3 text-emerald-950 shadow-sm backdrop-blur-md"
          >
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" />
              <p className="text-xs font-semibold">{successMessage}</p>
            </div>
            <button
              onClick={() => setSuccessMessage(null)}
              className="text-emerald-800 hover:text-emerald-950 text-xs font-bold ml-4"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global Device Overview Banner (Full Mode Only) */}
      {!compact && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-[1.75rem] border border-[#c58a3a]/35 bg-gradient-to-br from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-5 shadow-md backdrop-blur-md flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] text-[#ffd88a] shadow-sm">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#7a4416]">
                Authorized Endpoints
              </p>
              <p className="text-2xl font-black text-[#2e1808] console-readout">
                {sessions.length} {sessions.length === 1 ? "Device" : "Devices"}
              </p>
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-[#c58a3a]/35 bg-gradient-to-br from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-5 shadow-md backdrop-blur-md flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-900 text-[#ffd88a] shadow-sm">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#7a4416]">
                Session Protection
              </p>
              <p className="text-base font-black text-emerald-900">RFC 6819 Enforced</p>
              <p className="text-[11px] text-[#6b3a12]/80">Token rotation & anti-replay</p>
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-[#c58a3a]/35 bg-gradient-to-br from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-5 shadow-md backdrop-blur-md flex flex-col justify-center">
            {otherSessions.length > 0 ? (
              <Button
                onClick={() => setConfirmModal({ isOpen: true, type: "all" })}
                disabled={isRevokingAll}
                className="w-full bg-gradient-to-r from-rose-800 to-rose-950 hover:opacity-95 text-rose-50 rounded-xl shadow-md h-11 text-xs font-bold uppercase tracking-wider transition-all"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Revoke All Others ({otherSessions.length})
              </Button>
            ) : (
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-900 justify-center">
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                Only this device is connected
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sessions Main Card */}
      <div
        className={`relative overflow-hidden rounded-[2.25rem] border border-[#fff4dc]/80 bg-gradient-to-b from-[#fffdf9]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 shadow-xl backdrop-blur-2xl ${
          compact ? "p-5 sm:p-6" : "p-6 sm:p-8"
        }`}
      >
        <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

        {/* Card Header */}
        <div className="flex items-center justify-between gap-2 border-b border-[#7a4416]/15 pb-4 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#b8722c]" />
              <h3
                className={`${compact ? "text-base" : "text-lg"} font-black text-[#2e1808]`}
                style={{ fontFamily: "'Fraunces', Georgia, serif" }}
              >
                {compact ? "Active Security Sessions" : "Connected Browsers & Devices"}
              </h3>
            </div>
            <p className="text-[11px] font-medium text-[#7a4416] mt-0.5">
              {sessions.length} active {sessions.length === 1 ? "session" : "sessions"} verified
            </p>
          </div>

          <div className="flex items-center gap-2">
            {compact && otherSessions.length > 0 && (
              <button
                type="button"
                onClick={() => setConfirmModal({ isOpen: true, type: "all" })}
                className="rounded-xl border border-rose-500/30 bg-rose-950/15 px-2.5 py-1 text-[11px] font-bold text-rose-900 hover:bg-rose-950/25 transition-all"
              >
                Revoke Others ({otherSessions.length})
              </button>
            )}
            <button
              type="button"
              onClick={() => void loadSessions(true)}
              disabled={refreshing}
              className="grid h-8 w-8 place-items-center rounded-xl border border-[#7a4416]/20 bg-[#fffaf0] text-[#3a1f0a] hover:bg-[#fff4dc] active:scale-95 transition-all"
              title="Refresh sessions"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-[#b8722c] ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center">
            <RefreshCw className="mx-auto h-7 w-7 animate-spin text-[#b8722c]" />
            <p className="mt-2.5 text-xs font-semibold text-[#7a4416]">
              Verifying device sessions...
            </p>
          </div>
        ) : (
          <div className={`space-y-3 ${compact ? "max-h-[370px] overflow-y-auto pr-1 rd-scroll-fade" : ""}`}>
            {/* Current Session Highlight */}
            {currentSession && (
              <motion.div
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                className="rounded-2xl border-2 border-emerald-600/40 bg-emerald-950/10 p-4 shadow-2xs"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-900 text-[#ffd88a] shadow-sm">
                      {getDeviceIcon(currentSession.deviceType)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-[#2e1808]">
                          {currentSession.browser} on {currentSession.os}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-950/20 border border-emerald-600/35 px-2.5 py-0.5 text-[10px] font-bold text-emerald-950">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          This Device
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#6b3a12]">
                        <span className="flex items-center gap-1 console-readout">
                          <Globe className="h-3 w-3 text-[#b8722c]" />
                          {currentSession.ipAddress || "127.0.0.1"}
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3 text-[#b8722c]" />
                          {formatRelativeTime(currentSession.lastActiveAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Other Sessions */}
            {otherSessions.length === 0 ? (
              <div className="rounded-2xl border border-[#7a4416]/15 bg-[#fffdf9]/80 p-5 text-center">
                <p className="text-xs font-bold text-emerald-900 flex items-center justify-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                  No other external devices signed in
                </p>
                <p className="mt-1 text-[11px] text-[#7a4416]">
                  Your current browser is the sole active session on your account.
                </p>
              </div>
            ) : (
              otherSessions.map((session) => (
                <motion.div
                  key={session.id}
                  variants={cardVariants}
                  initial="hidden"
                  animate="visible"
                  className="rounded-2xl border border-[#7a4416]/20 bg-[#fffdf9]/95 p-4 shadow-2xs hover:border-[#b8722c]/50 transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#3a1f0a] text-[#ffd88a] shadow-sm">
                        {getDeviceIcon(session.deviceType)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-[#2e1808]">
                            {session.browser} on {session.os}
                          </span>
                          <span className="rounded-md bg-[#f5e6c8] border border-[#c58a3a]/40 px-2 py-0.5 text-[10px] font-bold text-[#7a4416]">
                            {session.deviceType}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#6b3a12]">
                          <span className="flex items-center gap-1 console-readout">
                            <Globe className="h-3 w-3 text-[#b8722c]" />
                            {session.ipAddress || "Unknown"}
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3 text-[#b8722c]" />
                            {formatRelativeTime(session.lastActiveAt)}
                          </span>
                          {!compact && (
                            <>
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3 text-[#b8722c]" />
                                {formatFullDate(session.createdAt)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setConfirmModal({
                          isOpen: true,
                          type: "single",
                          session,
                        })
                      }
                      disabled={revokingSessionId === session.id}
                      className="rounded-xl border border-rose-500/30 bg-rose-950/15 p-2 text-rose-800 hover:bg-rose-950/25 active:scale-95 transition-all"
                      title="Revoke device session"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        )}

        {/* Compact Expander Button */}
        {compact && onExpandView && (
          <div className="mt-4 pt-3 border-t border-[#7a4416]/15 flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onExpandView}
              className="w-full rounded-xl border-[#7a4416]/25 bg-[#fffaf0] text-xs font-bold text-[#3a1f0a] hover:bg-[#fff4dc]"
            >
              Open Full Security Console
              <ArrowUpRight className="ml-1.5 h-3.5 w-3.5 text-[#b8722c]" />
            </Button>
          </div>
        )}

        {!compact && (
          <div className="mt-6 rounded-2xl border border-[#7a4416]/15 bg-[#fffaf0]/70 p-4 flex items-start gap-3 text-xs text-[#6b3a12]">
            <Info className="h-4 w-4 text-[#b8722c] shrink-0 mt-0.5" />
            <p>
              <strong>Security Notice:</strong> Revoking a session immediately invalidates that
              device&apos;s refresh token and disconnects active WebSockets.
            </p>
          </div>
        )}
      </div>

      {/* CONFIRMATION MODAL */}
      <AnimatePresence>
        {confirmModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-md overflow-hidden rounded-3xl border border-[#fff4dc]/80 bg-gradient-to-b from-[#fffaf0] to-[#fbf0d8] p-6 shadow-2xl text-[#2e1808]"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-950/15 text-rose-800 border border-rose-500/30">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div>
                  <h3
                    className="font-black text-lg text-[#2e1808]"
                    style={{ fontFamily: "'Fraunces', Georgia, serif" }}
                  >
                    {confirmModal.type === "all"
                      ? "Log Out All Other Devices?"
                      : "Revoke Device Session?"}
                  </h3>
                  <p className="text-xs text-[#6b3a12]">This action takes effect immediately.</p>
                </div>
              </div>

              <p className="text-sm text-[#4a260c] mb-6 leading-relaxed">
                {confirmModal.type === "all" ? (
                  <>
                    Are you sure you want to log out of{" "}
                    <strong>all {otherSessions.length} other devices</strong>? They will be
                    disconnected and required to sign in again.
                  </>
                ) : (
                  <>
                    Are you sure you want to revoke the session on{" "}
                    <strong>
                      {confirmModal.session?.browser} ({confirmModal.session?.os})
                    </strong>
                    ?
                  </>
                )}
              </p>

              <div className="flex items-center justify-end gap-3">
                <Button
                  variant="outline"
                  onClick={() => setConfirmModal({ isOpen: false, type: "single" })}
                  disabled={isRevokingAll || Boolean(revokingSessionId)}
                  className="rounded-xl border-[#7a4416]/30 bg-[#fffaf0] text-[#3a1f0a] hover:bg-[#fff4dc]"
                >
                  Cancel
                </Button>

                <Button
                  onClick={() => {
                    if (confirmModal.type === "all") {
                      void handleRevokeAllOther();
                    } else if (confirmModal.session) {
                      void handleRevokeSingle(confirmModal.session);
                    }
                  }}
                  disabled={isRevokingAll || Boolean(revokingSessionId)}
                  className="rounded-xl bg-gradient-to-r from-rose-800 to-rose-950 text-white hover:opacity-95 shadow-md font-bold px-5"
                >
                  {confirmModal.type === "all"
                    ? isRevokingAll
                      ? "Logging out..."
                      : "Yes, Revoke All"
                    : revokingSessionId
                    ? "Revoking..."
                    : "Yes, Revoke"}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="relative min-h-screen bg-[#f5e6c8] font-sans text-[#2e1808] p-4 md:p-8 overflow-x-hidden">
      <CityMapBackground />
      <div className="relative z-10 mx-auto max-w-5xl">{content}</div>
    </div>
  );
}
