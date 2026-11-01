import { useEffect, useRef, useState, useMemo, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { motion, type Variants, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  MapPin,
  Navigation,
  Car,
  User as UserIcon,
  Mail,
  Lock,
  Eye,
  EyeOff,
  ShieldCheck,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
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
      staggerChildren: 0.05,
      delayChildren: 0.08,
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

function OnboardingPill() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className="mb-4 sm:mb-5 inline-flex items-center gap-2 rounded-full border border-[#c58a3a]/40 bg-gradient-to-r from-[#fffdf9]/95 via-[#fff4dc]/95 to-[#f7e2b8]/95 px-4 py-1.5 text-[11px] sm:text-xs font-bold text-[#3a1f0a] shadow-[0_8px_24px_-8px_rgba(58,31,10,0.3)] backdrop-blur-xl"
    >
      <Sparkles size={13} className="text-[#b8722c] shrink-0" />
      <span className="tracking-wide">
        UrbanFleet Onboarding · Create Your Encrypted Profile
      </span>
    </motion.div>
  );
}

export default function SignupPage() {
  const navigate = useNavigate();
  const { establishSession, isAuthenticated, loading, user } = useAuthContext();

  const [selectedRole, setSelectedRole] = useState<"RIDER" | "DRIVER">("RIDER");
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"success" | "error">("success");
  const [verifyUrl, setVerifyUrl] = useState<string | null>(null);
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

  // Non-blocking visual password strength indicator
  const passwordStrength = useMemo(() => {
    if (!password) return { score: 0, label: "" };
    let score = 0;
    if (password.length >= 6) score += 1;
    if (password.length >= 10) score += 1;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
    if (/\d/.test(password) || /[^A-Za-z0-9]/.test(password)) score += 1;

    const labels = ["Weak", "Fair", "Good", "Strong", "Very Strong"];
    return { score, label: labels[score] };
  }, [password]);

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setVerifyUrl(null);
    setIsSubmitting(true);

    try {
      const { data } = await api.post<{ message: string; verifyUrl?: string }>("/register", {
        firstName,
        lastName,
        email,
        password,
        roles: [selectedRole],
      });
      setStatusTone("success");
      if (data.verifyUrl) {
        setVerifyUrl(data.verifyUrl);
        setStatus("Account created! Verify your email below to activate your console.");
      } else {
        setStatus(data.message || "Account created! Please check your email to verify.");
      }
    } catch (error) {
      setStatusTone("error");
      setStatus(
        error instanceof AxiosError
          ? error.response?.data?.message || error.message
          : "Signup failed"
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignup(credentialResponse: CredentialResponse) {
    if (!credentialResponse.credential) {
      setStatusTone("error");
      setStatus("Google did not return a credential. Please try again.");
      return;
    }

    setStatus("");
    setVerifyUrl(null);
    setIsSubmitting(true);
    try {
      const response = await api.post<{
        accessToken?: string;
        user?: User;
        data?: { accessToken?: string; user?: User };
      }>("/google", {
        credential: credentialResponse.credential,
        roles: [selectedRole],
      });
      const resolvedToken =
        response.data?.data?.accessToken ?? response.data?.accessToken;
      const resolvedUser = response.data?.data?.user ?? response.data?.user;

      if (!resolvedToken || !resolvedUser) {
        throw new Error("Unable to establish session from Google credentials");
      }

      establishSession(resolvedToken, resolvedUser);

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
          : "Google sign-up failed"
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

      {/* Main Centered Onboarding Workspace */}
      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center px-4 sm:px-6 py-8 sm:py-12">
        <OnboardingPill />

        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className={`relative w-full max-w-[480px] overflow-hidden rounded-[2.25rem] sm:rounded-[2.5rem] border bg-gradient-to-b from-[#fffdf9]/96 via-[#fff4dc]/92 to-[#f5dfb5]/92 p-6 sm:p-9 shadow-[0_32px_90px_-20px_rgba(46,24,8,0.42),inset_0_1px_0_rgba(255,255,255,0.85)] backdrop-blur-2xl transition-colors duration-300 transform-gpu ${
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

          {/* Card Header Bar: Route Pin + Security Badge */}
          <motion.div
            variants={itemVariants}
            className="mb-4 flex items-center justify-between gap-2"
          >
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#3a1f0a] to-[#7a4416] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#ffd88a] shadow-sm">
              <MapPin size={11} />
              Your journey starts here
            </span>

            <span
              className="inline-flex items-center gap-1 rounded-full border border-emerald-600/30 bg-emerald-950/10 px-2.5 py-1 text-[10px] font-bold text-emerald-900"
              style={{ fontFamily: MONO_FONT }}
            >
              <ShieldCheck size={12} className="text-emerald-700" />
              TLS 1.3
            </span>
          </motion.div>

          {/* Dynamic Headline */}
          <motion.div variants={itemVariants} className="mb-5">
            <h1
              className="text-2xl sm:text-3xl font-black tracking-tight text-[#2e1808]"
              style={{ fontFamily: DISPLAY_FONT }}
            >
              {selectedRole === "DRIVER"
                ? "Become a Fleet Captain"
                : "Create your account"}
            </h1>
            <p className="mt-1 text-xs sm:text-sm font-medium text-[#6b3a12] leading-relaxed">
              {selectedRole === "DRIVER"
                ? "Register to receive live proximity dispatches and instant wallet payouts."
                : "Enter your details to start booking rides with upfront fare guarantees."}
            </p>
          </motion.div>

          {/* Spring-Animated Role Switcher (Rider vs Driver) */}
          <motion.div variants={itemVariants} className="mb-5 space-y-2.5">
            <div
              role="radiogroup"
              aria-label="Select account role"
              className="relative grid grid-cols-2 gap-1.5 rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/90 p-1.5 shadow-inner"
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
                        layoutId="signupRoleSelectorPill"
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
            </div>

            {/* Role Perk Pill */}
            <AnimatePresence mode="wait">
              <motion.div
                key={selectedRole}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
                className="flex items-center justify-between rounded-xl border border-[#7a4416]/15 bg-[#fffdf9]/85 px-3.5 py-2 text-[11px] font-semibold text-[#6b3a12]"
              >
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 size={13} className="text-emerald-700 shrink-0" />
                  {selectedRole === "DRIVER"
                    ? "80% direct fare share • Instant Razorpay payouts"
                    : "4-digit PIN boarding • Live Geoapify vector radar"}
                </span>
                <span
                  className="rounded-md bg-[#3a1f0a]/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#3a1f0a]"
                  style={{ fontFamily: MONO_FONT }}
                >
                  {selectedRole}
                </span>
              </motion.div>
            </AnimatePresence>
          </motion.div>

          {/* Signup Form */}
          <motion.form
            variants={itemVariants}
            className="space-y-3.5 mb-5"
            onSubmit={handleSignup}
          >
            {/* First & Last Name Grid (Stacks cleanly on narrow screens, 2-col on SM+) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#7a4416] pl-1">
                  First Name
                </span>
                <div
                  className={`flex items-center gap-2.5 rounded-2xl border bg-[#fffdf9] px-3.5 py-3 transition-all duration-200 shadow-2xs ${
                    focusedField === "first"
                      ? "border-[#3a1f0a] ring-3 ring-[#c58a3a]/25"
                      : "border-[#7a4416]/25 hover:border-[#b8722c]/60"
                  }`}
                >
                  <UserIcon
                    size={16}
                    className={`shrink-0 transition-colors ${
                      focusedField === "first" ? "text-[#3a1f0a]" : "text-[#b8722c]"
                    }`}
                  />
                  <input
                    type="text"
                    placeholder="First name"
                    autoComplete="given-name"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    onFocus={() => setFocusedField("first")}
                    onBlur={() => setFocusedField(null)}
                    required
                    className="w-full bg-transparent text-sm sm:text-base font-semibold text-[#2e1808] placeholder:font-normal placeholder:text-[#7a4416]/45 outline-none"
                  />
                </div>
              </label>

              <label className="block space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#7a4416] pl-1">
                  Last Name
                </span>
                <div
                  className={`flex items-center gap-2.5 rounded-2xl border bg-[#fffdf9] px-3.5 py-3 transition-all duration-200 shadow-2xs ${
                    focusedField === "last"
                      ? "border-[#3a1f0a] ring-3 ring-[#c58a3a]/25"
                      : "border-[#7a4416]/25 hover:border-[#b8722c]/60"
                  }`}
                >
                  <UserIcon
                    size={16}
                    className={`shrink-0 transition-colors ${
                      focusedField === "last" ? "text-[#3a1f0a]" : "text-[#b8722c]"
                    }`}
                  />
                  <input
                    type="text"
                    placeholder="Last name"
                    autoComplete="family-name"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    onFocus={() => setFocusedField("last")}
                    onBlur={() => setFocusedField(null)}
                    required
                    className="w-full bg-transparent text-sm sm:text-base font-semibold text-[#2e1808] placeholder:font-normal placeholder:text-[#7a4416]/45 outline-none"
                  />
                </div>
              </label>
            </div>

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

            {/* Password Field with Visibility Toggle & Live Strength Meter */}
            <label className="block space-y-1">
              <div className="flex items-center justify-between pl-1 pr-0.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#7a4416]">
                  Create Password
                </span>
                {password && (
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
                  placeholder="Create a strong password"
                  autoComplete="new-password"
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

              {/* 4-Segment Strength Bar */}
              {password && (
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
                      <span>Creating your profile…</span>
                    </>
                  ) : (
                    <>
                      <Navigation size={15} className="text-[#ffd88a]" />
                      <span>Agree & Continue</span>
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

          {/* Contextual Status / Verification Action Banner */}
          <AnimatePresence>
            {status && (
              <motion.div
                key={status}
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6 }}
                className={`mb-5 rounded-2xl border p-4 text-xs font-semibold shadow-2xs backdrop-blur-md space-y-2.5 ${
                  statusTone === "error"
                    ? "border-rose-500/40 bg-rose-950/15 text-rose-950"
                    : "border-emerald-600/35 bg-emerald-950/10 text-emerald-950"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  {statusTone === "error" ? (
                    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose-700" />
                  ) : (
                    <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-700" />
                  )}
                  <span className="leading-relaxed break-words">{status}</span>
                </div>

                {verifyUrl && (
                  <a
                    href={verifyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 py-2.5 text-xs font-bold text-emerald-50 shadow-sm hover:bg-emerald-900 transition-colors"
                  >
                    <span>Verify Account Now</span>
                    <ExternalLink size={13} />
                  </a>
                )}
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
              or join with
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

          {/* Responsive Pixel-Fitted Google Sign-Up Container */}
          <motion.div
            ref={googleWrapperRef}
            variants={itemVariants}
            className="mb-5 flex w-full justify-center"
          >
            <div className="flex w-full items-center justify-center overflow-hidden rounded-full border border-[#7a4416]/20 bg-[#fffdf9] py-1.5 px-2 shadow-sm transition-all duration-200 hover:border-[#b8722c]/60 hover:shadow-md">
              <GoogleLogin
                onSuccess={handleGoogleSignup}
                onError={() => {
                  setStatusTone("error");
                  setStatus("Google sign-up could not be started. Please try again.");
                }}
                text="signup_with"
                theme="outline"
                size="large"
                shape="pill"
                logo_alignment="center"
                width={String(googleBtnWidth)}
              />
            </div>
          </motion.div>

          {/* Sign-In Prompt Row */}
          <motion.div
            variants={itemVariants}
            className="mb-4 rounded-2xl border border-[#7a4416]/15 bg-[#fffaf0]/75 px-4 py-3 text-center text-xs font-medium text-[#6b3a12]"
          >
            Already have an UrbanFleet account?{" "}
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="font-black text-[#3a1f0a] underline decoration-[#b8722c] underline-offset-4 hover:text-[#b8722c] transition-colors ml-1"
            >
              Sign in →
            </button>
          </motion.div>

          {/* Disclaimer */}
          <motion.p
            variants={itemVariants}
            className="text-center text-[11px] leading-relaxed text-[#6b3a12]/70"
          >
            By proceeding, you consent to our Terms of Service and Privacy Policy, and to
            receive trip telemetry and account communications from UrbanFleet.
          </motion.p>

          {/* Brass bottom rail */}
          <div className="pointer-events-none absolute inset-x-8 bottom-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
        </motion.div>
      </main>
    </div>
  );
}