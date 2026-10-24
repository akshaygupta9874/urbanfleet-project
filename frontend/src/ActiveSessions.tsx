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
  Sparkles,
  Info
} from "lucide-react";
import { sessionApi, type DeviceSession } from "./lib/sessionApi";
import LoadingScreen from "./components/LoadingScreen";
import { Button } from "./components/ui/button";
import CityMapBackground from "./components/CityMapBackground";

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

export default function ActiveSessions() {
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
    void loadSessions();
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
      setSuccessMessage(`Session on ${session.browser} (${session.os}) has been logged out successfully.`);
      // Update list locally
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
      // Retain only current session
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
    switch (deviceType.toLowerCase()) {
      case "mobile":
        return <Smartphone className="h-6 w-6 text-[#b8722c]" />;
      case "tablet":
        return <Tablet className="h-6 w-6 text-[#b8722c]" />;
      case "desktop":
        return <Laptop className="h-6 w-6 text-[#b8722c]" />;
      default:
        return <Laptop className="h-6 w-6 text-[#b8722c]" />;
    }
  };

  if (loading) {
    return <LoadingScreen label="Loading device security sessions..." />;
  }

  return (
    <div className="relative min-h-screen bg-[#f5e6c8] font-sans text-[#2e1808] p-4 md:p-8 overflow-hidden">
      <CityMapBackground />

      <div className="relative z-10 mx-auto max-w-5xl space-y-6">
        {/* Header Section */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="relative overflow-hidden rounded-[2rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-6 md:p-8 shadow-[0_20px_60px_-15px_rgba(80,40,10,0.3)] backdrop-blur-2xl"
        >
          {/* Brass top rail */}
          <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative z-10">
            <div className="space-y-1">
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#3a1f0a] to-[#7a4416] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-[#ffd88a] shadow-[0_8px_20px_-8px_rgba(58,31,10,0.6)]">
                <ShieldCheck size={13} />
                Security & Devices
              </div>
              <h1 className="font-serif text-3xl md:text-4xl font-bold tracking-tight text-[#2e1808]">
                Active Sessions
              </h1>
              <p className="text-sm font-medium text-[#6b3a12]/80 max-w-xl">
                Review all devices and browsers currently logged into your UrbanFleet account.
                Revoke any sessions you do not recognize to secure your account immediately.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                className="border-[#7a4416]/30 bg-[#fffaf0]/80 text-[#3a1f0a] hover:bg-[#fff4dc] hover:text-[#2e1808] transition-all rounded-xl shadow-sm"
                onClick={() => void loadSessions(true)}
                disabled={refreshing}
                title="Refresh sessions list"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin text-[#b8722c]" : ""}`} />
                Refresh
              </Button>

              <Button
                variant="outline"
                className="border-[#7a4416]/30 bg-[#fffaf0]/80 text-[#3a1f0a] hover:bg-[#fff4dc] hover:text-[#2e1808] transition-all rounded-xl shadow-sm"
                onClick={() => navigate("/dashboard")}
              >
                <ChevronLeft className="mr-1 h-4 w-4" /> Dashboard
              </Button>
            </div>
          </div>
        </motion.div>

        {/* Alerts */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center justify-between rounded-2xl border border-rose-300 bg-rose-50/95 p-4 text-rose-900 shadow-md backdrop-blur-md"
            >
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0" />
                <p className="text-sm font-medium">{error}</p>
              </div>
              <button
                onClick={() => setError(null)}
                className="text-rose-700 hover:text-rose-900 text-sm font-semibold ml-4"
              >
                Dismiss
              </button>
            </motion.div>
          )}

          {successMessage && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center justify-between rounded-2xl border border-emerald-300 bg-emerald-50/95 p-4 text-emerald-900 shadow-md backdrop-blur-md"
            >
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <p className="text-sm font-medium">{successMessage}</p>
              </div>
              <button
                onClick={() => setSuccessMessage(null)}
                className="text-emerald-700 hover:text-emerald-900 text-sm font-semibold ml-4"
              >
                Dismiss
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Global Device Overview Banner */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/80 p-5 shadow-sm backdrop-blur-md flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] text-[#ffd88a] shadow-sm">
              <Lock className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#7a4416]">Total Active Logins</p>
              <p className="text-2xl font-bold text-[#2e1808]">{sessions.length} {sessions.length === 1 ? "Device" : "Devices"}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/80 p-5 shadow-sm backdrop-blur-md flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-700 text-emerald-100 shadow-sm">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#7a4416]">Session Protection</p>
              <p className="text-base font-bold text-emerald-800">RFC 6819 Enforced</p>
              <p className="text-[11px] text-[#6b3a12]/70">Anti-replay & versioning</p>
            </div>
          </div>

          <div className="rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/80 p-5 shadow-sm backdrop-blur-md flex flex-col justify-center">
            {otherSessions.length > 0 ? (
              <Button
                onClick={() => setConfirmModal({ isOpen: true, type: "all" })}
                disabled={isRevokingAll}
                className="w-full bg-gradient-to-r from-rose-800 to-rose-900 hover:from-rose-900 hover:to-rose-950 text-white rounded-xl shadow-md py-5 text-sm font-semibold transition-all hover:shadow-lg"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Log Out All Other Devices ({otherSessions.length})
              </Button>
            ) : (
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-800 justify-center">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                No other devices connected
              </div>
            )}
          </div>
        </div>

        {/* CURRENT SESSION SECTION */}
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-[#3a1f0a] flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#b8722c]" />
            Current Device
          </h2>

          {currentSession ? (
            <motion.div
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              className="relative overflow-hidden rounded-2xl border-2 border-emerald-600/40 bg-gradient-to-br from-[#fffdfa] to-[#f4fbf6] p-6 shadow-md"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] to-[#7a4416] shadow-sm">
                    {getDeviceIcon(currentSession.deviceType)}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-lg text-[#2e1808]">
                        {currentSession.browser} on {currentSession.os}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 border border-emerald-300 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                        This Device (Active Now)
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#6b3a12]/80 pt-1">
                      <span className="flex items-center gap-1">
                        <Globe className="h-3.5 w-3.5 text-[#b8722c]" />
                        IP: <strong className="text-[#2e1808]">{currentSession.ipAddress || "Unknown"}</strong>
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-[#b8722c]" />
                        Last active: <strong className="text-[#2e1808]">{formatRelativeTime(currentSession.lastActiveAt)}</strong>
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5 text-[#b8722c]" />
                        Signed in: <strong className="text-[#2e1808]">{formatFullDate(currentSession.createdAt)}</strong>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="shrink-0 self-end md:self-center">
                  <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Current Session
                  </span>
                </div>
              </div>
            </motion.div>
          ) : (
            <div className="rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/80 p-6 text-center text-sm text-[#6b3a12]">
              No current session identified.
            </div>
          )}
        </div>

        {/* OTHER ACTIVE SESSIONS SECTION */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-[#3a1f0a] flex items-center gap-2">
              <Laptop className="h-4 w-4 text-[#b8722c]" />
              Other Active Devices ({otherSessions.length})
            </h2>
            {otherSessions.length > 0 && (
              <span className="text-xs text-[#6b3a12]/70">
                Logged in from different locations or browsers
              </span>
            )}
          </div>

          {otherSessions.length === 0 ? (
            <motion.div
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              className="rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/85 p-8 text-center shadow-sm backdrop-blur-md"
            >
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 mb-3">
                <ShieldCheck className="h-8 w-8" />
              </div>
              <h3 className="font-bold text-base text-[#2e1808]">No other active devices</h3>
              <p className="text-xs text-[#6b3a12]/80 max-w-md mx-auto mt-1">
                You are only logged in on this browser. If you ever sign in from a phone, tablet, or another computer, they will appear here.
              </p>
            </motion.div>
          ) : (
            <div className="space-y-3">
              {otherSessions.map((session) => (
                <motion.div
                  key={session.id}
                  variants={cardVariants}
                  initial="hidden"
                  animate="visible"
                  className="rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/90 p-5 shadow-sm hover:shadow-md transition-all backdrop-blur-md"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] shadow-sm">
                        {getDeviceIcon(session.deviceType)}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-base text-[#2e1808]">
                            {session.browser} on {session.os}
                          </span>
                          <span className="rounded-md bg-[#f5e6c8] border border-[#c58a3a]/40 px-2 py-0.5 text-[10px] font-bold text-[#7a4416]">
                            {session.deviceType}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#6b3a12]/80">
                          <span className="flex items-center gap-1">
                            <Globe className="h-3 w-3 text-[#b8722c]" />
                            IP: <strong className="text-[#2e1808]">{session.ipAddress || "Unknown"}</strong>
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3 text-[#b8722c]" />
                            Last active: <strong className="text-[#2e1808]">{formatRelativeTime(session.lastActiveAt)}</strong>
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3 text-[#b8722c]" />
                            First seen: <strong className="text-[#2e1808]">{formatFullDate(session.createdAt)}</strong>
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 self-end sm:self-center">
                      <Button
                        variant="outline"
                        onClick={() =>
                          setConfirmModal({
                            isOpen: true,
                            type: "single",
                            session,
                          })
                        }
                        disabled={revokingSessionId === session.id}
                        className="border-rose-400/40 bg-rose-50/50 text-rose-800 hover:bg-rose-100 hover:text-rose-900 rounded-xl text-xs font-semibold px-4 py-2 transition-all shadow-sm"
                      >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5 text-rose-600" />
                        {revokingSessionId === session.id ? "Revoking..." : "Log Out Device"}
                      </Button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Security Help Footer Card */}
        <div className="rounded-2xl border border-[#7a4416]/15 bg-[#fffaf0]/60 p-4 backdrop-blur-sm flex items-start gap-3 text-xs text-[#6b3a12]/90">
          <Info className="h-5 w-5 text-[#b8722c] shrink-0 mt-0.5" />
          <p>
            <strong>Security Notice:</strong> Revoking a session will immediately invalidate that device's refresh token and disconnect its access. If you suspect an unauthorized login, revoke the session immediately and update your password.
          </p>
        </div>
      </div>

      {/* CONFIRMATION MODAL */}
      <AnimatePresence>
        {confirmModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-md overflow-hidden rounded-3xl border border-[#fff4dc]/80 bg-gradient-to-b from-[#fffaf0] to-[#fbf0d8] p-6 shadow-2xl text-[#2e1808]"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 text-rose-700">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-[#2e1808]">
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
                    Are you sure you want to log out of <strong>all {otherSessions.length} other devices</strong>?
                    All other phones, tablets, or computers will be disconnected and must sign in again.
                  </>
                ) : (
                  <>
                    Are you sure you want to log out the session on{" "}
                    <strong>
                      {confirmModal.session?.browser} ({confirmModal.session?.os})
                    </strong>
                    ? This device will be disconnected and required to authenticate again.
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
                  className="rounded-xl bg-gradient-to-r from-rose-700 to-rose-900 text-white hover:from-rose-800 hover:to-rose-950 shadow-md font-semibold px-5"
                >
                  {confirmModal.type === "all"
                    ? isRevokingAll
                      ? "Logging out..."
                      : "Yes, Log Out All"
                    : revokingSessionId
                    ? "Revoking..."
                    : "Yes, Log Out"}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
