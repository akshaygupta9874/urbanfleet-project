import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { motion, type Variants, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  KeyRound,
  ArrowLeft,
  Mail,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Send,
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

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"success" | "error">("success");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setIsSubmitting(true);

    try {
      const { data } = await api.post<{ message: string }>("/forgot-password", {
        email,
      });
      setStatusTone("success");
      setStatus(data.message || "Password reset link sent! Check your inbox.");
    } catch (error) {
      setStatusTone("error");
      setStatus(
        error instanceof AxiosError
          ? error.response?.data?.message || error.message
          : "Unable to send reset link"
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
        {/* Top Welcome Pill */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="mb-4 sm:mb-5 inline-flex items-center gap-2 rounded-full border border-[#c58a3a]/40 bg-gradient-to-r from-[#fffdf9]/95 via-[#fff4dc]/95 to-[#f7e2b8]/95 px-4 py-1.5 text-[11px] sm:text-xs font-bold text-[#3a1f0a] shadow-[0_8px_24px_-8px_rgba(58,31,10,0.3)] backdrop-blur-xl"
        >
          <Sparkles size={13} className="text-[#b8722c] shrink-0" />
          <span className="tracking-wide">UrbanFleet · Account recovery</span>
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
              <KeyRound size={11} />
              Password Reset
            </span>

            <span
              className="inline-flex items-center gap-1 rounded-full border border-emerald-600/30 bg-emerald-950/10 px-2.5 py-1 text-[10px] font-bold text-emerald-900"
              style={{ fontFamily: MONO_FONT }}
            >
              <ShieldCheck size={12} className="text-emerald-700" />
              Secure Link
            </span>
          </motion.div>

          {/* Headline */}
          <motion.div variants={itemVariants} className="mb-5">
            <h1
              className="text-2xl sm:text-3xl font-black tracking-tight text-[#2e1808]"
              style={{ fontFamily: DISPLAY_FONT }}
            >
              Recover account
            </h1>
            <p className="mt-1 text-xs sm:text-sm font-medium text-[#6b3a12] leading-relaxed">
              Enter the email linked to your UrbanFleet account and we will dispatch a secure reset link.
            </p>
          </motion.div>

          {/* Reset Form */}
          <motion.form
            variants={itemVariants}
            onSubmit={handleSubmit}
            className="space-y-4 mb-5"
          >
            <label className="block space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#7a4416] pl-1">
                Account Email
              </span>
              <div
                className={`flex items-center gap-3 rounded-2xl border bg-[#fffdf9] px-4 py-3.5 transition-all duration-200 shadow-2xs ${
                  focusedField === "email"
                    ? "border-[#3a1f0a] ring-3 ring-[#c58a3a]/25"
                    : "border-[#7a4416]/25 hover:border-[#b8722c]/60"
                }`}
              >
                <Mail
                  size={17}
                  className={`shrink-0 transition-colors ${
                    focusedField === "email" ? "text-[#3a1f0a]" : "text-[#b8722c]"
                  }`}
                />
                <input
                  type="email"
                  placeholder="name@example.com"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  onFocus={() => setFocusedField("email")}
                  onBlur={() => setFocusedField(null)}
                  required
                  className="w-full bg-transparent text-sm sm:text-base font-semibold text-[#2e1808] placeholder:font-normal placeholder:text-[#7a4416]/45 outline-none"
                />
              </div>
            </label>

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
                    <span>Dispatching reset link…</span>
                  </>
                ) : (
                  <>
                    <Send size={15} className="text-[#ffd88a]" />
                    <span>Send reset link</span>
                  </>
                )}
              </span>
            </motion.button>
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
          <motion.div variants={itemVariants} className="pt-2 text-center">
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="group relative inline-flex items-center gap-2 text-xs sm:text-sm font-bold text-[#6b3a12] transition-colors hover:text-[#3a1f0a]"
            >
              <ArrowLeft size={14} className="text-[#b8722c] transition-transform group-hover:-translate-x-0.5" />
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