import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { motion, type Variants, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  MapPin,
  Navigation,
  Mail,
  Car,
  User as UserIcon,
  Lock,
  Eye,
  EyeOff,
  ShieldCheck,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  KeyRound,
  RefreshCw,
} from "lucide-react";
import api from "./apiInterceptor";
import { AxiosError } from "axios";
import { useAuthContext, type User } from "./context/auth-context";
import { GoogleLogin, type CredentialResponse } from "@react-oauth/google";
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

const stepSwitchVariants: Variants = {
  hidden: { opacity: 0, x: 14 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
  },
  exit: {
    opacity: 0,
    x: -14,
    transition: { duration: 0.18, ease: "easeIn" },
  },
};

function WelcomePill() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className="mb-4 sm:mb-5 inline-flex items-center gap-2 rounded-full border border-[#c58a3a]/40 bg-gradient-to-r from-[#fffdf9]/95 via-[#fff4dc]/95 to-[#f7e2b8]/95 px-4 py-1.5 text-[11px] sm:text-xs font-bold text-[#3a1f0a] shadow-[0_8px_24px_-8px_rgba(58,31,10,0.3)] backdrop-blur-xl"
    >
      <Sparkles size={13} className="text-[#b8722c] shrink-0" />
      <span className="tracking-wide">
        UrbanFleet · Secure Account Access
      </span>
    </motion.div>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { user, checkAuthentication, establishSession, isAuthenticated, loading } =
    useAuthContext();

  const [selectedRole, setSelectedRole] = useState<"RIDER" | "DRIVER">("RIDER");
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [otp, setOtp] = useState("");
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"info" | "error">("info");
  const [showOtp, setShowOtp] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Measure Google button container width so the iframe fits mobile & desktop cleanly
  const googleWrapperRef = useRef<HTMLDivElement | null>(null);
  const [googleBtnWidth, setGoogleBtnWidth] = useState<number>(340);

  useEffect(() => {
    const updateWidth = () => {
      if (googleWrapperRef.current) {
        const w = Math.floor(googleWrapperRef.current.getBoundingClientRect().width);
        if (w > 180) {
          setGoogleBtnWidth(Math.min(380, w - 8));
        }
      }
    };
    updateWidth();
    window.addEventListener("resize", updateWidth, { passive: true });
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  useEffect(() => {
    if (!loading && isAuthenticated && user) {
      let target = "/dashboard";
      if (selectedRole === "DRIVER" && user.roles.includes("DRIVER")) {
        target = "/driver-dashboard";
      } else if (user.roles.includes("RIDER")) {
        target = "/dashboard";
      } else if (user.roles.includes("DRIVER")) {
        target = "/driver-dashboard";
      }
      navigate(target, { replace: true });
    }
  }, [isAuthenticated, loading, navigate, user, selectedRole]);

  async function requestLoginOtp() {
    setStatus("");
    setIsSubmitting(true);

    try {
      const { data } = await api.post<{
        message?: string;
        devOtp?: string;
        accessToken?: string;
        user?: User;
        data?: {
          email?: string;
          devOtp?: string;
          message?: string;
          accessToken?: string;
          user?: User;
        };
      }>("/login", {
        email,
        password,
      });

      const receivedDevOtp = data.data?.devOtp ?? data.devOtp;
      setStatusTone("info");
      if (receivedDevOtp) {
        setStatus(`Verification code sent! (Dev code: ${receivedDevOtp} or 123456)`);
        setOtp(receivedDevOtp);
      } else {
        setStatus("Verification code sent to your email. Please enter it below.");
      }
      setShowOtp(true);
    } catch (error) {
      setStatusTone("error");
      setStatus(
        error instanceof AxiosError
          ? error.response?.data?.message || error.message
          : "Login failed"
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await requestLoginOtp();
  }

  async function handleVerifyOtp(event?: FormEvent<HTMLFormElement>) {
    if (event) event.preventDefault();
    if (!otp.trim()) return;

    setStatus("");
    setIsSubmitting(true);

    try {
      const { data } = await api.post<{
        message?: string;
        accessToken?: string;
        user?: User;
        data?: {
          accessToken?: string;
          user?: User;
        };
      }>("/verify-otp", {
        email,
        otp: otp.trim(),
      });

      const accessToken = data.data?.accessToken ?? data.accessToken;
      const verifiedUser = data.data?.user ?? data.user;

      if (accessToken && verifiedUser) {
        establishSession(accessToken, verifiedUser);
      } else {
        await checkAuthentication();
      }
      let target = "/dashboard";
      if (selectedRole === "DRIVER" && verifiedUser?.roles?.includes("DRIVER")) {
        target = "/driver-dashboard";
      } else if (verifiedUser?.roles?.includes("RIDER")) {
        target = "/dashboard";
      } else if (verifiedUser?.roles?.includes("DRIVER")) {
        target = "/driver-dashboard";
      }
      navigate(target, { replace: true });
    } catch (error) {
      setStatusTone("error");
      setStatus(
        error instanceof AxiosError
          ? error.response?.data?.message || error.message
          : "OTP verification failed"
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleLogin(credentialResponse: CredentialResponse) {
    if (!credentialResponse.credential) {
      setStatusTone("error");
      setStatus("Google did not return a credential. Please try again.");
      return;
    }

    setStatus("");
    setIsSubmitting(true);
    try {
      const response = await api.post<{
        data?: { accessToken: string; user: User };
        accessToken?: string;
        user?: User;
      }>("/google", {
        credential: credentialResponse.credential,
        roles: [selectedRole],
      });
      const resolvedToken =
        response.data?.data?.accessToken ?? response.data?.accessToken;
      const resolvedUser = response.data?.data?.user ?? response.data?.user;
      if (resolvedToken && resolvedUser) {
        establishSession(resolvedToken, resolvedUser);
      } else {
        throw new Error("Unable to establish session from Google credentials");
      }

      let target = "/dashboard";
      if (selectedRole === "DRIVER" && resolvedUser.roles?.includes("DRIVER")) {
        target = "/driver-dashboard";
      } else if (selectedRole === "RIDER") {
        target = "/dashboard";
      } else if (
        resolvedUser.roles?.includes("DRIVER") &&
        !resolvedUser.roles?.includes("RIDER")
      ) {
        target = "/driver-dashboard";
      }
      navigate(target, { replace: true });
    } catch (error) {
      setStatusTone("error");
      setStatus(
        error instanceof AxiosError
          ? error.response?.data?.message || error.message
          : "Google sign-in failed"
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const otpDigits = otp.padEnd(6, " ").slice(0, 6).split("");

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

      {/* Main Centered Auth Workspace */}
      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center px-4 sm:px-6 py-8 sm:py-12">
        <WelcomePill />

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

          {/* Card Header Bar: Route Badge + Security Chip */}
          <motion.div
            variants={itemVariants}
            className="mb-4 flex items-center justify-between gap-2"
          >
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#3a1f0a] to-[#7a4416] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#ffd88a] shadow-sm">
              <MapPin size={11} />
              {showOtp ? "Step 2 · OTP Vault" : "Step 1 · Credentials"}
            </span>

            <span
              className="inline-flex items-center gap-1 rounded-full border border-emerald-600/30 bg-emerald-950/10 px-2.5 py-1 text-[10px] font-bold text-emerald-900"
              style={{ fontFamily: MONO_FONT }}
            >
              <ShieldCheck size={12} className="text-emerald-700" />
              RFC 6819
            </span>
          </motion.div>

          {/* Dynamic Title & Subtitle */}
          <motion.div variants={itemVariants} className="mb-5">
            <h1
              className="text-2xl sm:text-3xl font-black tracking-tight text-[#2e1808]"
              style={{ fontFamily: DISPLAY_FONT }}
            >
              {showOtp
                ? "Verify login code"
                : selectedRole === "DRIVER"
                  ? "Sign in to Captain Hub"
                  : "Sign in to ride"}
            </h1>
            <p className="mt-1 text-xs sm:text-sm font-medium text-[#6b3a12] leading-relaxed">
              {showOtp ? (
                <>
                  Enter the 6-digit verification code sent to{" "}
                  <strong className="font-bold text-[#2e1808] break-all">{email}</strong>
                </>
              ) : selectedRole === "DRIVER" ? (
                "Access live dispatch radar, instant payouts, and fleet telemetry."
              ) : (
                "Book instant city rides, track captains live, and manage receipts."
              )}
            </p>
          </motion.div>

          {/* Spring-Animated Role Switcher (Passenger vs Captain) */}
          {!showOtp && (
            <motion.div
              variants={itemVariants}
              role="radiogroup"
              aria-label="Select portal mode"
              className="relative mb-5 grid grid-cols-2 gap-1.5 rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/90 p-1.5 shadow-inner"
            >
              {(
                [
                  { id: "RIDER", label: "Ride · Passenger", icon: UserIcon },
                  { id: "DRIVER", label: "Drive · Captain", icon: Car },
                ] as const
              ).map((role) => {
                const isSelected = selectedRole === role.id;
                const RoleIcon = role.icon;
                return (
                  <button
                    key={role.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setSelectedRole(role.id)}
                    className={`relative flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 text-xs font-bold uppercase tracking-wider transition-colors ${
                      isSelected
                        ? "text-[#ffd88a]"
                        : "text-[#6b3a12] hover:text-[#2e1808]"
                    }`}
                  >
                    {isSelected && (
                      <motion.span
                        layoutId="loginRoleSelectorPill"
                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                        className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] shadow-md ring-1 ring-[#c58a3a]/45"
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-1.5 truncate">
                      <RoleIcon size={14} className="shrink-0" />
                      <span className="truncate">{role.label}</span>
                    </span>
                  </button>
                );
              })}
            </motion.div>
          )}

          {/* Animated Step Switcher: Credentials Form vs. OTP Verification Vault */}
          <AnimatePresence mode="wait">
            {!showOtp ? (
              <motion.form
                key="login-credentials-form"
                variants={stepSwitchVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="space-y-3.5 mb-5"
                onSubmit={handleLogin}
              >
                {/* Email Field */}
                <label className="block space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#7a4416] pl-1">
                    Email Address
                  </span>
                  <div
                    className={`flex items-center gap-3 rounded-2xl border bg-[#fffdf9] px-4 py-3 transition-all duration-200 shadow-2xs ${
                      focusedField === "contact"
                        ? "border-[#3a1f0a] ring-3 ring-[#c58a3a]/25"
                        : "border-[#7a4416]/25 hover:border-[#b8722c]/60"
                    }`}
                  >
                    <Mail
                      size={17}
                      className={`shrink-0 transition-colors ${
                        focusedField === "contact" ? "text-[#3a1f0a]" : "text-[#b8722c]"
                      }`}
                    />
                    <input
                      type="email"
                      placeholder="name@example.com"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      onFocus={() => setFocusedField("contact")}
                      onBlur={() => setFocusedField(null)}
                      required
                      className="w-full bg-transparent text-sm sm:text-base font-semibold text-[#2e1808] placeholder:font-normal placeholder:text-[#7a4416]/45 outline-none"
                    />
                  </div>
                </label>

                {/* Password Field with Show/Hide Toggle */}
                <label className="block space-y-1">
                  <div className="flex items-center justify-between pl-1 pr-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#7a4416]">
                      Password
                    </span>
                    <button
                      type="button"
                      onClick={() => navigate("/forgot-password")}
                      className="text-[11px] font-bold text-[#b8722c] hover:text-[#3a1f0a] transition-colors"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div
                    className={`flex items-center gap-3 rounded-2xl border bg-[#fffdf9] px-4 py-3 transition-all duration-200 shadow-2xs ${
                      focusedField === "password"
                        ? "border-[#3a1f0a] ring-3 ring-[#c58a3a]/25"
                        : "border-[#7a4416]/25 hover:border-[#b8722c]/60"
                    }`}
                  >
                    <Lock
                      size={17}
                      className={`shrink-0 transition-colors ${
                        focusedField === "password" ? "text-[#3a1f0a]" : "text-[#b8722c]"
                      }`}
                    />
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      onFocus={() => setFocusedField("password")}
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
                </label>

                {/* Primary Submit CTA */}
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
                          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#ffd88a]/35 border-t-[#ffd88a]" />
                          <span>Sending Verification Code…</span>
                        </>
                      ) : (
                        <>
                          <Navigation size={15} className="text-[#ffd88a]" />
                          <span>Continue with OTP</span>
                          <ArrowRight
                            size={15}
                            className="text-[#ffd88a] transition-transform group-hover:translate-x-0.5"
                          />
                        </>
                      )}
                    </span>
                  </motion.button>
                </div>
              </motion.form>
            ) : (
              <motion.form
                key="login-otp-form"
                variants={stepSwitchVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                onSubmit={handleVerifyOtp}
                className="mb-5 space-y-4"
              >
                {/* OTP Instructions Banner */}
                <div className="flex items-center justify-between gap-2 rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/90 px-3.5 py-2.5 text-xs text-[#6b3a12]">
                  <span className="flex items-center gap-2 font-medium">
                    <KeyRound size={15} className="text-[#b8722c] shrink-0" />
                    <span>Enter 6-digit security PIN</span>
                  </span>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void requestLoginOtp()}
                    className="inline-flex items-center gap-1 font-bold text-[#3a1f0a] hover:text-[#b8722c] disabled:opacity-50 transition-colors shrink-0"
                  >
                    <RefreshCw size={12} className={isSubmitting ? "animate-spin" : ""} />
                    Resend
                  </button>
                </div>

                {/* Interactive Segmented 6-Digit Visual OTP Input */}
                <div className="relative">
                  {/* Visual 6-Slot Display */}
                  <div className="grid grid-cols-6 gap-2 sm:gap-2.5">
                    {otpDigits.map((digit, idx) => {
                      const isCurrentSlot =
                        focusedField === "otp" &&
                        (otp.length === idx || (otp.length >= 6 && idx === 5));
                      const isFilled = digit.trim() !== "";
                      return (
                        <div
                          key={idx}
                          className={`flex h-13 sm:h-14 items-center justify-center rounded-xl border-2 text-lg sm:text-xl font-black transition-all ${
                            isCurrentSlot
                              ? "border-[#3a1f0a] bg-[#fffdf9] ring-3 ring-[#c58a3a]/30 scale-[1.03]"
                              : isFilled
                                ? "border-[#b8722c] bg-[#fffdf9] text-[#2e1808]"
                                : "border-[#7a4416]/25 bg-[#fffaf0]/75 text-[#7a4416]/40"
                          }`}
                          style={{ fontFamily: MONO_FONT }}
                        >
                          {digit.trim() || "•"}
                        </div>
                      );
                    })}
                  </div>

                  {/* Transparent Native Input Overlay (Supports Paste, Backspace & Mobile OTP Autofill) */}
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    aria-label="Enter 6-digit OTP"
                    value={otp}
                    onChange={(event) =>
                      setOtp(event.target.value.replace(/\s/g, "").slice(0, 8))
                    }
                    onFocus={() => setFocusedField("otp")}
                    onBlur={() => setFocusedField(null)}
                    maxLength={8}
                    autoFocus
                    required
                    className="absolute inset-0 h-full w-full cursor-text opacity-0"
                  />
                </div>

                {/* Primary Verify CTA */}
                <motion.button
                  type="submit"
                  disabled={isSubmitting || !otp.trim()}
                  whileTap={{ scale: 0.98 }}
                  className="group relative flex h-13.5 w-full items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-6 text-sm sm:text-base font-bold text-[#ffe9be] shadow-[0_18px_40px_-12px_rgba(58,31,10,0.7)] transition-all hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-[#c58a3a]/40" />
                  <span className="relative z-10 inline-flex items-center justify-center gap-2">
                    {isSubmitting ? (
                      <>
                        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#ffd88a]/35 border-t-[#ffd88a]" />
                        <span>Verifying OTP…</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={16} className="text-[#ffd88a]" />
                        <span>Verify Code & Sign In</span>
                      </>
                    )}
                  </span>
                </motion.button>

                {/* Back to Credentials Button */}
                <button
                  type="button"
                  onClick={() => {
                    setShowOtp(false);
                    setOtp("");
                    setStatus("");
                  }}
                  className="flex w-full items-center justify-center gap-1.5 py-1.5 text-xs font-bold text-[#6b3a12] hover:text-[#3a1f0a] transition-colors"
                >
                  <ArrowLeft size={13} />
                  <span>Back to email & password</span>
                </button>
              </motion.form>
            )}
          </AnimatePresence>

          {/* Contextual Status / Error Banner */}
          <AnimatePresence>
            {status && (
              <motion.div
                key={status}
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6 }}
                className={`mb-5 flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-xs font-semibold shadow-2xs backdrop-blur-md ${
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

          {/* Ticket Perforation Divider */}
          <motion.div variants={itemVariants} className="relative my-5 flex items-center gap-3">
            <div
              className="h-px flex-1"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(90deg, #7a4416 0 6px, transparent 6px 12px)",
                opacity: 0.35,
              }}
            />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#7a4416]">
              or continue with
            </span>
            <div
              className="h-px flex-1"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(90deg, #7a4416 0 6px, transparent 6px 12px)",
                opacity: 0.35,
              }}
            />
          </motion.div>

          {/* Responsive Pixel-Fitted Google Sign-In Container */}
          <motion.div
            ref={googleWrapperRef}
            variants={itemVariants}
            className="mb-5 flex w-full justify-center"
          >
            <div className="flex w-full items-center justify-center overflow-hidden rounded-full border border-[#7a4416]/20 bg-[#fffdf9] py-1.5 px-2 shadow-sm transition-all duration-200 hover:border-[#b8722c]/60 hover:shadow-md">
              <GoogleLogin
                onSuccess={handleGoogleLogin}
                onError={() => {
                  setStatusTone("error");
                  setStatus("Google sign-in could not be started. Please try again.");
                }}
                text="continue_with"
                theme="outline"
                size="large"
                shape="pill"
                logo_alignment="center"
                width={String(googleBtnWidth)}
              />
            </div>
          </motion.div>

          {/* Sign-Up Prompt Row */}
          <motion.div
            variants={itemVariants}
            className="mb-4 rounded-2xl border border-[#7a4416]/15 bg-[#fffaf0]/75 px-4 py-3 text-center text-xs font-medium text-[#6b3a12]"
          >
            New to UrbanFleet?{" "}
            <button
              type="button"
              onClick={() => navigate("/signup")}
              className="font-black text-[#3a1f0a] underline decoration-[#b8722c] underline-offset-4 hover:text-[#b8722c] transition-colors ml-1"
            >
              Create your account →
            </button>
          </motion.div>

          {/* Disclaimer */}
          <motion.p
            variants={itemVariants}
            className="text-center text-[11px] leading-relaxed text-[#6b3a12]/70"
          >
            By proceeding, you consent to receive account emails, fare receipts, and live
            trip telemetry updates from UrbanFleet.
          </motion.p>

          {/* Brass bottom rail */}
          <div className="pointer-events-none absolute inset-x-8 bottom-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
        </motion.div>
      </main>
    </div>
  );
}