import { useState, useMemo, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { motion, type Variants, AnimatePresence } from "framer-motion";
import { Sparkles, LockKeyhole } from "lucide-react";
import api from "./apiInterceptor";
import { AxiosError } from "axios";
import CityMapBackground from "./components/CityMapBackground";

// ---------- Form animation variants ----------
const containerVariants: Variants = {
  hidden: { opacity: 0, y: 24, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.3,
      duration: 0.8,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: "easeOut" as const } },
};

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const { token: routeToken } = useParams();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => routeToken ?? searchParams.get("token") ?? "", [routeToken, searchParams]);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");

    if (newPassword !== confirmPassword) {
      setStatus("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    try {
      const { data } = await api.post<{ message: string }>("/reset-password", {
        token,
        newPassword,
      });
      setStatus(data.message);
      setTimeout(() => navigate("/login", { replace: true }), 1200);
    } catch (error) {
      setStatus(error instanceof AxiosError ? error.response?.data.message : "Unable to reset password");
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputBase =
    "w-full rounded-xl border border-[#7a4416]/20 bg-[#fffaf0]/95 px-5 py-3.5 text-base text-[#2e1808] outline-none transition-all duration-300 placeholder:text-[#7a4416]/45 focus:border-transparent focus:ring-2 focus:ring-[#b8722c] focus:shadow-[0_0_0_4px_rgba(184,114,44,0.15)]";

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f5e6c8] font-sans text-[#2e1808] px-6 py-10">
      <CityMapBackground />

      <motion.section
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="relative z-10 w-full max-w-[460px] overflow-hidden rounded-[2rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/90 via-[#fff4dc]/85 to-[#f7e2b8]/85 p-8 pt-10 shadow-[0_40px_100px_-24px_rgba(80,40,10,0.55),inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-2xl md:p-10"
      >
        {/* Perforation ticket-edge dots */}
        <div className="pointer-events-none absolute left-0 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <span key={`pl-${i}`} className="h-2 w-2 rounded-full bg-[#f5e6c8]" />
          ))}
        </div>
        <div className="pointer-events-none absolute right-0 top-1/2 flex translate-x-1/2 -translate-y-1/2 flex-col gap-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <span key={`pr-${i}`} className="h-2 w-2 rounded-full bg-[#f5e6c8]" />
          ))}
        </div>

        {/* Brass top rail */}
        <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />

        {/* Badge */}
        <motion.div
          variants={itemVariants}
          className="mb-5 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#3a1f0a] to-[#7a4416] px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-[#ffd88a] shadow-[0_8px_20px_-8px_rgba(58,31,10,0.6)]"
        >
          <Sparkles size={12} />
          Secure Reset
        </motion.div>

        <motion.h1 variants={itemVariants} className="mb-2 bg-gradient-to-br from-[#2e1808] via-[#6b3a12] to-[#b8722c] bg-clip-text text-3xl font-bold tracking-tight text-transparent md:text-4xl">
          Create a new password
        </motion.h1>
        <motion.p variants={itemVariants} className="mb-8 text-sm font-medium text-[#6b3a12]/80 leading-relaxed">
          Choose a new password for your account. You will be redirected to login after the reset completes.
        </motion.p>

        <motion.form variants={itemVariants} onSubmit={handleSubmit} className="space-y-4 mb-6">
          <input
            type="password"
            placeholder="New password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            className={`${inputBase} py-4 text-lg`}
          />
          <input
            type="password"
            placeholder="Confirm password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            className={`${inputBase} py-4 text-lg`}
          />

          <motion.button
            type="submit"
            disabled={isSubmitting}
            whileTap={{ scale: 0.98 }}
            className="group relative w-full overflow-hidden rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] py-4 text-lg font-semibold text-[#ffe9be] shadow-[0_18px_40px_-12px_rgba(58,31,10,0.7),inset_0_1px_0_rgba(255,216,138,0.35)] transition-all hover:-translate-y-0.5 hover:shadow-[0_24px_50px_-14px_rgba(58,31,10,0.85)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-[#c58a3a]/40" />
            <span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-[#ffd88a]/60 to-transparent transition-transform duration-1000 group-hover:translate-x-[460%]" />
            <span className="relative z-10 inline-flex items-center justify-center gap-2">
              <LockKeyhole size={16} className="text-[#ffd88a]" />
              {isSubmitting ? "Updating..." : "Reset password"}
            </span>
          </motion.button>
        </motion.form>

        <AnimatePresence>
          {status && (
            <motion.p
              key={status}
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6 }}
              className="mb-6 rounded-xl border border-[#7a4416]/20 bg-[#fffaf0]/90 px-4 py-3 text-center text-sm font-medium text-[#3a1f0a] shadow-sm backdrop-blur-md"
            >
              {status}
            </motion.p>
          )}
        </AnimatePresence>

        {/* Brass bottom rail */}
        <div className="pointer-events-none absolute inset-x-8 bottom-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
      </motion.section>
    </main>
  );
}