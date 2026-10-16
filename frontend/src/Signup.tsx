import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { motion, type Variants, AnimatePresence } from "framer-motion";
import { MapPin, Navigation } from "lucide-react";
import api from "./apiInterceptor";
import { AxiosError } from "axios";
import { useAuthContext, type User } from "./context/auth-context";
import { GoogleLogin, type CredentialResponse } from "@react-oauth/google";
import CityMapBackground from "./components/CityMapBackground";

// ---------- Form animation ----------
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


export default function SignupPage() {
  const navigate = useNavigate();
  const { establishSession, isAuthenticated, loading } = useAuthContext();
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && isAuthenticated) {
      navigate("/dashboard", { replace: true });
    }
  }, [isAuthenticated, loading, navigate]);

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setIsSubmitting(true);

    try {
      const { data } = await api.post<{ message: string; verifyUrl?: string }>("/register", {
        firstName,
        lastName,
        email,
        password,
      });
      if (data.verifyUrl) {
        setStatus(`Account pending verification! Check your terminal or open: ${data.verifyUrl}`);
      } else {
        setStatus(data.message);
      }
    } catch (error) {
      setStatus(error instanceof AxiosError ? error.response?.data.message : "Signup failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignup(credentialResponse: CredentialResponse) {
    if (!credentialResponse.credential) {
      setStatus("Google did not return a credential. Please try again.");
      return;
    }

    setStatus("");
    setIsSubmitting(true);
    try {
      const { data } = await api.post<{ accessToken: string; user: User }>("/google", {
        credential: credentialResponse.credential,
      });
      establishSession(data.accessToken, data.user);
      navigate("/dashboard", { replace: true });
    } catch (error) {
      setStatus(error instanceof AxiosError ? error.response?.data.message : "Google sign-up failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputBase =
    "w-full rounded-xl border border-[#7a4416]/20 bg-[#fffaf0]/95 px-5 py-3.5 text-base text-[#2e1808] outline-none transition-all duration-300 placeholder:text-[#7a4416]/45 focus:border-transparent focus:ring-2 focus:ring-[#b8722c] focus:shadow-[0_0_0_4px_rgba(184,114,44,0.15)]";

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#f5e6c8] font-sans text-[#2e1808]">
      <CityMapBackground />

      {/* Main Form Content */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-16 pt-8">

        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="relative w-full max-w-[460px] overflow-hidden rounded-[2rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/90 via-[#fff4dc]/85 to-[#f7e2b8]/85 p-8 pt-10 shadow-[0_40px_100px_-24px_rgba(80,40,10,0.55),inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-2xl md:p-10"
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

          {/* Moving brass sheen */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute -inset-y-10 -left-1/3 w-1/3 rotate-12 bg-gradient-to-r from-transparent via-[#fff2cc]/80 to-transparent"
            animate={{ x: ["0%", "460%"] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", repeatDelay: 3.5 }}
          />

          {/* Aura ring behind card (only visible on focus) */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute -inset-4 -z-10 rounded-[2.5rem] bg-gradient-to-r from-[#b8722c] via-[#f4b860] to-[#7a4416] opacity-0 blur-2xl transition duration-700"
            animate={{ opacity: focusedField ? 0.45 : 0 }}
          />

          {/* Route pin badge — top of card */}
          <motion.div
            variants={itemVariants}
            className="mb-5 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#3a1f0a] to-[#7a4416] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-[#ffd88a] shadow-[0_8px_20px_-8px_rgba(58,31,10,0.6)]"
          >
            <MapPin size={12} />
            Your journey starts here
          </motion.div>

          <motion.h2
            variants={itemVariants}
            className="mb-2 bg-gradient-to-br from-[#2e1808] via-[#6b3a12] to-[#b8722c] bg-clip-text text-3xl font-bold tracking-tight text-transparent md:text-4xl"
          >
            Create an account
          </motion.h2>
          <motion.p variants={itemVariants} className="mb-8 text-sm font-medium text-[#6b3a12]/80">
            Enter your details to get moving in premium comfort.
          </motion.p>

          <motion.form variants={itemVariants} className="relative mb-6 space-y-4" onSubmit={handleSignup}>
            <motion.div
              aria-hidden
              className="pointer-events-none absolute -inset-1 rounded-2xl bg-gradient-to-r from-[#7a4416] via-[#f4b860] to-[#b8722c] blur transition duration-500"
              animate={{ opacity: focusedField ? 0.35 : 0 }}
            />

            {/* Name Grid */}
            <div className="relative grid grid-cols-2 gap-4">
              <input
                type="text"
                placeholder="First name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                onFocus={() => setFocusedField("first")}
                onBlur={() => setFocusedField(null)}
                required
                className={inputBase}
              />
              <input
                type="text"
                placeholder="Last name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                onFocus={() => setFocusedField("last")}
                onBlur={() => setFocusedField(null)}
                required
                className={inputBase}
              />
            </div>

            {/* Email */}
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onFocus={() => setFocusedField("contact")}
              onBlur={() => setFocusedField(null)}
              required
              className={`${inputBase} py-4 text-lg`}
            />

            {/* Password */}
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onFocus={() => setFocusedField("password")}
              onBlur={() => setFocusedField(null)}
              required
              className={`${inputBase} py-4 text-lg`}
            />

            {/* Primary CTA — brass gradient with shine sweep and glow */}
            <motion.button
              type="submit"
              disabled={isSubmitting}
              whileTap={{ scale: 0.98 }}
              className="group relative w-full overflow-hidden rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] py-4 text-lg font-semibold text-[#ffe9be] shadow-[0_18px_40px_-12px_rgba(58,31,10,0.7),inset_0_1px_0_rgba(255,216,138,0.35)] transition-all hover:-translate-y-0.5 hover:shadow-[0_24px_50px_-14px_rgba(58,31,10,0.85),inset_0_1px_0_rgba(255,216,138,0.5)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {/* Brass inner rim */}
              <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-[#c58a3a]/40" />
              {/* Shine sweep */}
              <span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-[#ffd88a]/60 to-transparent transition-transform duration-1000 group-hover:translate-x-[460%]" />
              <span className="relative z-10 inline-flex items-center justify-center gap-2">
                {isSubmitting ? (
                  <>
                    <motion.span
                      className="inline-block h-3 w-3 rounded-full border-2 border-[#ffd88a]/40 border-t-[#ffd88a]"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
                    />
                    Finding your route...
                  </>
                ) : (
                  <>
                    <Navigation size={16} className="text-[#ffd88a]" />
                    Agree and Continue
                  </>
                )}
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

          {/* Divider */}
          <motion.div variants={itemVariants} className="mb-6 flex items-center gap-4">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[#7a4416]/40 to-transparent" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6b3a12]/70">
              or join with
            </span>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[#7a4416]/40 to-transparent" />
          </motion.div>

          <motion.div variants={itemVariants} className="mb-6 flex w-full justify-center">
            <div className="mx-auto flex w-full max-w-[360px] items-center justify-center overflow-hidden rounded-full border border-[#7a4416]/20 bg-[#fffaf0]/70 p-1 shadow-[0_10px_24px_-16px_rgba(58,31,10,0.65)] transition-transform duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_30px_-18px_rgba(58,31,10,0.75)]">
              <GoogleLogin
                onSuccess={handleGoogleSignup}
                onError={() => setStatus("Google sign-up could not be started. Please try again.")}
                text="signup_with"
                theme="outline"
                size="large"
                shape="pill"
                logo_alignment="center"
                width="100%"
              />
            </div>
          </motion.div>
         
          {/* Sign in link */}
          <motion.div variants={itemVariants} className="mb-4 text-center">
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="group relative text-sm font-semibold text-[#6b3a12] transition-colors hover:text-[#3a1f0a]"
            >
              Already have an account?{" "}
              <span className="relative inline-block">
                Sign in
                <span className="absolute inset-x-0 -bottom-0.5 h-px scale-x-100 bg-gradient-to-r from-[#7a4416] via-[#c58a3a] to-[#7a4416] transition-transform duration-300 group-hover:scale-x-110" />
              </span>
            </button>
          </motion.div>

          {/* Disclaimer */}
          <motion.p
            variants={itemVariants}
            className="text-center text-[11px] leading-relaxed text-[#6b3a12]/65"
          >
            By proceeding, you consent to our Terms of Service and Privacy Policy, and to receive
            communications from Ride and its affiliates.
          </motion.p>

          {/* Brass bottom rail */}
          <div className="pointer-events-none absolute inset-x-8 bottom-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
        </motion.div>
      </main>
    </div>
  );
}
