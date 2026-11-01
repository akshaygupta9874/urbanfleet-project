import { useState, useMemo, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { motion, type Variants, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  LockKeyhole,
  Lock,
  Eye,
  EyeOff,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import api from "./apiInterceptor";
import { AxiosError } from "axios";
import CityMapBackground from "./components/CityMapBackground";

const DISPLAY_FONT = "'Fraunces', Georgia, serif";
const BODY_FONT = "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif";
const MONO_FONT = "'JetBrains Mono', ui-monospace, 'SF Mono', monospace";

// ---------- GPU-Composited Animations ----------
const containerVariants: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.1,
      duration: 0.5,
      ease: [0.16, 1, 0.3, 1],
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
  },
};

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const { token: routeToken } = useParams();
  const [searchParams] = useSearchParams();
  const token = useMemo(
    () => routeToken ?? searchParams.get("token") ?? "",
    [routeToken, searchParams]
  );

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"success" | "error">("success");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  // Non-blocking password strength meter
  const passwordStrength = useMemo(() => {
    if (!newPassword) return { score: 0, label: "" };
    let score = 0;
    if (newPassword.length >= 6) score += 1;
    if (newPassword.length >= 10) score += 1;
    if (/[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword)) score += 1;
    if (/\d/.test(newPassword) || /[^A-Za-z0-9]/.test(newPassword)) score += 1;

    const labels = ["Weak", "Fair", "Good", "Strong", "Very Strong"];
    return { score, label: labels[score] };
  }, [newPassword]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");

    if (!token) {
      setStatusTone("error");
      setStatus("Invalid or missing password reset token. Please request a new link.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setStatusTone("error");
      setStatus("Passwords do not match. Please verify and try again.");
      return;
    }

    setIsSubmitting(true);

    try {
      const { data } = await api.post<{ message: string }>("/reset-password", {
        token,
        newPassword,
      });
      setStatusTone("success");
      setStatus(
        data.message || "Password successfully updated! Redirecting to secure login…"
      );
      setTimeout(() => navigate("/login", { replace: true }), 1500);
    } catch (error) {
      setStatusTone("error");
      setStatus(
        error instanceof AxiosError
          ? error.response?.data?.message || error.message
          : "Unable to reset password"
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className="relative flex min-h-[100dvh] w-full flex-col overflow-x-hidden bg-[#f5e6c8] text-[#2e1808] selection:bg-[#3a1f0a] selection:text-[#ffd88a]"
      style={{ fontFamily: BODY_FONT }}
    >
      <CityMapBackground />

      <style>{`
        @keyframes uf-ticket-sheen {
          0% { transform: translate3d(-130%, 0, 0) rotate(12deg); }
          100% { transform: translate3d(280%, 0, 0) rotate(12deg); }
        }
        .uf-sheen-sweep {
          animation: uf-ticket-sheen 5.5s ease-in-out infinite;
          will-change: transform;
        }
      `}</style>

      {/* Main Centered Recovery Workspace */}
      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center px-4 sm:px-6 py-8 sm:py-12">
        {/* Top Pill */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="mb-4 sm:mb-5 inline-flex items-center gap-2 rounded-full border border-[#c58a3a]/40 bg-gradient-to-r from-[#fffdf9]/95 via-[#fff4dc]/95 to-[#f7e2b8]/95 px-4 py-1.5 text-[11px] sm:text-xs font-bold text-[#3a1f0a] shadow-[0_8px_24px_-8px_rgba(58,31,10,0.3)] backdrop-blur-xl"
        >
          <Sparkles size={13} className="text-[#b8722c] shrink-0" />
          <span className="tracking-wide">UrbanFleet Security · Cryptographic Vault</span>
        </motion.div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className={`relative w-full max-w-[460px] overflow-hidden rounded-[2.25rem] sm:rounded-[2.5rem] border bg-gradient-to-b from-[#fffdf9]/96 via-[#fff4dc]/92 to-[#f5dfb5]/92 p-6 sm:p-9 shadow-[0_32px_90px_-20px_rgba(46,24,8,0.42),inset_0_1px_0_rgba(255,255,255,0.85)] backdrop-blur-2xl transition-colors duration-300 transform-gpu ${
            focusedField ? "border-[#b8722c]" : "border-[#fff4dc]/85"
          }`}
        >
          {/* Perforation ticket-edge dots */}
          <div className="pointer-events-none absolute left-0 top-1/2 hidden sm:flex -translate-x-1/2 -translate-y-1/2 flex-col gap-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <span
                key={`pl-${i}`}
                className="h-2.5 w-2.5 rounded-full bg-[#f5e6c8] shadow-inner"
              />
            ))}
          </div>
          <div className="pointer-events-none absolute right-0 top-1/2 hidden sm:flex translate-x-1/2 -translate-y-1/2 flex-col gap-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <span
                key={`pr-${i}`}
                className="h-2.5 w-2.5 rounded-full bg-[#f5e6c8] shadow-inner"
              />
            ))}
          </div>

          {/* Brass top rail */}
          <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

          {/* GPU Specular Sheen */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[2.5rem]">
            <div className="uf-sheen-sweep absolute -inset-y-16 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/35 to-transparent" />
          </div>

          {/* Card Header Bar: Badge + Security Chip */}
          <motion.div
            variants={itemVariants}
            className="mb-4 flex items-center justify-between gap-2"
          >
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#3a1f0a] to-[#7a4416] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#ffd88a] shadow-sm">
              <LockKeyhole size={11} />
              Secure Reset
            </span>

            <span
              className="inline-flex items-center gap-1 rounded-full border border-emerald-600/30 bg-emerald-950/10 px-2.5 py-1 text-[10px] font-bold text-emerald-900"
              style={{ fontFamily: MONO_FONT }}
            >
              <ShieldCheck size={12} className="text-emerald-700" />
              Token Verified
            </span>
          </motion.div>

          {/* Headline */}
          <motion.div variants={itemVariants} className="mb-5">
            <h1
              className="text-2xl sm:text-3xl font-black tracking-tight text-[#2e1808]"
              style={{ fontFamily: DISPLAY_FONT }}
            >
              Create a new password
            </h1>
            <p className="mt-1 text-xs sm:text-sm font-medium text-[#6b3a12] leading-relaxed">
              Choose a secure new password for your UrbanFleet account. You will be redirected to sign in automatically.
            </p>
          </motion.div>

          {/* Reset Form */}
          <motion.form
            variants={itemVariants}
            onSubmit={handleSubmit}
            className="space-y-4 mb-5"
          >
            {/* New Password Field */}
            <label className="block space-y-1">
              <div className="flex items-center justify-between pl-1 pr-0.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#7a4416]">
                  New Password
                </span>
                {newPassword && (
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider ${
                      passwordStrength.score >= 3
                        ? "text-emerald-800"
                        : passwordStrength.score >= 2
                          ? "text-[#b8722c]"
                          : "text-rose-800"
                    }`}
                    style={{ fontFamily: MONO_FONT }}
                  >
                    {passwordStrength.label}
                  </span>
                )}
              </div>
              <div
                className={`flex items-center gap-3 rounded-2xl border bg-[#fffdf9] px-4 py-3 transition-all duration-200 shadow-2xs ${
                  focusedField === "new"
                    ? "border-[#3a1f0a] ring-3 ring-[#c58a3a]/25"
                    : "border-[#7a4416]/25 hover:border-[#b8722c]/60"
                }`}
              >
                <Lock
                  size={17}
                  className={`shrink-0 transition-colors ${
                    focusedField === "new" ? "text-[#3a1f0a]" : "text-[#b8722c]"
                  }`}
                />
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter new password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  onFocus={() => setFocusedField("new")}
                  onBlur={() => setFocusedField(null)}
                  required
                  className="w-full bg-transparent text-sm sm:text-base font-semibold text-[#2e1808] placeholder:font-normal placeholder:text-[#7a4416]/45 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="rounded-lg p-1 text-[#7a4416] hover:bg-[#7a4416]/10 hover:text-[#2e1808] transition-colors shrink-0"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {/* Strength Segments */}
              {newPassword && (
                <div className="grid grid-cols-4 gap-1.5 pt-1 px-1">
                  {[1, 2, 3, 4].map((level) => (
                    <div
                      key={level}
                      className={`h-1 rounded-full transition-colors duration-300 ${
                        passwordStrength.score >= level
                          ? passwordStrength.score >= 3
                            ? "bg-emerald-600"
                            : "bg-[#b8722c]"
                          : "bg-[#7a4416]/15"
                      }`}
                    />
                  ))}
                </div>
              )}
            </label>

            {/* Confirm Password Field */}
            <label className="block space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#7a4416] pl-1">
                Confirm Password
              </span>
              <div
                className={`flex items-center gap-3 rounded-2xl border bg-[#fffdf9] px-4 py-3 transition-all duration-200 shadow-2xs ${
                  focusedField === "confirm"
                    ? "border-[#3a1f0a] ring-3 ring-[#c58a3a]/25"
                    : "border-[#7a4416]/25 hover:border-[#b8722c]/60"
                }`}
              >
                <LockKeyhole
                  size={17}
                  className={`shrink-0 transition-colors ${
                    focusedField === "confirm" ? "text-[#3a1f0a]" : "text-[#b8722c]"
                  }`}
                />
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Re-enter new password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  onFocus={() => setFocusedField("confirm")}
                  onBlur={() => setFocusedField(null)}
                  required
                  className="w-full bg-transparent text-sm sm:text-base font-semibold text-[#2e1808] placeholder:font-normal placeholder:text-[#7a4416]/45 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  className="rounded-lg p-1 text-[#7a4416] hover:bg-[#7a4416]/10 hover:text-[#2e1808] transition-colors shrink-0"
                  aria-label={showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"}
                >
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            {/* Submit CTA */}
            <div className="pt-1.5">
              <motion.button
                type="submit"
                disabled={isSubmitting}
                whileTap={{ scale: 0.98 }}
                className="group relative flex h-13.5 w-full items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-6 text-sm sm:text-base font-bold text-[#ffe9be] shadow-[0_18px_40px_-12px_rgba(58,31,10,0.7),inset_0_1px_0_rgba(255,216,138,0.35)] transition-all hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-65"
              >
                <span className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-[#c58a3a]/40" />
                <span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-[#ffd88a]/50 to-transparent transition-transform duration-1000 group-hover:translate-x-[460%]" />
                <span className="relative z-10 inline-flex items-center justify-center gap-2">
                  {isSubmitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin text-[#ffd88a]" />
                      <span>Updating password…</span>
                    </>
                  ) : (
                    <>
                      <LockKeyhole size={15} className="text-[#ffd88a]" />
                      <span>Reset password</span>
                    </>
                  )}
                </span>
              </motion.button>
            </div>
          </motion.form>

          {/* Contextual Status / Confirmation Banner */}
          <AnimatePresence>
            {status && (
              <motion.div
                key={status}
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6 }}
                className={`mb-5 flex items-start gap-2.5 rounded-2xl border p-4 text-xs font-semibold shadow-2xs backdrop-blur-md ${
                  statusTone === "error"
                    ? "border-rose-500/40 bg-rose-950/15 text-rose-950"
                    : "border-emerald-600/35 bg-emerald-950/10 text-emerald-950"
                }`}
              >
                {statusTone === "error" ? (
                  <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose-700" />
                ) : (
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-700" />
                )}
                <span className="leading-relaxed break-words">{status}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Back to Login Link */}
          <motion.div variants={itemVariants} className="pt-1 text-center">
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="group relative inline-flex items-center gap-2 text-xs sm:text-sm font-bold text-[#6b3a12] transition-colors hover:text-[#3a1f0a]"
            >
              <ArrowLeft
                size={14}
                className="text-[#b8722c] transition-transform group-hover:-translate-x-0.5"
              />
              <span className="relative inline-block underline decoration-[#b8722c]/50 underline-offset-4 group-hover:decoration-[#3a1f0a]">
                Back to sign in
              </span>
            </button>
          </motion.div>

          {/* Brass bottom rail */}
          <div className="pointer-events-none absolute inset-x-8 bottom-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
        </motion.div>
      </main>
    </div>
  );
}